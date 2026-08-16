import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  PolarCtor: vi.fn(),
  checkoutsCreate: vi.fn(),
  subscriptionsGet: vi.fn(),
  subscriptionsList: vi.fn(),
  customerSessionsCreate: vi.fn(),
}));

vi.mock("@polar-sh/sdk", () => ({
  Polar: mocks.PolarCtor,
}));

import {
  createCheckout,
  createCustomerPortalSession,
  fetchCustomerSubscription,
  fetchSubscription,
} from "./polar";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  mocks.PolarCtor.mockReset();
  mocks.checkoutsCreate.mockReset();
  mocks.subscriptionsGet.mockReset();
  mocks.subscriptionsList.mockReset();
  mocks.customerSessionsCreate.mockReset();

  mocks.PolarCtor.mockImplementation(() => ({
    checkouts: { create: mocks.checkoutsCreate },
    subscriptions: { get: mocks.subscriptionsGet, list: mocks.subscriptionsList },
    customerSessions: { create: mocks.customerSessionsCreate },
  }));

  mocks.checkoutsCreate.mockResolvedValue({
    id: "checkout-1",
    url: "https://polar.sh/checkout/checkout-1",
  });

  process.env.POLAR_ACCESS_TOKEN = "polar_test_token";
  process.env.POLAR_PRO_PRODUCT_ID = "prod-pro";
  process.env.POLAR_SERVER = "sandbox";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("createCheckout", () => {
  it("체크아웃 URL을 반환한다", async () => {
    const result = await createCheckout({
      userId: "uid-1",
      successUrl: "https://app.example.com/dashboard",
    });

    expect(result).toEqual({ url: "https://polar.sh/checkout/checkout-1" });
  });

  it("metadata.userId를 넣는다 — 웹훅이 사용자를 식별하는 근거다", async () => {
    await createCheckout({
      userId: "uid-1",
      successUrl: "https://app.example.com/dashboard",
    });

    const arg = mocks.checkoutsCreate.mock.calls[0]?.[0] as {
      metadata?: Record<string, unknown>;
    };
    expect(arg.metadata).toEqual({ userId: "uid-1" });
  });

  it("POLAR_PRO_PRODUCT_ID와 successUrl을 전달한다", async () => {
    await createCheckout({
      userId: "uid-1",
      successUrl: "https://app.example.com/dashboard?checkout_id=x",
    });

    const arg = mocks.checkoutsCreate.mock.calls[0]?.[0] as {
      products?: string[];
      successUrl?: string;
    };
    expect(arg.products).toEqual(["prod-pro"]);
    expect(arg.successUrl).toBe("https://app.example.com/dashboard?checkout_id=x");
  });

  it("email이 있으면 customerEmail로 넘긴다", async () => {
    await createCheckout({
      userId: "uid-1",
      email: "user@example.com",
      successUrl: "https://app.example.com/dashboard",
    });

    const arg = mocks.checkoutsCreate.mock.calls[0]?.[0] as {
      customerEmail?: string | null;
    };
    expect(arg.customerEmail).toBe("user@example.com");
  });

  it("POLAR_SERVER=sandbox 면 sandbox 서버로 클라이언트를 만든다", async () => {
    await createCheckout({
      userId: "uid-1",
      successUrl: "https://app.example.com/dashboard",
    });

    expect(mocks.PolarCtor).toHaveBeenCalledWith({
      accessToken: "polar_test_token",
      server: "sandbox",
    });
  });

  it("POLAR_SERVER=production 이면 production 서버로 만든다", async () => {
    process.env.POLAR_SERVER = "production";

    await createCheckout({
      userId: "uid-1",
      successUrl: "https://app.example.com/dashboard",
    });

    expect(mocks.PolarCtor).toHaveBeenCalledWith({
      accessToken: "polar_test_token",
      server: "production",
    });
  });

  it("토큰이 없으면 호출 시점에 던진다(모듈 로드 시점이 아니라)", async () => {
    delete process.env.POLAR_ACCESS_TOKEN;

    await expect(
      createCheckout({
        userId: "uid-1",
        successUrl: "https://app.example.com/dashboard",
      }),
    ).rejects.toThrow();
  });
});

describe("fetchSubscription", () => {
  it("status와 currentPeriodEnd(ISO)를 반환한다", async () => {
    mocks.subscriptionsGet.mockResolvedValue({
      id: "sub-1",
      status: "active",
      currentPeriodEnd: new Date("2026-09-30T00:00:00.000Z"),
    });

    const result = await fetchSubscription("sub-1");

    expect(mocks.subscriptionsGet).toHaveBeenCalledWith({ id: "sub-1" });
    expect(result).toEqual({
      status: "active",
      currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    });
  });

  it("currentPeriodEnd가 없으면 null을 유지한다", async () => {
    mocks.subscriptionsGet.mockResolvedValue({
      id: "sub-1",
      status: "canceled",
      currentPeriodEnd: null,
    });

    const result = await fetchSubscription("sub-1");

    expect(result).toEqual({ status: "canceled", currentPeriodEnd: null });
  });
});

describe("fetchCustomerSubscription", () => {
  it("활성 구독이 있으면 id·status·기간종료를 반환한다", async () => {
    mocks.subscriptionsList.mockResolvedValue({
      result: {
        items: [
          {
            id: "sub-1",
            status: "active",
            currentPeriodEnd: new Date("2026-09-30T00:00:00.000Z"),
          },
        ],
      },
    });

    const result = await fetchCustomerSubscription("cus-1");

    expect(mocks.subscriptionsList).toHaveBeenCalledWith({
      customerId: "cus-1",
      active: true,
    });
    expect(result).toEqual({
      subscriptionId: "sub-1",
      status: "active",
      currentPeriodEnd: "2026-09-30T00:00:00.000Z",
    });
  });

  it("활성 구독이 없으면 null", async () => {
    mocks.subscriptionsList.mockResolvedValue({ result: { items: [] } });

    expect(await fetchCustomerSubscription("cus-1")).toBeNull();
  });
});

describe("createCustomerPortalSession", () => {
  it("고객 포털 URL을 반환한다", async () => {
    mocks.customerSessionsCreate.mockResolvedValue({
      token: "cst-token",
      customerPortalUrl: "https://polar.sh/portal?customer_session_token=cst-token",
    });

    const result = await createCustomerPortalSession("cus-1");

    expect(mocks.customerSessionsCreate).toHaveBeenCalledWith({
      customerId: "cus-1",
    });
    expect(result).toEqual({
      url: "https://polar.sh/portal?customer_session_token=cst-token",
    });
  });

  it("토큰이 없으면 호출 시점에 던진다(모듈 로드 시점이 아니라)", async () => {
    delete process.env.POLAR_ACCESS_TOKEN;

    await expect(createCustomerPortalSession("cus-1")).rejects.toThrow();
  });
});
