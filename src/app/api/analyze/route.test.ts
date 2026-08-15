import type { User } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabase: vi.fn(),
  from: vi.fn(),
}));

vi.mock("@/lib/supabase/session", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/supabase/session")>();
  return { ...actual, requireUser: mocks.requireUser };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
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

/** .select().eq().maybeSingle()/.single() 체인을 흉내낸다. then()도 지원해 await insert(...)를 그대로 받는다. */
function chain(result: { data: unknown; error: unknown }) {
  const obj: {
    select: ReturnType<typeof vi.fn>;
    insert: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    single: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => unknown;
  } = {
    select: vi.fn(() => obj),
    insert: vi.fn(() => obj),
    delete: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    single: vi.fn(() => Promise.resolve(result)),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
  };
  return obj;
}

function request(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/analyze", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

const VALID_ROW = { occurredOn: "2026-01-05", merchant: "스타벅스", amountKrw: 5500 };

function validBody(overrides: Record<string, unknown> = {}) {
  return {
    rows: [VALID_ROW],
    sourceKind: "csv",
    ...overrides,
  };
}

let insertedTransactions: unknown[] | null;
let insertedAnalysis: Record<string, unknown> | null;
let deletedAnalysisIds: unknown[];
let analysesFromCalls: number;

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.from.mockReset();
  mocks.createServerSupabase.mockResolvedValue({ from: mocks.from });
  mocks.requireUser.mockResolvedValue(user());

  insertedTransactions = null;
  insertedAnalysis = null;
  deletedAnalysisIds = [];
  analysesFromCalls = 0;

  mocks.from.mockImplementation((table: string) => {
    if (table === "analyses") {
      analysesFromCalls += 1;

      if (analysesFromCalls === 1) {
        // 중복 조회 — 기본은 "없음"
        return chain({ data: null, error: null });
      }

      // analyses 삽입
      const c = chain({ data: { id: "analysis-1" }, error: null });
      c.insert.mockImplementation((payload: Record<string, unknown>) => {
        insertedAnalysis = payload;
        return c;
      });
      c.delete.mockImplementation(() => {
        const del = chain({ data: null, error: null });
        del.eq.mockImplementation((_col: string, val: unknown) => {
          deletedAnalysisIds.push(val);
          return Promise.resolve({ data: null, error: null });
        });
        return del;
      });
      return c;
    }

    if (table === "transactions") {
      const c = chain({ data: null, error: null });
      c.insert.mockImplementation((payload: unknown[]) => {
        insertedTransactions = payload;
        return Promise.resolve({ data: null, error: null });
      });
      return c;
    }

    throw new Error(`예상치 못한 테이블: ${table}`);
  });
});

describe("POST /api/analyze", () => {
  it("미인증이면 401", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await POST(request(validBody()));

    expect(res.status).toBe(401);
  });

  it("10,001행이면 400", async () => {
    const rows = Array.from({ length: 10_001 }, (_, i) => ({
      occurredOn: "2026-01-05",
      merchant: `가맹점${i}`,
      amountKrw: 1000,
    }));

    const res = await POST(request(validBody({ rows })));

    expect(res.status).toBe(400);
  });

  it("amountKrw가 소수면 400", async () => {
    const res = await POST(
      request(validBody({ rows: [{ ...VALID_ROW, amountKrw: 5500.5 }] })),
    );

    expect(res.status).toBe(400);
  });

  it("merchant가 빈 문자열이면 400", async () => {
    const res = await POST(
      request(validBody({ rows: [{ ...VALID_ROW, merchant: "" }] })),
    );

    expect(res.status).toBe(400);
  });

  it("occurredOn 형식이 아니면 400", async () => {
    const res = await POST(
      request(validBody({ rows: [{ ...VALID_ROW, occurredOn: "2026/01/05" }] })),
    );

    expect(res.status).toBe(400);
  });

  it("rows가 배열이 아니면 400", async () => {
    const res = await POST(request(validBody({ rows: "not-an-array" })));

    expect(res.status).toBe(400);
  });

  it("정상 요청이면 ok:true와 summary를 반환하고 owner_id는 세션 uid로 채운다", async () => {
    const res = await POST(request(validBody()));
    const json = (await res.json()) as {
      ok: true;
      analysisId: string;
      summary: { totalKrw: number; rowCount: number };
    };

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(json.analysisId).toBe("analysis-1");
    expect(json.summary.totalKrw).toBe(5500);
    expect(json.summary.rowCount).toBe(1);
    expect(insertedAnalysis?.owner_id).toBe("uid-1");
  });

  it("저장된 transactions의 classification은 전부 null이다", async () => {
    await POST(request(validBody({ rows: [VALID_ROW, { ...VALID_ROW, merchant: "이디야" }] })));

    expect(insertedTransactions).toHaveLength(2);
    for (const tx of insertedTransactions as Record<string, unknown>[]) {
      expect(tx.classification).toBeNull();
      expect(tx.account_code).toBeNull();
      expect(tx.confidence).toBeNull();
      expect(tx.owner_id).toBe("uid-1");
    }
  });

  it("중복 fingerprint면 저장하지 않고 duplicate를 반환한다", async () => {
    mocks.from.mockImplementation((table: string) => {
      if (table === "analyses") {
        analysesFromCalls += 1;
        return chain({ data: { id: "existing-analysis" }, error: null });
      }
      throw new Error(`예상치 못한 테이블: ${table}`);
    });

    const res = await POST(request(validBody()));
    const json = (await res.json()) as {
      ok: false;
      reason: string;
      existingId: string;
    };

    expect(json.ok).toBe(false);
    expect(json.reason).toBe("duplicate");
    expect(json.existingId).toBe("existing-analysis");
    // analyses 조회만 있었고 insert는 없었다(같은 mock에 insert가 없으므로
    // 호출됐다면 TypeError로 테스트가 실패한다).
  });

  it("요청 본문의 owner_id는 무시된다", async () => {
    await POST(request(validBody({ owner_id: "attacker-uid" })));

    expect(insertedAnalysis?.owner_id).toBe("uid-1");
    expect(insertedAnalysis?.owner_id).not.toBe("attacker-uid");
  });
});
