import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getEffectiveTier: vi.fn(),
  createServerSupabase: vi.fn(),
  createAdminSupabase: vi.fn(),
  fetchSubscription: vi.fn(),
  fetchCustomerSubscription: vi.fn(),
}));

vi.mock("@/lib/supabase/session", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/supabase/session")>();
  return {
    ...actual,
    requireUser: mocks.requireUser,
    getEffectiveTier: mocks.getEffectiveTier,
  };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: mocks.createAdminSupabase,
}));

vi.mock("@/services/polar", () => ({
  fetchSubscription: mocks.fetchSubscription,
  fetchCustomerSubscription: mocks.fetchCustomerSubscription,
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

interface ProfileRow {
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  current_period_end: string | null;
}

let profileRow: ProfileRow;
let adminTables: string[];
let adminUpdates: Record<string, unknown>[];
let adminEqCalls: [string, unknown][];

function setupServerSupabase() {
  const chain = {
    select: vi.fn(() => chain),
    eq: vi.fn(() => chain),
    maybeSingle: vi.fn(() => Promise.resolve({ data: profileRow, error: null })),
  };
  mocks.createServerSupabase.mockResolvedValue({ from: vi.fn(() => chain) });
}

function setupAdminSupabase() {
  const chain = {
    update: vi.fn((payload: Record<string, unknown>) => {
      adminUpdates.push(payload);
      return chain;
    }),
    eq: vi.fn((col: string, val: unknown) => {
      adminEqCalls.push([col, val]);
      return Promise.resolve({ data: null, error: null });
    }),
  };
  mocks.createAdminSupabase.mockReturnValue({
    from: vi.fn((table: string) => {
      adminTables.push(table);
      return chain;
    }),
  });
}

beforeEach(() => {
  for (const m of Object.values(mocks)) m.mockReset();

  profileRow = {
    polar_customer_id: null,
    polar_subscription_id: null,
    current_period_end: null,
  };
  adminTables = [];
  adminUpdates = [];
  adminEqCalls = [];

  mocks.requireUser.mockResolvedValue(user());
  mocks.getEffectiveTier.mockResolvedValue("free");
  setupServerSupabase();
  setupAdminSupabase();
});

describe("POST /api/billing/sync", () => {
  it("GET을 노출하지 않는다 — 상태를 바꾸므로 프리페치가 실행하면 안 된다", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
    expect(typeof route.POST).toBe("function");
  });

  it("미인증이면 401이고 Polar를 조회하지 않는다", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await POST();

    expect(res.status).toBe(401);
    expect(mocks.fetchSubscription).not.toHaveBeenCalled();
    expect(mocks.fetchCustomerSubscription).not.toHaveBeenCalled();
  });

  it("구독 ID를 알면 그것으로 조회하고 Pro로 갱신한다", async () => {
    profileRow.polar_subscription_id = "sub-1";
    mocks.fetchSubscription.mockResolvedValue({
      status: "active",
      currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    });
    mocks.getEffectiveTier.mockResolvedValue("pro");

    const res = await POST();
    const json = (await res.json()) as {
      tier: string;
      currentPeriodEnd: string | null;
    };

    expect(mocks.fetchSubscription).toHaveBeenCalledWith("sub-1");
    expect(json).toEqual({
      tier: "pro",
      currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    });
    expect(adminUpdates[0]).toMatchObject({
      tier: "pro",
      current_period_end: "2026-09-30T00:00:00.000Z",
    });
  });

  it("구독 ID가 없고 고객 ID만 있으면 고객으로 조회한다", async () => {
    profileRow.polar_customer_id = "cus-1";
    mocks.fetchCustomerSubscription.mockResolvedValue({
      subscriptionId: "sub-9",
      status: "active",
      currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    });

    await POST();

    expect(mocks.fetchCustomerSubscription).toHaveBeenCalledWith("cus-1");
    expect(mocks.fetchSubscription).not.toHaveBeenCalled();
    expect(adminUpdates[0]).toMatchObject({ polar_subscription_id: "sub-9" });
  });

  it("Polar 식별자가 하나도 없으면 갱신하지 않고 현재 상태를 반환한다", async () => {
    profileRow.current_period_end = null;

    const res = await POST();
    const json = (await res.json()) as { tier: string };

    expect(json.tier).toBe("free");
    expect(adminUpdates).toHaveLength(0);
    expect(mocks.createAdminSupabase).not.toHaveBeenCalled();
  });

  it("구독이 활성이 아니면 tier를 올리지 않는다", async () => {
    profileRow.polar_subscription_id = "sub-1";
    mocks.fetchSubscription.mockResolvedValue({
      status: "canceled",
      currentPeriodEnd: "2026-01-31T00:00:00.000Z",
    });

    const res = await POST();
    const json = (await res.json()) as { tier: string };

    expect(adminUpdates).toHaveLength(0);
    expect(json.tier).toBe("free");
  });

  it("admin으로 profiles의 구독 컬럼만 갱신한다", async () => {
    profileRow.polar_subscription_id = "sub-1";
    profileRow.polar_customer_id = "cus-1";
    mocks.fetchSubscription.mockResolvedValue({
      status: "active",
      currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    });

    await POST();

    expect(adminTables).toEqual(["profiles"]);
    expect(adminEqCalls).toEqual([["id", "uid-1"]]);

    const allowed = new Set([
      "tier",
      "current_period_end",
      "polar_customer_id",
      "polar_subscription_id",
    ]);
    for (const payload of adminUpdates) {
      for (const key of Object.keys(payload)) {
        expect(allowed.has(key)).toBe(true);
      }
    }
  });

  it("Polar 조회가 실패해도 502가 아니라 현재 상태를 반환한다", async () => {
    profileRow.polar_subscription_id = "sub-1";
    mocks.fetchSubscription.mockRejectedValue(new Error("polar down"));

    const res = await POST();
    const json = (await res.json()) as { tier: string };

    expect(res.status).toBe(200);
    expect(json.tier).toBe("free");
    expect(adminUpdates).toHaveLength(0);
  });
});
