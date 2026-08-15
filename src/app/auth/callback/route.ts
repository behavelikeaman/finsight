/**
 * GET /auth/callback — OAuth code를 세션으로 교환한다.
 *
 * next는 같은 오리진의 경로만 허용한다. 외부 URL을 그대로 리다이렉트하면
 * 오픈 리다이렉트 취약점이 된다.
 */
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";

const DEFAULT_NEXT = "/dashboard";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next"));

  if (!code) {
    return NextResponse.redirect(withError(request, next, "missing_code"));
  }

  const supabase = await createServerSupabase();
  const { error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return NextResponse.redirect(withError(request, next, "exchange_failed"));
  }

  return NextResponse.redirect(new URL(next, request.url));
}

/** 같은 오리진의 경로만 허용한다. `/`로 시작하지 않거나 `//`로 시작하면 기본값으로 닫는다. */
function safeNext(value: string | null): string {
  if (!value) return DEFAULT_NEXT;
  if (!value.startsWith("/") || value.startsWith("//")) return DEFAULT_NEXT;
  return value;
}

function withError(request: NextRequest, next: string, reason: string): URL {
  const target = new URL(next, request.url);
  target.searchParams.set("auth_error", reason);
  return target;
}
