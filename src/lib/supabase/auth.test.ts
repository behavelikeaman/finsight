import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInAnonymously: vi.fn(),
  createBrowserSupabase: vi.fn(),
}));

vi.mock("./browser", () => ({
  createBrowserSupabase: mocks.createBrowserSupabase,
}));

import { decideAuthRoute, ensureSession, isAnonymousUser } from "./auth";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "uid-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  } as User;
}

beforeEach(() => {
  mocks.getUser.mockReset();
  mocks.signInAnonymously.mockReset();
  mocks.createBrowserSupabase.mockReturnValue({
    auth: { getUser: mocks.getUser, signInAnonymously: mocks.signInAnonymously },
  });
});

describe("decideAuthRoute", () => {
  it("익명 세션에 귀속되지 않은 결과가 있으면 link", () => {
    // 여기서 signin을 고르면 새 계정이 생겨 uid가 버려지고 분석을 잃는다.
    expect(
      decideAuthRoute({ isAnonymous: true, hasPendingAnalysis: true }),
    ).toBe("link");
  });

  it("익명이지만 결과가 없으면 signin", () => {
    expect(
      decideAuthRoute({ isAnonymous: true, hasPendingAnalysis: false }),
    ).toBe("signin");
  });

  it("익명이 아니면 결과가 있어도 signin", () => {
    expect(
      decideAuthRoute({ isAnonymous: false, hasPendingAnalysis: true }),
    ).toBe("signin");
  });

  it("익명도 아니고 결과도 없으면 signin", () => {
    expect(
      decideAuthRoute({ isAnonymous: false, hasPendingAnalysis: false }),
    ).toBe("signin");
  });
});

describe("isAnonymousUser", () => {
  it("user.is_anonymous 로 판정한다", () => {
    expect(isAnonymousUser(user({ is_anonymous: true }))).toBe(true);
    expect(isAnonymousUser(user({ is_anonymous: false }))).toBe(false);
  });

  it("플래그가 없거나 사용자가 없으면 익명이 아니다", () => {
    expect(isAnonymousUser(user())).toBe(false);
    expect(isAnonymousUser(null)).toBe(false);
  });
});

describe("ensureSession", () => {
  it("이미 세션이 있으면 익명 로그인을 호출하지 않는다", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: user({ id: "existing", is_anonymous: true }) },
      error: null,
    });

    const result = await ensureSession();

    expect(mocks.signInAnonymously).not.toHaveBeenCalled();
    expect(result).toEqual({ userId: "existing", isAnonymous: true });
  });

  it("세션이 없을 때만 익명 세션을 만든다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.signInAnonymously.mockResolvedValue({
      data: { user: user({ id: "anon-1", is_anonymous: true }) },
      error: null,
    });

    const result = await ensureSession();

    expect(mocks.signInAnonymously).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ userId: "anon-1", isAnonymous: true });
  });

  it("익명 로그인이 실패하면 던진다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });
    mocks.signInAnonymously.mockResolvedValue({
      data: { user: null },
      // 대시보드에서 Anonymous Sign-Ins를 켜지 않으면 여기로 온다.
      error: { message: "Anonymous sign-ins are disabled" },
    });

    await expect(ensureSession()).rejects.toThrow();
  });

  it("로그인된(익명 아닌) 세션은 그대로 반환한다", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: user({ id: "google-1", is_anonymous: false }) },
      error: null,
    });

    await expect(ensureSession()).resolves.toEqual({
      userId: "google-1",
      isAnonymous: false,
    });
  });
});
