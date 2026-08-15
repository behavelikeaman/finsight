/**
 * 사용량 검사 관문.
 *
 * usage_counters·profiles.sample_used는 이전 step이 의도적으로 RLS·컬럼
 * 권한으로 잠갔다(usage_counters는 SELECT만, sample_used는 UPDATE revoke).
 * 쓰기는 전부 security definer 함수(increment_usage·mark_sample_used)를
 * RPC로 호출한다 — 애플리케이션이 읽고-더하고-쓰면 동시 요청에서 카운트가 샌다.
 *
 * 검사(check)와 차감(consume)을 분리한다. AI 호출이 실패했는데 쿼터가
 * 깎이면 안 된다.
 */
import { QUOTA } from "@/types/tier";

import { createServerSupabase } from "./supabase/server";
import { getEffectiveTier } from "./supabase/session";

export type QuotaKind = "classify" | "chat";

export type QuotaVerdict =
  | { allowed: true; left: number }
  | { allowed: false; reason: "quota_exceeded" | "tier_required" };

/** 현재 기간의 사용량을 조회해 판정한다. 차감은 하지 않는다. */
export async function checkQuota(
  userId: string,
  kind: QuotaKind,
): Promise<QuotaVerdict> {
  const tier = await getEffectiveTier(userId);
  const limit =
    kind === "classify"
      ? QUOTA[tier].classifyPerMonth
      : QUOTA[tier].chatPerMonth;

  // free 티어의 chatPerMonth는 0이다. 쿼터 소진이 아니라 등급 문제이므로
  // 사용량을 조회할 필요도 없이 바로 판정한다.
  if (limit === 0) {
    return { allowed: false, reason: "tier_required" };
  }

  const used = await readUsage(userId, kind);
  const left = limit - used;

  return left > 0
    ? { allowed: true, left }
    : { allowed: false, reason: "quota_exceeded" };
}

/** 성공적으로 호출한 뒤 1 증가시킨다. increment_usage가 원자적으로 처리한다. */
export async function consumeQuota(
  userId: string,
  kind: QuotaKind,
): Promise<void> {
  void userId; // increment_usage는 auth.uid()로 판정한다. 인자로 uid를 받지 않는다.

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("increment_usage", { kind });

  if (error) {
    throw new Error(`쿼터 차감에 실패했습니다: ${error.message}`);
  }
}

/** 익명 표본 1회 제한. profiles.sample_used를 읽는다(SELECT만 허용됨). */
export async function checkSampleAllowance(userId: string): Promise<boolean> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("sample_used")
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return false;

  return (data as { sample_used: boolean }).sample_used === false;
}

export async function markSampleUsed(userId: string): Promise<void> {
  void userId; // mark_sample_used도 auth.uid()로 판정한다.

  const supabase = await createServerSupabase();
  const { error } = await supabase.rpc("mark_sample_used");

  if (error) {
    throw new Error(`표본 사용 플래그 갱신에 실패했습니다: ${error.message}`);
  }
}

async function readUsage(userId: string, kind: QuotaKind): Promise<number> {
  const supabase = await createServerSupabase();
  const column = kind === "classify" ? "classify_used" : "chat_used";

  const { data, error } = await supabase
    .from("usage_counters")
    .select(column)
    .eq("owner_id", userId)
    .eq("period", currentPeriod())
    .maybeSingle();

  if (error || !data) return 0;

  return (data as Record<string, number>)[column] ?? 0;
}

/** 'YYYY-MM'. increment_usage의 to_char(now(), 'YYYY-MM')와 같은 기준(UTC). */
function currentPeriod(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}
