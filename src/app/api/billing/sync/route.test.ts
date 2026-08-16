import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  getEffectiveTier: vi.fn(),
  createServerSupabase: vi.fn(),
  createAdminSupabase: vi.fn(),
  fetchSubscription: vi.fn(),
  fetchCustomerSubscription: vi.fn(),
  fetchCheckout: vi.fn(),
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
  fetchCheckout: mocks.fetchCheckout,
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

function request(body?: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/billing/sync", {
    method: "POST",
    ...(body === undefined
      ? {}
      : {
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
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

// 첫 결제 직후에는 profiles의 polar_* 가 전부 비어 있다. 그 값은 웹훅이
// 채우기 때문이다. 그래서 복귀 URL로 받은 checkoutId 가 유일한 실마리다.
describe("POST /api/billing/sync — 첫 결제(checkoutId)", () => {
  beforeEach(() => {
    mocks.fetchCheckout.mockResolvedValue({
      status: "succeeded",
      customerId: "cus-1",
      subscriptionId: null,
      userId: "uid-1",
    });
    mocks.fetchCustomerSubscription.mockResolvedValue({
      subscriptionId: "sub-1",
      status: "trialing",
      currentPeriodEnd: "2026-08-23T07:33:26.163Z",
    });
  });

  it("polar_* 가 전부 비어 있어도 체크아웃으로 Pro가 된다", async () => {
    mocks.getEffectiveTier.mockResolvedValue("pro");

    const res = await POST(request({ checkoutId: "chk-1" }));
    const json = (await res.json()) as { tier: string };

    expect(mocks.fetchCheckout).toHaveBeenCalledWith("chk-1");
    expect(json.tier).toBe("pro");
    expect(adminUpdates[0]).toMatchObject({
      tier: "pro",
      subscription_status: "trialing",
      current_period_end: "2026-08-23T07:33:26.163Z",
      polar_subscription_id: "sub-1",
    });
  });

  it("웹훅이 채우던 고객 ID도 함께 기록한다", async () => {
    await POST(request({ checkoutId: "chk-1" }));

    expect(adminUpdates[0]).toMatchObject({ polar_customer_id: "cus-1" });
  });

  // 여기가 뚫리면 남의 체크아웃 ID를 주워 자기 계정을 Pro로 만들 수 있다.
  it("남의 체크아웃이면 403이고 아무것도 갱신하지 않는다", async () => {
    mocks.fetchCheckout.mockResolvedValue({
      status: "succeeded",
      customerId: "cus-9",
      subscriptionId: "sub-9",
      userId: "attacker-victim-uid",
    });

    const res = await POST(request({ checkoutId: "chk-9" }));

    expect(res.status).toBe(403);
    expect(adminUpdates).toHaveLength(0);
    expect(mocks.fetchCustomerSubscription).not.toHaveBeenCalled();
  });

  it("소유자를 알 수 없는 체크아웃도 거부한다", async () => {
    mocks.fetchCheckout.mockResolvedValue({
      status: "succeeded",
      customerId: "cus-9",
      subscriptionId: null,
      userId: null,
    });

    const res = await POST(request({ checkoutId: "chk-9" }));

    expect(res.status).toBe(403);
    expect(adminUpdates).toHaveLength(0);
  });

  it("아직 결제가 끝나지 않았으면 갱신하지 않는다", async () => {
    mocks.fetchCheckout.mockResolvedValue({
      status: "open",
      customerId: null,
      subscriptionId: null,
      userId: "uid-1",
    });

    const res = await POST(request({ checkoutId: "chk-1" }));

    expect(res.status).toBe(200);
    expect(adminUpdates).toHaveLength(0);
  });

  it("구독 ID가 실려 오면 그것으로 바로 조회한다", async () => {
    mocks.fetchCheckout.mockResolvedValue({
      status: "succeeded",
      customerId: "cus-1",
      subscriptionId: "sub-1",
      userId: "uid-1",
    });
    mocks.fetchSubscription.mockResolvedValue({
      status: "active",
      currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    });

    await POST(request({ checkoutId: "chk-1" }));

    expect(mocks.fetchSubscription).toHaveBeenCalledWith("sub-1");
    expect(mocks.fetchCustomerSubscription).not.toHaveBeenCalled();
  });

  it("체크아웃 조회가 실패해도 500으로 무너지지 않는다", async () => {
    mocks.fetchCheckout.mockRejectedValue(new Error("polar down"));

    const res = await POST(request({ checkoutId: "chk-1" }));

    expect(res.status).toBe(200);
  });

  it("본문이 없어도 기존 경로가 그대로 동작한다", async () => {
    profileRow.polar_subscription_id = "sub-1";
    mocks.fetchSubscription.mockResolvedValue({
      status: "active",
      currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(mocks.fetchCheckout).not.toHaveBeenCalled();
    expect(mocks.fetchSubscription).toHaveBeenCalledWith("sub-1");
  });
});

describe("POST /api/billing/sync", () => {
  it("GET을 노출하지 않는다 — 상태를 바꾸므로 프리페치가 실행하면 안 된다", () => {
    expect((route as Record<string, unknown>).GET).toBeUndefined();
    expect(typeof route.POST).toBe("function");
  });

  it("미인증이면 401이고 Polar를 조회하지 않는다", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await POST(request());

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

    const res = await POST(request());
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

    await POST(request());

    expect(mocks.fetchCustomerSubscription).toHaveBeenCalledWith("cus-1");
    expect(mocks.fetchSubscription).not.toHaveBeenCalled();
    expect(adminUpdates[0]).toMatchObject({ polar_subscription_id: "sub-9" });
  });

  it("Polar 식별자가 하나도 없으면 갱신하지 않고 현재 상태를 반환한다", async () => {
    profileRow.current_period_end = null;

    const res = await POST(request());
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

    const res = await POST(request());
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

    await POST(request());

    expect(adminTables).toEqual(["profiles"]);
    expect(adminEqCalls).toEqual([["id", "uid-1"]]);

    const allowed = new Set([
      "tier",
      "subscription_status",
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

    const res = await POST(request());
    const json = (await res.json()) as { tier: string };

    expect(res.status).toBe(200);
    expect(json.tier).toBe("free");
    expect(adminUpdates).toHaveLength(0);
  });
});
