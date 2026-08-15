import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  validateEvent: vi.fn(),
  createAdminSupabase: vi.fn(),
}));

vi.mock("@polar-sh/sdk/webhooks", () => ({
  validateEvent: mocks.validateEvent,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: mocks.createAdminSupabase,
}));

import { POST } from "./route";

const ORIGINAL_ENV = { ...process.env };

let adminTables: string[];
let adminUpdates: Record<string, unknown>[];
let adminEqCalls: [string, unknown][];
let lookupResult: { id: string } | null;

function setupAdmin() {
  const chain = {
    update: vi.fn((payload: Record<string, unknown>) => {
      adminUpdates.push(payload);
      return chain;
    }),
    select: vi.fn(() => chain),
    eq: vi.fn((col: string, val: unknown) => {
      adminEqCalls.push([col, val]);
      return chain;
    }),
    maybeSingle: vi.fn(() =>
      Promise.resolve({ data: lookupResult, error: null }),
    ),
    then: (resolve: (v: unknown) => unknown) =>
      Promise.resolve({ data: null, error: null }).then(resolve),
  };

  mocks.createAdminSupabase.mockReturnValue({
    from: vi.fn((table: string) => {
      adminTables.push(table);
      return chain;
    }),
  });
}

function request(body = "{}"): NextRequest {
  return new NextRequest("http://localhost:3000/api/webhooks/polar", {
    method: "POST",
    headers: {
      "webhook-id": "msg-1",
      "webhook-timestamp": "1700000000",
      "webhook-signature": "v1,sig",
    },
    body,
  });
}

function subscriptionEvent(
  type: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    type,
    data: {
      id: "sub-1",
      status: "active",
      currentPeriodEnd: new Date("2026-09-30T00:00:00.000Z"),
      customerId: "cus-1",
      metadata: { userId: "uid-1" },
      ...overrides,
    },
  };
}

beforeEach(() => {
  mocks.validateEvent.mockReset();
  mocks.createAdminSupabase.mockReset();

  adminTables = [];
  adminUpdates = [];
  adminEqCalls = [];
  lookupResult = null;

  setupAdmin();
  process.env.POLAR_WEBHOOK_SECRET = "whsec_test";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/webhooks/polar — 서명 검증", () => {
  it("서명이 틀리면 401이고 DB 갱신이 일어나지 않는다", async () => {
    mocks.validateEvent.mockImplementation(() => {
      throw new Error("invalid signature");
    });

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(mocks.createAdminSupabase).not.toHaveBeenCalled();
    expect(adminUpdates).toHaveLength(0);
  });

  it("검증이 이벤트 처리보다 먼저다 — 시크릿이 없으면 401", async () => {
    delete process.env.POLAR_WEBHOOK_SECRET;

    const res = await POST(request());

    expect(res.status).toBe(401);
    expect(mocks.createAdminSupabase).not.toHaveBeenCalled();
  });

  it("POLAR_WEBHOOK_SECRET으로 원본 본문을 검증한다", async () => {
    mocks.validateEvent.mockReturnValue(subscriptionEvent("subscription.created"));

    await POST(request('{"type":"subscription.created"}'));

    const [body, headers, secret] = mocks.validateEvent.mock.calls[0] as [
      string,
      Record<string, string>,
      string,
    ];
    expect(body).toBe('{"type":"subscription.created"}');
    expect(headers["webhook-signature"]).toBe("v1,sig");
    expect(secret).toBe("whsec_test");
  });
});

describe("POST /api/webhooks/polar — 상태 반영", () => {
  it("활성 구독이면 tier를 pro로 갱신한다", async () => {
    mocks.validateEvent.mockReturnValue(subscriptionEvent("subscription.created"));

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(adminUpdates[0]).toEqual({
      tier: "pro",
      current_period_end: "2026-09-30T00:00:00.000Z",
      polar_customer_id: "cus-1",
      polar_subscription_id: "sub-1",
    });
    expect(adminEqCalls).toEqual([["id", "uid-1"]]);
  });

  it("같은 이벤트를 두 번 처리해도 결과가 같다(멱등)", async () => {
    mocks.validateEvent.mockReturnValue(subscriptionEvent("subscription.updated"));

    await POST(request());
    await POST(request());

    expect(adminUpdates).toHaveLength(2);
    expect(adminUpdates[0]).toEqual(adminUpdates[1]);
  });

  it("취소 이벤트여도 status가 active면 즉시 free로 내리지 않는다", async () => {
    mocks.validateEvent.mockReturnValue(
      subscriptionEvent("subscription.canceled", {
        status: "active",
        cancelAtPeriodEnd: true,
      }),
    );

    await POST(request());

    expect(adminUpdates[0]).toMatchObject({
      tier: "pro",
      current_period_end: "2026-09-30T00:00:00.000Z",
    });
  });

  it("만료(revoked)면 free로 내리되 current_period_end를 지우지 않는다", async () => {
    mocks.validateEvent.mockReturnValue(
      subscriptionEvent("subscription.revoked", {
        status: "canceled",
        currentPeriodEnd: null,
      }),
    );

    await POST(request());

    expect(adminUpdates[0]).toMatchObject({ tier: "free" });
    expect(adminUpdates[0]).not.toHaveProperty("current_period_end");
  });

  it("결제 실패(past_due)면 free로 판정한다", async () => {
    mocks.validateEvent.mockReturnValue(
      subscriptionEvent("subscription.updated", { status: "past_due" }),
    );

    await POST(request());

    expect(adminUpdates[0]).toMatchObject({ tier: "free" });
  });

  it("metadata가 없으면 polar_customer_id로 사용자를 찾는다", async () => {
    lookupResult = { id: "uid-2" };
    mocks.validateEvent.mockReturnValue(
      subscriptionEvent("subscription.created", { metadata: {} }),
    );

    await POST(request());

    expect(adminEqCalls).toContainEqual(["polar_customer_id", "cus-1"]);
    expect(adminEqCalls).toContainEqual(["id", "uid-2"]);
  });

  it("사용자를 찾지 못하면 갱신 없이 200", async () => {
    lookupResult = null;
    mocks.validateEvent.mockReturnValue(
      subscriptionEvent("subscription.created", { metadata: {} }),
    );

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(adminUpdates).toHaveLength(0);
  });

  it("구독 이벤트가 아니면 아무것도 갱신하지 않는다", async () => {
    mocks.validateEvent.mockReturnValue({
      type: "order.paid",
      data: { id: "order-1" },
    });

    const res = await POST(request());

    expect(res.status).toBe(200);
    expect(adminUpdates).toHaveLength(0);
  });
});

describe("POST /api/webhooks/polar — admin 사용 범위", () => {
  it("profiles 외의 테이블을 건드리지 않는다", async () => {
    lookupResult = { id: "uid-2" };
    mocks.validateEvent.mockReturnValue(
      subscriptionEvent("subscription.created", { metadata: {} }),
    );

    await POST(request());

    expect(new Set(adminTables)).toEqual(new Set(["profiles"]));
    expect(adminTables).not.toContain("usage_counters");
    expect(adminTables).not.toContain("transactions");
    expect(adminTables).not.toContain("analyses");
  });

  it("구독 관련 컬럼만 갱신한다", async () => {
    mocks.validateEvent.mockReturnValue(subscriptionEvent("subscription.active"));

    await POST(request());

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

  it("카운터를 증가시키지 않는다 — rpc를 호출하지 않는다", async () => {
    mocks.validateEvent.mockReturnValue(subscriptionEvent("subscription.created"));

    await POST(request());

    const client = mocks.createAdminSupabase.mock.results[0]?.value as Record<
      string,
      unknown
    >;
    expect(client.rpc).toBeUndefined();
  });
});
