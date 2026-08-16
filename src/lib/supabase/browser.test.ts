import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createBrowserClient: vi.fn(() => ({ __kind: "browser" })),
}));

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mocks.createBrowserClient,
}));

import { createBrowserSupabase } from "./browser";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  mocks.createBrowserClient.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createBrowserSupabase", () => {
  it("NEXT_PUBLIC_* 두 개만으로 createBrowserClient를 호출한다", () => {
    createBrowserSupabase();

    expect(mocks.createBrowserClient).toHaveBeenCalledWith(
      "https://proj.supabase.co",
      "anon-key",
    );
  });

  it("service role 키를 쓰지 않는다", () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";

    createBrowserSupabase();

    const args = mocks.createBrowserClient.mock.calls[0] ?? [];
    expect(JSON.stringify(args)).not.toContain("service-role-key");
  });

  it("환경변수가 없으면 던진다", () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    expect(() => createBrowserSupabase()).toThrow();
  });
});
