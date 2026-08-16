/**
 * POST /api/billing/portal — Polar 고객 포털 세션 생성.
 *
 * 해지·카드 교체·영수증은 전부 Polar 포털에서 처리한다. 결제 수단을 우리가
 * 다루지 않는 것이 Merchant of Record를 쓰는 이유다(ADR-005).
 *
 * 고객 ID는 **세션 사용자의 profiles 행에서만** 읽는다. 클라이언트가 보낸
 * 값을 쓰면 남의 구독 포털을 열어 해지·카드 정보 열람이 가능해진다.
 *
 * GET이 아닌 이유: 1회용 토큰이 박힌 세션을 발급하는 부수효과가 있다.
 * GET이면 프리페치·프리렌더가 사용자 의사와 무관하게 세션을 만든다.
 *
 * 여기서는 admin(service role)을 쓰지 않는다. 자기 행 SELECT는 RLS 아래에서
 * 그대로 되므로 권한을 올릴 이유가 없다.
 */
import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type { PortalResponse } from "@/types/api";

import { createCustomerPortalSession } from "@/services/polar";

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
    .select("polar_customer_id")
    .eq("id", userId)
    .maybeSingle();

  const customerId = (data as { polar_customer_id: string | null } | null)
    ?.polar_customer_id;

  // 결제한 적이 없으면 Polar에 고객 자체가 없다. 관리할 구독도 없다.
  if (!customerId) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  let url: string;
  try {
    ({ url } = await createCustomerPortalSession(customerId));
  } catch (err) {
    console.error("[billing/portal] Polar 고객 포털 세션 생성 실패", err);
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  const response: PortalResponse = { url };
  return NextResponse.json(response);
}
