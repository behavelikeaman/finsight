import type { User } from "@supabase/supabase-js";

import { createBrowserSupabase } from "./browser";

/**
 * 인증 경로 판정.
 *
 * 이 프로젝트의 인증 분기는 전부 이 파일에서만 한다. 다른 곳에 복제하지 마라 —
 * 판정이 갈리는 순간 사용자가 분석을 잃는다.
 */
export type AuthRoute = "link" | "signin";

/**
 * 현재 세션이 익명이고 귀속되지 않은 결과를 들고 있으면 'link', 아니면 'signin'.
 *
 * 결과가 있는데 signin(=signInWithOAuth)을 부르면 새 계정이 만들어져 uid가
 * 버려지고, 사용자가 방금 올린 분석이 통째로 사라진다.
 */
export function decideAuthRoute(params: {
  isAnonymous: boolean;
  hasPendingAnalysis: boolean;
}): AuthRoute {
  return params.isAnonymous && params.hasPendingAnalysis ? "link" : "signin";
}

/** 현재 사용자가 익명인지. user.is_anonymous 로 판정한다. */
export function isAnonymousUser(user: User | null): boolean {
  return user?.is_anonymous === true;
}

/**
 * 파일 드롭 시점에 호출한다. 이미 세션이 있으면 아무것도 하지 않는다.
 *
 * 랜딩 방문이나 미들웨어에서 부르지 마라 — 구경꾼·크롤러까지 auth.users 행을
 * 만든다.
 */
export async function ensureSession(): Promise<{
  userId: string;
  isAnonymous: boolean;
}> {
  const supabase = createBrowserSupabase();

  const { data: current } = await supabase.auth.getUser();
  if (current.user) {
    return {
      userId: current.user.id,
      isAnonymous: isAnonymousUser(current.user),
    };
  }

  const { data, error } = await supabase.auth.signInAnonymously();
  if (error || !data.user) {
    throw new Error(
      `익명 세션을 만들지 못했습니다: ${error?.message ?? "알 수 없는 오류"}. ` +
        "Supabase 대시보드에서 Anonymous Sign-Ins가 켜져 있는지 확인하세요.",
    );
  }

  return { userId: data.user.id, isAnonymous: true };
}
