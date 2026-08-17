/**
 * DELETE /api/account — 내 데이터 전체 삭제.
 *
 * "계정 삭제"가 아니다. analyses(→ transactions는 cascade)·user_rules만
 * 지우고 로그아웃한다. usage_counters·profiles·auth.users는 건드리지 않는다
 * — 이유는 ADR-018과 CLAUDE.md를 보라. 지우면 무료 사용자가 삭제→재업로드로
 * 월 1회 제한을 무한히 우회하거나, 결제한 사용자가 free로 돌아간다.
 *
 * PATCH /api/account — 이메일 수신 동의만 바꾼다. profiles를 직접 UPDATE하지
 * 않고 set_email_opt_in RPC로만 쓴다(0002·0006).
 */
import { NextResponse } from "next/server";

import { isAnonymousUser } from "@/lib/supabase/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type { AccountSettingsResponse, OkResponse } from "@/types/api";

export async function DELETE(): Promise<NextResponse> {
  let userId: string;

  try {
    const user = await requireUser();
    userId = user.id;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    throw err;
  }

  const supabase = await createServerSupabase();

  // transactions는 analyses의 ON DELETE CASCADE로 함께 지워진다.
  await supabase.from("analyses").delete().eq("owner_id", userId);
  await supabase.from("user_rules").delete().eq("owner_id", userId);
  await supabase.auth.signOut();

  const response: OkResponse = { ok: true };
  return NextResponse.json(response);
}

/**
 * 이메일 수신 동의 갱신. 켜기와 끄기(해지)가 같은 경로다.
 *
 * 익명 세션은 두 겹으로 막는다 — 여기서 403으로 끊고, RPC도 auth.users.email이
 * 없으면 거부한다. 앱 층만 막으면 익명 사용자가 RPC를 직접 호출할 수 있고,
 * linkIdentity()가 uid를 유지하므로 그 동의가 실계정의 동의로 남는다.
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  let anonymous: boolean;

  try {
    const user = await requireUser();
    anonymous = isAnonymousUser(user);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return json({ ok: false, reason: "unauthorized" }, 401);
    }
    throw err;
  }

  if (anonymous) {
    return json({ ok: false, reason: "anonymous_denied" }, 403);
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const emailOptIn = (body as { emailOptIn?: unknown } | null)?.emailOptIn;
  if (typeof emailOptIn !== "boolean") {
    return json({ ok: false, reason: "invalid" }, 400);
  }

  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("set_email_opt_in", {
    opt_in: emailOptIn,
  });

  // 저장 결과를 모르면 성공이라고 답하지 않는다. 동의하지 않은 사용자를
  // 동의한 것으로 표시하는 편이 반대보다 훨씬 나쁘다.
  if (error || typeof data !== "boolean") {
    return json({ ok: false, reason: "write_failed" }, 500);
  }

  // 요청 값이 아니라 DB가 저장한 값을 돌려준다.
  return json({ ok: true, emailOptIn: data }, 200);
}

function json(body: AccountSettingsResponse, status: number): NextResponse {
  return NextResponse.json(body, { status });
}
