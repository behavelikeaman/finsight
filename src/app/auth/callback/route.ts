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
  const next = safeNext(url.searchParams.get("next"), url.origin);

  // 연결 실패는 code 없이 error/error_code 쿼리로 돌아온다. code 누락과 뭉뚱그리면
  // "이미 가입된 Google"인지 아닌지를 사용자에게 안내할 수 없다.
  const oauthError =
    url.searchParams.get("error_code") ?? url.searchParams.get("error");

  if (oauthError) {
    return NextResponse.redirect(
      withError(request, next, mapOAuthError(oauthError)),
    );
  }

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

/**
 * 같은 오리진의 경로만 허용한다.
 *
 * 프리픽스 문자열 검사로는 막을 수 없다 — WHATWG URL 파서는 http(s) 스킴에서
 * 백슬래시를 슬래시와 똑같이 취급하므로, `//`로 시작하지 않는 `/\evil.com`도
 * 외부 오리진으로 풀린다. 실제로 리졸브한 뒤 오리진을 비교해야 파서 차이를
 * 이용한 우회를 닫을 수 있다.
 */
function safeNext(value: string | null, origin: string): string {
  if (!value) return DEFAULT_NEXT;

  try {
    const resolved = new URL(value, origin);
    if (resolved.origin !== origin) return DEFAULT_NEXT;
    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return DEFAULT_NEXT;
  }
}

/**
 * 익명 세션에 이미 가입된 Google을 붙이려 하면 Supabase가
 * `identity_already_exists`를 돌려준다. 재시도해도 결과가 같으므로
 * 다른 실패와 구분해, 도착 화면이 로그인 경로를 안내하게 한다.
 */
function mapOAuthError(code: string): string {
  return code === "identity_already_exists" ? "identity_taken" : "oauth_failed";
}

function withError(request: NextRequest, next: string, reason: string): URL {
  const target = new URL(next, request.url);
  target.searchParams.set("auth_error", reason);
  return target;
}
