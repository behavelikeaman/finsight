import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createCheckout: vi.fn(),
}));

vi.mock("@/lib/supabase/session", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/supabase/session")>();
  return { ...actual, requireUser: mocks.requireUser };
});

vi.mock("@/services/polar", () => ({
  createCheckout: mocks.createCheckout,
}));

import { UnauthorizedError } from "@/lib/supabase/session";

import { POST } from "./route";

const ORIGINAL_ENV = { ...process.env };

function user(overrides: Partial<User> = {}): User {
  return {
    id: "uid-1",
    email: "user@example.com",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    is_anonymous: false,
    ...overrides,
  } as User;
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost:3000/api/billing/checkout", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.createCheckout.mockReset();

  mocks.requireUser.mockResolvedValue(user());
  mocks.createCheckout.mockResolvedValue({
    url: "https://polar.sh/checkout/abc",
  });

  process.env.NEXT_PUBLIC_SITE_URL = "https://finsight.example.com";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("POST /api/billing/checkout", () => {
  it("미인증이면 401이고 체크아웃을 만들지 않는다", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await POST(request({ plan: "pro" }));

    expect(res.status).toBe(401);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("plan이 'pro'가 아니면 400", async () => {
    const res = await POST(request({ plan: "enterprise" }));

    expect(res.status).toBe(400);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("체크아웃 URL을 반환한다", async () => {
    const res = await POST(request({ plan: "pro" }));
    const json = (await res.json()) as { url: string };

    expect(res.status).toBe(200);
    expect(json.url).toBe("https://polar.sh/checkout/abc");
  });

  it("세션 사용자 id를 넘긴다 — 클라이언트가 보낸 값이 아니다", async () => {
    await POST(request({ plan: "pro", userId: "attacker-uid" }));

    const arg = mocks.createCheckout.mock.calls[0]?.[0] as { userId: string };
    expect(arg.userId).toBe("uid-1");
  });

  it("successUrl은 NEXT_PUBLIC_SITE_URL 기준이며 체크아웃 식별자를 붙인다", async () => {
    await POST(request({ plan: "pro" }));

    const arg = mocks.createCheckout.mock.calls[0]?.[0] as {
      successUrl: string;
    };
    expect(arg.successUrl).toContain("https://finsight.example.com/dashboard");
    expect(arg.successUrl).toContain("{CHECKOUT_ID}");
  });

  it("세션 이메일을 넘긴다", async () => {
    await POST(request({ plan: "pro" }));

    const arg = mocks.createCheckout.mock.calls[0]?.[0] as { email?: string };
    expect(arg.email).toBe("user@example.com");
  });

  it("NEXT_PUBLIC_SITE_URL이 없으면 500", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;

    const res = await POST(request({ plan: "pro" }));

    expect(res.status).toBe(500);
    expect(mocks.createCheckout).not.toHaveBeenCalled();
  });

  it("Polar 호출이 실패하면 502", async () => {
    mocks.createCheckout.mockRejectedValue(new Error("polar down"));

    const res = await POST(request({ plan: "pro" }));

    expect(res.status).toBe(502);
  });

  // 원인을 삼키면 502만 남는다. 토큰 스코프 부족·상품 오설정 같은 설정
  // 문제를 서버 로그 없이 추적하게 되고, 실제로 그렇게 헤맸다.
  it("실패 원인을 서버 로그에 남긴다", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const cause = new Error("insufficient_scope");
    mocks.createCheckout.mockRejectedValue(cause);

    await POST(request({ plan: "pro" }));

    expect(spy).toHaveBeenCalledWith(expect.any(String), cause);
    spy.mockRestore();
  });
});
