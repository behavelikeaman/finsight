import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IdentifiedRow } from "@/types/domain";
import { SAMPLE_SIZE } from "@/types/tier";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabase: vi.fn(),
  from: vi.fn(),
  checkQuota: vi.fn(),
  checkSampleAllowance: vi.fn(),
  consumeQuota: vi.fn(),
  markSampleUsed: vi.fn(),
  classifyTransactions: vi.fn(),
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
  checkSampleAllowance: mocks.checkSampleAllowance,
  consumeQuota: mocks.consumeQuota,
  markSampleUsed: mocks.markSampleUsed,
}));

vi.mock("@/services/anthropic/classify", () => ({
  classifyTransactions: mocks.classifyTransactions,
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

type ChainResult = { data: unknown; error: unknown };

function chain(result: ChainResult) {
  const obj: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    is: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => unknown;
  } = {
    select: vi.fn(() => obj),
    insert: vi.fn(() => obj),
    update: vi.fn(() => obj),
    delete: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    is: vi.fn(() => obj),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return obj;
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/analyses/analysis-1/classify", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function ctx(id = "analysis-1") {
  return { params: Promise.resolve({ id }) };
}

const PENDING_ROWS: { id: string; occurred_on: string; merchant: string; amount_krw: number }[] = [
  { id: "tx-1", occurred_on: "2026-01-05", merchant: "스타벅스 강남점", amount_krw: 5500 },
  { id: "tx-2", occurred_on: "2026-01-07", merchant: "이마트24", amount_krw: 12000 },
];

let analysesCalls: number;
let transactionsCalls: number;
let updateChains: ReturnType<typeof chain>[];
let pendingRowsFixture: typeof PENDING_ROWS;
let userRulesFixture: unknown[];
let analysisOwnerRow: { id: string; owner_id: string } | null;

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.from.mockReset();
  mocks.checkQuota.mockReset();
  mocks.checkSampleAllowance.mockReset();
  mocks.consumeQuota.mockReset();
  mocks.markSampleUsed.mockReset();
  mocks.classifyTransactions.mockReset();

  mocks.requireUser.mockResolvedValue(user());
  mocks.createServerSupabase.mockResolvedValue({ from: mocks.from });
  mocks.checkQuota.mockResolvedValue({ allowed: true, left: 9 });
  mocks.checkSampleAllowance.mockResolvedValue(true);
  mocks.consumeQuota.mockResolvedValue(undefined);
  mocks.markSampleUsed.mockResolvedValue(undefined);
  mocks.classifyTransactions.mockImplementation(
    async ({ rows }: { rows: IdentifiedRow[] }) =>
      rows.map((row) => ({
        id: row.id,
        classification: "business" as const,
        accountCode: "supplies" as const,
        confidence: 0.9,
      })),
  );

  analysesCalls = 0;
  transactionsCalls = 0;
  updateChains = [];
  pendingRowsFixture = PENDING_ROWS;
  userRulesFixture = [];
  analysisOwnerRow = { id: "analysis-1", owner_id: "uid-1" };

  mocks.from.mockImplementation((table: string) => {
    if (table === "analyses") {
      analysesCalls += 1;
      if (analysesCalls === 1) {
        return chain({ data: analysisOwnerRow, error: null });
      }
      // classified_at 갱신
      return chain({ data: null, error: null });
    }

    if (table === "transactions") {
      transactionsCalls += 1;
      if (transactionsCalls === 1) {
        return chain({ data: pendingRowsFixture, error: null });
      }
      const c = chain({ data: null, error: null });
      updateChains.push(c);
      return c;
    }

    if (table === "user_rules") {
      return chain({ data: userRulesFixture, error: null });
    }

    throw new Error(`예상치 못한 테이블: ${table}`);
  });
});

describe("POST /api/analyses/:id/classify", () => {
  it("미인증이면 401", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await POST(request({ mode: "full" }), ctx());

    expect(res.status).toBe(401);
  });

  it("남의 analysisId면 404", async () => {
    analysisOwnerRow = null;

    const res = await POST(request({ mode: "full" }), ctx());

    expect(res.status).toBe(404);
  });

  it("익명 + mode:'full' → anonymous_full_denied, AI 호출 없음", async () => {
    mocks.requireUser.mockResolvedValue(user({ is_anonymous: true }));

    const res = await POST(request({ mode: "full" }), ctx());
    const json = (await res.json()) as { ok: false; reason: string };

    expect(json.reason).toBe("anonymous_full_denied");
    expect(mocks.classifyTransactions).not.toHaveBeenCalled();
  });

  it("익명 + mode:'sample' + sample_used=true → sample_used, AI 호출 없음", async () => {
    mocks.requireUser.mockResolvedValue(user({ is_anonymous: true }));
    mocks.checkSampleAllowance.mockResolvedValue(false);

    const res = await POST(request({ mode: "sample" }), ctx());
    const json = (await res.json()) as { ok: false; reason: string };

    expect(json.reason).toBe("sample_used");
    expect(mocks.classifyTransactions).not.toHaveBeenCalled();
  });

  it("free + 쿼터 소진 + mode:'full' → quota_exceeded, AI 호출 없음", async () => {
    mocks.checkQuota.mockResolvedValue({ allowed: false, reason: "quota_exceeded" });

    const res = await POST(request({ mode: "full" }), ctx());
    const json = (await res.json()) as { ok: false; reason: string };

    expect(json.reason).toBe("quota_exceeded");
    expect(mocks.classifyTransactions).not.toHaveBeenCalled();
  });

  it("규칙이 전건 매칭 → fromAi === 0, AI 호출 없음", async () => {
    userRulesFixture = [
      {
        id: "rule-1",
        owner_id: "uid-1",
        merchant_pattern: "스타벅스",
        classification: "business",
        account_code: "entertainment",
        created_at: "2026-01-01T00:00:00Z",
      },
      {
        id: "rule-2",
        owner_id: "uid-1",
        merchant_pattern: "이마트",
        classification: "personal",
        account_code: null,
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    const res = await POST(request({ mode: "full" }), ctx());
    const json = (await res.json()) as { ok: true; fromAi: number; fromRules: number };

    expect(json.fromAi).toBe(0);
    expect(json.fromRules).toBe(2);
    expect(mocks.classifyTransactions).not.toHaveBeenCalled();
  });

  it("규칙 일부 매칭 → AI에 넘어간 배열이 unmatched와 일치한다", async () => {
    userRulesFixture = [
      {
        id: "rule-1",
        owner_id: "uid-1",
        merchant_pattern: "스타벅스",
        classification: "business",
        account_code: "entertainment",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    await POST(request({ mode: "full" }), ctx());

    expect(mocks.classifyTransactions).toHaveBeenCalledTimes(1);
    const [[callArg]] = mocks.classifyTransactions.mock.calls as [
      [{ rows: IdentifiedRow[] }],
    ];
    expect(callArg.rows.map((r) => r.id)).toEqual(["tx-2"]);
  });

  it("AI 호출이 실패하면 matched는 저장되고 consumeQuota는 호출되지 않는다", async () => {
    userRulesFixture = [
      {
        id: "rule-1",
        owner_id: "uid-1",
        merchant_pattern: "스타벅스",
        classification: "business",
        account_code: "entertainment",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];
    mocks.classifyTransactions.mockRejectedValue(new Error("anthropic down"));

    const res = await POST(request({ mode: "full" }), ctx());

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(mocks.consumeQuota).not.toHaveBeenCalled();
    // 규칙 매칭 건(tx-1)은 저장 시도가 있었어야 한다.
    expect(updateChains.length).toBeGreaterThan(0);
  });

  it("성공하면 consumeQuota가 1회 호출된다", async () => {
    await POST(request({ mode: "full" }), ctx());

    expect(mocks.consumeQuota).toHaveBeenCalledTimes(1);
    expect(mocks.consumeQuota).toHaveBeenCalledWith("uid-1", "classify");
    expect(mocks.markSampleUsed).not.toHaveBeenCalled();
  });

  it("mode:'sample'이면 성공 시 markSampleUsed가 호출되고 consumeQuota는 호출되지 않는다", async () => {
    await POST(request({ mode: "sample" }), ctx());

    expect(mocks.markSampleUsed).toHaveBeenCalledWith("uid-1");
    expect(mocks.consumeQuota).not.toHaveBeenCalled();
  });

  it("is_user_edited인 건은 대상에서 빠진다(classification IS NULL로 조회)", async () => {
    await POST(request({ mode: "full" }), ctx());

    const [[pendingCallTable]] = mocks.from.mock.calls as [[string]];
    expect(pendingCallTable).toBe("analyses");
    // transactions 조회 체인에서 is('classification', null) 호출을 확인한다.
    // transactionsCalls 첫 호출의 체인을 잡기 위해 from을 다시 조회할 수 없으므로
    // mocks.from.mock.results 에서 두 번째(transactions) 반환값을 찾는다.
    const txChain = (mocks.from.mock.results.find(
      (r, i) => (mocks.from.mock.calls[i]?.[0] as string) === "transactions",
    )?.value ?? null) as ReturnType<typeof chain> | null;
    expect(txChain?.is).toHaveBeenCalledWith("classification", null);
  });

  it("mode:'sample'일 때 AI에 넘어간 건이 SAMPLE_SIZE 이하다", async () => {
    pendingRowsFixture = Array.from({ length: SAMPLE_SIZE + 10 }, (_, i) => ({
      id: `tx-${i}`,
      occurred_on: "2026-01-05",
      merchant: `가맹점${i}`,
      amount_krw: 1000 + i,
    }));

    await POST(request({ mode: "sample" }), ctx());

    const [[callArg]] = mocks.classifyTransactions.mock.calls as [
      [{ rows: IdentifiedRow[] }],
    ];
    expect(callArg.rows.length).toBeLessThanOrEqual(SAMPLE_SIZE);
  });

  it("규칙이 일부만 매칭된 상태에서 AI 결과가 올바른 거래 id에 저장된다", async () => {
    userRulesFixture = [
      {
        id: "rule-1",
        owner_id: "uid-1",
        merchant_pattern: "스타벅스",
        classification: "business",
        account_code: "entertainment",
        created_at: "2026-01-01T00:00:00Z",
      },
    ];

    await POST(request({ mode: "full" }), ctx());

    // tx-2(AI 분류 대상)에 대한 update 호출이 존재하고, 그 update가 올바른
    // id·owner_id로 걸렸는지 확인한다.
    const idsUpdated = updateChains.map(
      (c) => (c.eq.mock.calls as [string, unknown][])[0]?.[1],
    );
    expect(idsUpdated).toContain("tx-2");

    const tx2Chain = updateChains.find(
      (c) => (c.eq.mock.calls as [string, unknown][])[0]?.[1] === "tx-2",
    );
    expect(tx2Chain?.eq).toHaveBeenCalledWith("owner_id", "uid-1");
  });
});
