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
import { NextResponse, type NextRequest } from "next/server";

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
  fetchCheckout,
  fetchCustomerSubscription,
  fetchSubscription,
} from "@/services/polar";

/** 이 상태부터 구독이 만들어져 있다. open·expired·failed 는 볼 것이 없다. */
const PAID_CHECKOUT_STATUSES = new Set(["succeeded", "confirmed"]);

interface ResolvedSubscription {
  subscriptionId: string;
  status: string;
  currentPeriodEnd: string | null;
}

interface ProfileRow {
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  current_period_end: string | null;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  // 본문은 선택이다. 없으면 저장된 polar_* 로 조회하는 기존 경로만 돈다.
  let checkoutId: string | null = null;
  try {
    const body = (await request.json()) as { checkoutId?: unknown } | null;
    if (typeof body?.checkoutId === "string" && body.checkoutId !== "") {
      checkoutId = body.checkoutId;
    }
  } catch {
    // 본문 없음 — 정상이다.
  }

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("profiles")
    .select("polar_customer_id, polar_subscription_id, current_period_end")
    .eq("id", userId)
    .maybeSingle();

  const profile = (data ?? null) as ProfileRow | null;

  // 첫 결제에는 저장된 polar_* 가 없다. 체크아웃을 먼저 본다.
  let customerId = profile?.polar_customer_id ?? null;
  let resolved: ResolvedSubscription | null = null;

  if (checkoutId) {
    const fromCheckout = await resolveFromCheckout(checkoutId, userId);

    if (fromCheckout === "forbidden") {
      return NextResponse.json({ ok: false }, { status: 403 });
    }

    if (fromCheckout) {
      resolved = fromCheckout.subscription;
      customerId = fromCheckout.customerId ?? customerId;
    }
  }

  resolved ??= await resolveSubscription(profile);

  if (
    resolved &&
    isEntitledStatus(resolved.status) &&
    resolved.currentPeriodEnd !== null
  ) {
    const update: Record<string, string> = {
      tier: "pro",
      subscription_status: resolved.status,
      current_period_end: resolved.currentPeriodEnd,
      polar_subscription_id: resolved.subscriptionId,
    };

    // 웹훅이 채우던 값이다. 첫 결제에서는 여기가 유일한 기록 시점이고,
    // 이 값이 있어야 이후 구독 관리·갱신 조회가 동작한다.
    if (customerId) update.polar_customer_id = customerId;

    await createAdminSupabase().from("profiles").update(update).eq("id", userId);
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
 * 체크아웃 하나를 근거로 구독을 찾는다.
 *
 * **소유자 검증이 이 함수의 존재 이유다.** checkoutId는 클라이언트가 보낸
 * 값이다. 검증 없이 쓰면 남의 체크아웃 ID를 주워 자기 계정을 Pro로 만들 수
 * 있다. 우리가 심은 metadata.userId 가 세션 사용자와 다르거나 아예 없으면
 * 거부한다 — 우리가 만들지 않은 체크아웃도 근거가 될 수 없다.
 */
async function resolveFromCheckout(
  checkoutId: string,
  userId: string,
): Promise<
  | "forbidden"
  | { subscription: ResolvedSubscription | null; customerId: string | null }
  | null
> {
  let checkout;
  try {
    checkout = await fetchCheckout(checkoutId);
  } catch (err) {
    // 조회 실패는 저장된 값으로 시도하는 기존 경로에 맡긴다. 다만 원인은
    // 남긴다 — 삼키면 "결제했는데 Pro가 안 된다"를 추적할 단서가 없다.
    console.error("[billing/sync] 체크아웃 조회 실패", err);
    return null;
  }

  if (checkout.userId !== userId) return "forbidden";
  if (!PAID_CHECKOUT_STATUSES.has(checkout.status)) return null;

  try {
    if (checkout.subscriptionId) {
      const state = await fetchSubscription(checkout.subscriptionId);
      return {
        subscription: { subscriptionId: checkout.subscriptionId, ...state },
        customerId: checkout.customerId,
      };
    }

    // 첫 결제 직후에는 체크아웃에 구독 ID가 아직 없다. 고객으로 찾는다.
    if (checkout.customerId) {
      return {
        subscription: await fetchCustomerSubscription(checkout.customerId),
        customerId: checkout.customerId,
      };
    }
  } catch (err) {
    console.error("[billing/sync] 체크아웃 기준 구독 조회 실패", err);
    return null;
  }

  return null;
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
  } catch (err) {
    console.error("[billing/sync] 저장된 구독 정보 조회 실패", err);
    return null;
  }

  return null;
}
