import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabase: vi.fn(),
  from: vi.fn(),
  checkQuota: vi.fn(),
  consumeQuota: vi.fn(),
  askAboutLedger: vi.fn(),
}));

vi.mock("@/lib/supabase/session", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/supabase/session")>();
  return { ...actual, requireUser: mocks.requireUser };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

vi.mock("@/lib/quota", () => ({
  checkQuota: mocks.checkQuota,
  consumeQuota: mocks.consumeQuota,
}));

vi.mock("@/services/anthropic/chat", () => ({
  askAboutLedger: mocks.askAboutLedger,
}));

import { UnauthorizedError } from "@/lib/supabase/session";

import { POST } from "./route";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "uid-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    is_anonymous: false,
    ...overrides,
  } as User;
}

function chain(result: { data: unknown; error: unknown }) {
  const obj: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    order: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (resolve: (v: unknown) => unknown) => unknown;
  } = {
    select: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    order: vi.fn(() => obj),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/analyses/analysis-1/chat", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function ctx(id = "analysis-1") {
  return { params: Promise.resolve({ id }) };
}

const TX_ROWS = [
  { id: "tx-1", occurred_on: "2026-01-05", merchant: "스타벅스", amount_krw: 5500 },
  { id: "tx-2", occurred_on: "2026-01-07", merchant: "이마트24", amount_krw: 12000 },
];

let analysisOwnerRow: { id: string; owner_id: string } | null;
let txRowsFixture: typeof TX_ROWS;
let orderChain: ReturnType<typeof chain> | undefined;

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.from.mockReset();
  mocks.checkQuota.mockReset();
  mocks.consumeQuota.mockReset();
  mocks.askAboutLedger.mockReset();

  mocks.requireUser.mockResolvedValue(user());
  mocks.createServerSupabase.mockResolvedValue({ from: mocks.from });
  mocks.checkQuota.mockResolvedValue({ allowed: true, left: 100 });
  mocks.consumeQuota.mockResolvedValue(undefined);
  mocks.askAboutLedger.mockResolvedValue("답변입니다.");

  analysisOwnerRow = { id: "analysis-1", owner_id: "uid-1" };
  txRowsFixture = TX_ROWS;
  orderChain = undefined;

  let analysesCalls = 0;
  mocks.from.mockImplementation((table: string) => {
    if (table === "analyses") {
      analysesCalls += 1;
      return chain({ data: analysisOwnerRow, error: null });
    }

    if (table === "transactions") {
      const c = chain({ data: txRowsFixture, error: null });
      orderChain = c;
      return c;
    }

    throw new Error(`예상치 못한 테이블: ${table} (analyses calls=${analysesCalls})`);
  });
});

describe("POST /api/analyses/:id/chat", () => {
  it("미인증이면 401", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await POST(request({ question: "질문" }), ctx());

    expect(res.status).toBe(401);
  });

  it("남의 analysisId면 404", async () => {
    analysisOwnerRow = null;

    const res = await POST(request({ question: "질문" }), ctx());

    expect(res.status).toBe(404);
  });

  it("free 티어(tier_required)면 거부하고 Anthropic을 호출하지 않는다", async () => {
    mocks.checkQuota.mockResolvedValue({ allowed: false, reason: "tier_required" });

    const res = await POST(request({ question: "질문" }), ctx());
    const json = (await res.json()) as { ok: false; reason: string };

    expect(json.reason).toBe("tier_required");
    expect(mocks.askAboutLedger).not.toHaveBeenCalled();
  });

  it("Pro + 쿼터 소진(quota_exceeded)이면 거부하고 Anthropic을 호출하지 않는다", async () => {
    mocks.checkQuota.mockResolvedValue({ allowed: false, reason: "quota_exceeded" });

    const res = await POST(request({ question: "질문" }), ctx());
    const json = (await res.json()) as { ok: false; reason: string };

    expect(json.reason).toBe("quota_exceeded");
    expect(mocks.askAboutLedger).not.toHaveBeenCalled();
  });

  it("빈 질문이면 400", async () => {
    const res = await POST(request({ question: "   " }), ctx());

    expect(res.status).toBe(400);
    expect(mocks.askAboutLedger).not.toHaveBeenCalled();
  });

  it("성공하면 consumeQuota가 1회 호출되고 answer를 반환한다", async () => {
    const res = await POST(request({ question: "지난달 접대비 얼마?" }), ctx());
    const json = (await res.json()) as { ok: true; answer: string; quotaLeft: number };

    expect(mocks.consumeQuota).toHaveBeenCalledTimes(1);
    expect(mocks.consumeQuota).toHaveBeenCalledWith("uid-1", "chat");
    expect(json.answer).toBe("답변입니다.");
    expect(json.quotaLeft).toBe(99);
  });

  it("Anthropic 호출이 실패하면 consumeQuota가 호출되지 않는다", async () => {
    mocks.askAboutLedger.mockRejectedValue(new Error("anthropic down"));

    const res = await POST(request({ question: "질문" }), ctx());

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mocks.consumeQuota).not.toHaveBeenCalled();
  });

  it("거래 조회에 order by가 명시된다", async () => {
    await POST(request({ question: "질문" }), ctx());

    expect(orderChain?.order).toHaveBeenCalled();
  });

  it("같은 분석에 두 번 질의해도 askAboutLedger에 넘어간 거래 배열 순서가 같다", async () => {
    await POST(request({ question: "질문1" }), ctx());
    await POST(request({ question: "질문2" }), ctx());

    const [[rows1]] = mocks.askAboutLedger.mock.calls as [[unknown, string]];
    const [, [rows2]] = mocks.askAboutLedger.mock.calls as [
      unknown,
      [unknown, string],
    ];
    expect(rows1).toEqual(rows2);
  });
});
