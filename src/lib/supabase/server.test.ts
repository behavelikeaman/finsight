import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieToSet = { name: string; value: string; options?: object };
type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: CookieToSet[]) => void;
};

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(() => ({ __kind: "server" })),
  cookies: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));

import { createServerSupabase } from "./server";

const ORIGINAL = { ...process.env };

function cookieStore(overrides: Partial<{ set: (n: string, v: string, o?: object) => void }> = {}) {
  return {
    getAll: () => [{ name: "sb-access-token", value: "token" }],
    set: overrides.set ?? vi.fn(),
  };
}

/** createServerClient에 전달된 쿠키 어댑터 */
function adapter(): CookieAdapter {
  const call = mocks.createServerClient.mock.calls[0] as unknown as [
    string,
    string,
    { cookies: CookieAdapter },
  ];
  return call[2].cookies;
}

beforeEach(() => {
  mocks.createServerClient.mockClear();
  mocks.cookies.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createServerSupabase", () => {
  it("anon 키로 createServerClient를 호출한다", async () => {
    mocks.cookies.mockResolvedValue(cookieStore());

    await createServerSupabase();

    const call = mocks.createServerClient.mock.calls[0] as unknown as [string, string, object];
    expect(call[0]).toBe("https://proj.supabase.co");
    expect(call[1]).toBe("anon-key");
  });

  it("service role 키를 쓰지 않는다", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    mocks.cookies.mockResolvedValue(cookieStore());

    await createServerSupabase();

    const call = mocks.createServerClient.mock.calls[0] ?? [];
    expect(JSON.stringify(call)).not.toContain("service-role-key");
  });

  it("getAll이 Next의 쿠키 저장소를 그대로 읽는다", async () => {
    mocks.cookies.mockResolvedValue(cookieStore());

    await createServerSupabase();

    expect(adapter().getAll()).toEqual([
      { name: "sb-access-token", value: "token" },
    ]);
  });

  it("setAll이 갱신된 쿠키를 저장소에 심는다", async () => {
    const set = vi.fn();
    mocks.cookies.mockResolvedValue(cookieStore({ set }));

    await createServerSupabase();
    adapter().setAll([
      { name: "sb-access-token", value: "new", options: { path: "/" } },
    ]);

    expect(set).toHaveBeenCalledWith("sb-access-token", "new", { path: "/" });
  });

  it("Server Component에서 쿠키 쓰기가 막혀도 던지지 않는다", async () => {
    const set = vi.fn(() => {
      throw new Error("Cookies can only be modified in a Server Action");
    });
    mocks.cookies.mockResolvedValue(cookieStore({ set }));

    await createServerSupabase();

    expect(() =>
      adapter().setAll([{ name: "sb-access-token", value: "new" }]),
    ).not.toThrow();
  });

  it("환경변수가 없으면 던진다", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    mocks.cookies.mockResolvedValue(cookieStore());

    await expect(createServerSupabase()).rejects.toThrow();
  });
});
