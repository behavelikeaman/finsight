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

/** 익명 세션의 결과를 유지한 채 Google을 연결한다. uid가 그대로 남는다. */
export async function linkGoogle(
  redirectTo: string,
): Promise<{ error?: LinkError }> {
  const supabase = createBrowserSupabase();
  const { error } = await supabase.auth.linkIdentity({
    provider: "google",
    options: { redirectTo },
  });

  // 실패해도 세션을 정리하거나 로그아웃시키지 않는다 — 현재 익명 세션과 그
  // 결과는 그대로 남아야 한다.
  if (!error) return {};

  return { error: mapLinkError(error as AuthErrorLike) };
}

/** 기존 계정으로 진입한다. 재방문자 경로. */
export async function signInGoogle(redirectTo: string): Promise<void> {
  const supabase = createBrowserSupabase();
  await supabase.auth.signInWithOAuth({
    provider: "google",
    options: { redirectTo },
  });
}

function mapLinkError(error: AuthErrorLike): LinkError {
  if (error.code === "identity_already_exists") return "identity_taken";
  if (error.code === "provider_already_linked") return "already_linked";
  return "unknown";
}
