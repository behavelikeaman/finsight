import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getUser: vi.fn(),
  rpc: vi.fn(),
  createServerSupabase: vi.fn(),
}));

vi.mock("./server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

import {
  UnauthorizedError,
  getCurrentUser,
  getEffectiveTier,
  requireUser,
} from "./session";

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
  mocks.rpc.mockReset();
  mocks.createServerSupabase.mockResolvedValue({
    auth: { getUser: mocks.getUser },
    rpc: mocks.rpc,
  });
});

describe("getCurrentUser", () => {
  it("세션이 있으면 사용자를 반환한다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: user() }, error: null });

    await expect(getCurrentUser()).resolves.toMatchObject({ id: "uid-1" });
  });

  it("세션이 없으면 null", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(getCurrentUser()).resolves.toBeNull();
  });

  it("에러여도 던지지 않고 null", async () => {
    mocks.getUser.mockResolvedValue({
      data: { user: null },
      error: { message: "invalid token" },
    });

    await expect(getCurrentUser()).resolves.toBeNull();
  });
});

describe("requireUser", () => {
  it("세션이 있으면 사용자를 반환한다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: user() }, error: null });

    await expect(requireUser()).resolves.toMatchObject({ id: "uid-1" });
  });

  it("미인증이면 401로 던진다", async () => {
    mocks.getUser.mockResolvedValue({ data: { user: null }, error: null });

    await expect(requireUser()).rejects.toBeInstanceOf(UnauthorizedError);
    await expect(requireUser()).rejects.toMatchObject({ status: 401 });
  });
});

describe("getEffectiveTier", () => {
  it("effective_tier RPC를 호출한다", async () => {
    mocks.rpc.mockResolvedValue({ data: "pro", error: null });

    await expect(getEffectiveTier("uid-1")).resolves.toBe("pro");
    expect(mocks.rpc).toHaveBeenCalledWith("effective_tier", { uid: "uid-1" });
  });

  it("free를 그대로 반환한다", async () => {
    mocks.rpc.mockResolvedValue({ data: "free", error: null });

    await expect(getEffectiveTier("uid-1")).resolves.toBe("free");
  });

  it("RPC가 실패하면 free로 닫는다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(getEffectiveTier("uid-1")).resolves.toBe("free");
  });

  it("profiles를 직접 읽어 기간을 비교하지 않는다", async () => {
    const from = vi.fn();
    mocks.createServerSupabase.mockResolvedValue({
      auth: { getUser: mocks.getUser },
      rpc: mocks.rpc,
      from,
    });
    mocks.rpc.mockResolvedValue({ data: "pro", error: null });

    await getEffectiveTier("uid-1");

    // 판정이 두 곳에 있으면 반드시 어긋난다. 판정은 DB 함수 한 곳에만 존재한다.
    expect(from).not.toHaveBeenCalled();
  });
});
