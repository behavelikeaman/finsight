/**
 * 인증의 두 경로를 실제로 수행한다.
 *
 * 어느 경로를 탈지는 이 파일이 정하지 않는다 — auth.ts의 decideAuthRoute가
 * 정하고, 호출부가 그 결과에 따라 이 파일의 함수를 부른다.
 *
 * supabase.auth.linkIdentity·signInWithOAuth를 직접 호출하는 코드를 이 파일
 * 밖에 두지 마라. 익명 세션에 결과가 있는데 signInWithOAuth를 부르면 새
 * 계정이 생겨 uid가 버려지고 사용자가 분석을 잃는다.
 */
import { createBrowserSupabase } from "./browser";

export type LinkError = "already_linked" | "identity_taken" | "unknown";

interface AuthErrorLike {
  code?: string;
  message: string;
}

/**
 * OAuth 제공자가 브라우저를 돌려보낼 절대 URL.
 *
 * 앱 경로(`/dashboard/:id`)를 Supabase에 그대로 넘기면 안 된다 — 상대 경로는
 * 처리되지 않아 Site URL로 폴백하고, code가 교환되지 않은 채 랜딩에 남는다.
 * 반드시 code를 세션으로 바꾸는 `/auth/callback`을 거치게 하고, 돌아갈 앱
 * 경로는 next로 실어 보낸다.
 */
export function buildCallbackUrl(origin: string, next: string): string {
  return `${origin}/auth/callback?next=${encodeURIComponent(next)}`;
}

/**
 * OAuth 실패 사유를 URL 프래그먼트에서 읽는다.
 *
 * Supabase는 연결 실패를 쿼리가 아니라 `#error=...&error_code=...`로 붙여
 * 보낸다. 프래그먼트는 서버로 전송되지 않으므로 `/auth/callback`은 이 값을
 * 볼 수 없고, 코드 누락과 구분하지 못한 채 되돌린다. 브라우저에서 다시 읽어
 * 실제 사유를 복구해야 사용자에게 다음 행동을 안내할 수 있다.
 */
export function parseOAuthErrorFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const code = params.get("error_code");

  if (!code && !params.get("error")) return null;

  return code === "identity_already_exists" ? "identity_taken" : "oauth_failed";
}

/** 익명 세션의 결과를 유지한 채 Google을 연결한다. uid가 그대로 남는다. */
export async function linkGoogle(
  next: string,
): Promise<{ error?: LinkError }> {
  const supabase = createBrowserSupabase();
  const { error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: { redirectTo: buildCallbackUrl(window.location.origin, next) },
  });

  // 실패해도 세션을 정리하거나 로그아웃시키지 않는다 — 현재 익명 세션과 그
  // 결과는 그대로 남아야 한다.
  if (!error) return {};

  return { error: mapLinkError(error as AuthErrorLike) };
}

/** 기존 계정으로 진입한다. 재방문자 경로. */
export async function signInGoogle(next: string): Promise<void> {
  const supabase = createBrowserSupabase();
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo: buildCallbackUrl(window.location.origin, next) },
  });
}

function mapLinkError(error: AuthErrorLike): LinkError {
  if (error.code === "identity_already_exists") return "identity_taken";
  if (error.code === "provider_already_linked") return "already_linked";
  return "unknown";
}
