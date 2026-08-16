import type { User } from "@supabase/supabase-js";

import type { Tier } from "@/types/domain";

import { createServerSupabase } from "./server";

/** 라우트 핸들러가 401로 변환한다. */
export class UnauthorizedError extends Error {
  readonly status = 401;

  constructor() {
    super("인증이 필요합니다.");
    this.name = "UnauthorizedError";
  }
}

/** 라우트 핸들러·Server Component에서 현재 사용자. 없으면 null */
export async function getCurrentUser(): Promise<User | null> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.auth.getUser();

  if (error) return null;

  return data.user ?? null;
}

/** 없으면 401을 던지는 버전. 라우트 핸들러용 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();

  if (!user) throw new UnauthorizedError();

  return user;
}

/**
 * effective_tier DB 함수를 호출한다.
 *
 * tier·current_period_end 를 가져와 애플리케이션에서 비교하지 마라. 판정이 두
 * 곳에 존재하면 반드시 어긋나고, 어긋나는 순간 게이팅이 깨진다.
 * 실패하면 free 로 닫는다 — 열어두면 비용이 그대로 나간다.
 */
export async function getEffectiveTier(userId: string): Promise<Tier> {
  const supabase = await createServerSupabase();
  const { data, error } = await supabase.rpc("effective_tier", {
    uid: userId,
  });

  if (error) return "free";

  return data === "pro" ? "pro" : "free";
}
