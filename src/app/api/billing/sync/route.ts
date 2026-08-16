/**
 * POST /api/billing/sync — 웹훅 지연 우회.
 *
 * 결제 성공 리다이렉트 직후 클라이언트가 호출한다. 웹훅은 수 초~수 분 지연될
 * 수 있는데 사용자는 리다이렉트 직후 화면을 본다. 웹훅만 믿고 기다리면
 * "결제했는데 안 열려요"가 그대로 터진다.
 *
 * GET이 아닌 이유: profiles를 갱신하는 부수효과가 있다. GET이면 프리페치·
 * 프리렌더가 호출해 예기치 않게 실행된다.
 *
 * 여기서 admin(service role) 클라이언트를 쓰는 이유: profiles.tier·
 * current_period_end·polar_* 는 사용자 UPDATE가 revoke되어 있다. 단,
 * **그 네 컬럼과 자기 행 외에는 admin으로 아무것도 건드리지 않는다.**
 */
import { NextResponse } from "next/server";

import { isEntitledStatus } from "@/lib/entitlement";
import { createAdminSupabase } from "@/lib/supabase/admin";
import { createServerSupabase } from "@/lib/supabase/server";
import {
  UnauthorizedError,
  getEffectiveTier,
  requireUser,
} from "@/lib/supabase/session";
import type { BillingSyncResponse } from "@/types/api";

import {
  fetchCustomerSubscription,
  fetchSubscription,
} from "@/services/polar";

interface ProfileRow {
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  current_period_end: string | null;
}

export async function POST(): Promise<NextResponse> {
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
  const { data } = await supabase
    .from("profiles")
    .select("polar_customer_id, polar_subscription_id, current_period_end")
    .eq("id", userId)
    .maybeSingle();

  const profile = (data ?? null) as ProfileRow | null;

  const resolved = await resolveSubscription(profile);

  if (
    resolved &&
    isEntitledStatus(resolved.status) &&
    resolved.currentPeriodEnd !== null
  ) {
    await createAdminSupabase()
      .from("profiles")
      .update({
        tier: "pro",
        subscription_status: resolved.status,
        current_period_end: resolved.currentPeriodEnd,
        polar_subscription_id: resolved.subscriptionId,
      })
      .eq("id", userId);
  }

  // 티어 판정은 effective_tier DB 함수 하나로만 한다. 여기서 다시 계산하면
  // 판정이 두 곳에 존재하게 되고, 어긋나는 순간 게이팅이 깨진다.
  const tier = await getEffectiveTier(userId);
  const currentPeriodEnd =
    resolved?.currentPeriodEnd ?? profile?.current_period_end ?? null;

  const response: BillingSyncResponse = { tier, currentPeriodEnd };
  return NextResponse.json(response);
}

/**
 * 구독 ID를 알면 그것으로, 모르면 고객 ID로 조회한다.
 * Polar 호출 실패는 삼킨다 — 동기화 실패가 화면 전체를 막을 이유가 없다.
 */
async function resolveSubscription(
  profile: ProfileRow | null,
): Promise<{
  subscriptionId: string;
  status: string;
  currentPeriodEnd: string | null;
} | null> {
  if (!profile) return null;

  try {
    if (profile.polar_subscription_id) {
      const state = await fetchSubscription(profile.polar_subscription_id);
      return { subscriptionId: profile.polar_subscription_id, ...state };
    }

    if (profile.polar_customer_id) {
      return await fetchCustomerSubscription(profile.polar_customer_id);
    }
  } catch {
    return null;
  }

  return null;
}
