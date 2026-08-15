import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ __kind: "admin" })),
}));

vi.mock("@supabase/supabase-js", () => ({ createClient: mocks.createClient }));

const ORIGINAL = { ...process.env };

beforeEach(() => {
  vi.resetModules();
  mocks.createClient.mockClear();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("createAdminSupabase", () => {
  it("service role 키로 클라이언트를 만든다", async () => {
    const { createAdminSupabase } = await import("./admin");

    createAdminSupabase();

    const call = mocks.createClient.mock.calls[0] as unknown as [string, string, object];
    expect(call[0]).toBe("https://proj.supabase.co");
    expect(call[1]).toBe("service-role-key");
  });

  it("세션을 저장하지 않는다 (요청 단위 사용)", async () => {
    const { createAdminSupabase } = await import("./admin");

    createAdminSupabase();

    const call = mocks.createClient.mock.calls[0] as unknown as [
      string,
      string,
      { auth: { persistSession: boolean; autoRefreshToken: boolean } },
    ];
    expect(call[2].auth.persistSession).toBe(false);
    expect(call[2].auth.autoRefreshToken).toBe(false);
  });

  it("모듈 로드 시점에 process.env를 읽지 않는다", async () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;

    // 키 없는 빌드 환경에서도 import 자체는 성공해야 한다.
    const mod = await import("./admin");

    expect(mocks.createClient).not.toHaveBeenCalled();
    expect(() => mod.createAdminSupabase()).toThrow();
  });
});
