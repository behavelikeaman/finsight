/**
 * POST /api/billing/checkout — Pro 체크아웃 세션 생성.
 *
 * userId는 세션에서만 가져온다. 클라이언트가 보낸 사용자 식별자를 쓰면
 * 남의 계정을 Pro로 만들 수 있다.
 */
import { NextResponse, type NextRequest } from "next/server";

import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type { CheckoutRequest, CheckoutResponse } from "@/types/api";

import { createCheckout } from "@/services/polar";

export async function POST(request: NextRequest): Promise<NextResponse> {
  let userId: string;
  let email: string | undefined;

  try {
    const user = await requireUser();
    userId = user.id;
    email = user.email;
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    throw err;
  }

  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const body = json as Partial<CheckoutRequest> | null;
  if (!body || body.plan !== "pro") {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (!siteUrl) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  // {CHECKOUT_ID}는 Polar가 리다이렉트 시 실제 값으로 치환한다. 복귀한 화면이
  // 이 파라미터를 보고 billing/sync를 호출해 웹훅 지연을 우회한다.
  const successUrl = `${siteUrl.replace(/\/+$/, "")}/dashboard?checkout_id={CHECKOUT_ID}`;

  let url: string;
  try {
    ({ url } = await createCheckout({ userId, email, successUrl }));
  } catch {
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  const response: CheckoutResponse = { url };
  return NextResponse.json(response);
}
