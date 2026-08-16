import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabase: vi.fn(),
  createCustomerPortalSession: vi.fn(),
}));

vi.mock("@/lib/supabase/session", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/supabase/session")>();
  return { ...actual, requireUser: mocks.requireUser };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

vi.mock("@/services/polar", () => ({
  createCustomerPortalSession: mocks.createCustomerPortalSession,
}));

import { UnauthorizedError } from "@/lib/supabase/session";

import * as route from "./route";
import { POST } from "./route";

function user(): User {
  return {
    id: "uid-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    is_anonymous: false,
  } as User;
}

let profileRow: { polar_customer_id: string | null } | null;
let selectedTables: string[];
let eqCalls: [string, unknown][];

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.createServerSupabase.mockReset();
  mocks.createCustomerPortalSession.mockReset();

  profileRow = { polar_customer_id: "cus-1" };
  selectedTables = [];
  eqCalls = [];

  mocks.requireUser.mockResolvedValue(user());
  mocks.createCustomerPortalSession.mockResolvedValue({
    url: "https://polar.sh/portal?customer_session_token=cst-token",
  });

  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => {
      eqCalls.push([col, val]);
      return chain;
    }),
    maybeSingle: vi.fn(() => Promise.resolve({ data: profileRow, error: null })),
  };
  mocks.createServerSupabase.mockResolvedValue({
    from: vi.fn((table: string) => {
      selectedTables.push(table);
      return chain;
    }),
  });
});

describe("POST /api/billing/portal", () => {
  it("미인증이면 401이고 포털 세션을 만들지 않는다", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await POST();

    expect(res.status).toBe(401);
    expect(mocks.createCustomerPortalSession).not.toHaveBeenCalled();
  });

  it("포털 URL을 반환한다", async () => {
    const res = await POST();
    const json = (await res.json()) as { url: string };

    expect(res.status).toBe(200);
    expect(json.url).toBe(
      "https://polar.sh/portal?customer_session_token=cst-token",
    );
  });

  it("세션 사용자의 profiles 행에서 고객 ID를 읽는다", async () => {
    await POST();

    expect(selectedTables).toEqual(["profiles"]);
    expect(eqCalls).toEqual([["id", "uid-1"]]);
    expect(mocks.createCustomerPortalSession).toHaveBeenCalledWith("cus-1");
  });

  it("결제한 적이 없으면(고객 ID 없음) 404이고 세션을 만들지 않는다", async () => {
    profileRow = { polar_customer_id: null };

    const res = await POST();

    expect(res.status).toBe(404);
    expect(mocks.createCustomerPortalSession).not.toHaveBeenCalled();
  });

  it("profiles 행 자체가 없으면 404", async () => {
    profileRow = null;

    const res = await POST();

    expect(res.status).toBe(404);
    expect(mocks.createCustomerPortalSession).not.toHaveBeenCalled();
  });

  it("Polar 호출이 실패하면 502", async () => {
    mocks.createCustomerPortalSession.mockRejectedValue(new Error("polar down"));

    const res = await POST();

    expect(res.status).toBe(502);
  });

  it("실패 원인을 서버 로그에 남긴다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("insufficient_scope");
    mocks.createCustomerPortalSession.mockRejectedValue(cause);

    await POST();

    expect(spy).toHaveBeenCalledWith(expect.any(String), cause);
    spy.mockRestore();
  });

  it("GET을 노출하지 않는다 — 프리페치가 포털 세션을 만들면 안 된다", () => {
    expect((route as Record<string, unknown>)["GET"]).toBeUndefined();
  });
});
