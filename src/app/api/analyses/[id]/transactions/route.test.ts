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

import { PATCH } from "./route";

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
    update: ReturnType<typeof vi.fn>;
    upsert: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (resolve: (v: unknown) => unknown) => unknown;
  } = {
    select: vi.fn(() => obj),
    update: vi.fn(() => obj),
    upsert: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

function request(body: unknown): NextRequest {
  return new NextRequest(
    "http://localhost/api/analyses/analysis-1/transactions",
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

function ctx(id = "analysis-1") {
  return { params: Promise.resolve({ id }) };
}

const EXISTING_TX = [
  { id: "tx-1", merchant: "스타벅스 강남점" },
  { id: "tx-2", merchant: "이마트24" },
];

let analysisOwnerRow: { id: string; owner_id: string } | null;
let existingTxFixture: typeof EXISTING_TX;
let updateChains: ReturnType<typeof chain>[];
let upsertChains: ReturnType<typeof chain>[];
let transactionsCalls: number;

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.from.mockReset();
  mocks.requireUser.mockResolvedValue(user());
  mocks.createServerSupabase.mockResolvedValue({ from: mocks.from });

  analysisOwnerRow = { id: "analysis-1", owner_id: "uid-1" };
  existingTxFixture = EXISTING_TX;
  updateChains = [];
  upsertChains = [];
  transactionsCalls = 0;

  mocks.from.mockImplementation((table: string) => {
    if (table === "analyses") {
      return chain({ data: analysisOwnerRow, error: null });
    }

    if (table === "transactions") {
      transactionsCalls += 1;
      if (transactionsCalls === 1) {
        return chain({ data: existingTxFixture, error: null });
      }
      const c = chain({ data: null, error: null });
      updateChains.push(c);
      return c;
    }

    if (table === "user_rules") {
      const c = chain({ data: [{ id: "rule-1" }], error: null });
      upsertChains.push(c);
      return c;
    }

    throw new Error(`예상치 못한 테이블: ${table}`);
  });
});

describe("PATCH /api/analyses/:id/transactions", () => {
  it("미인증이면 401", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await PATCH(
      request({ edits: [{ id: "tx-1", classification: "business", accountCode: "supplies" }], saveAsRule: false }),
      ctx(),
    );

    expect(res.status).toBe(401);
  });

  it("남의 analysisId면 404", async () => {
    analysisOwnerRow = null;

    const res = await PATCH(
      request({ edits: [{ id: "tx-1", classification: "business", accountCode: "supplies" }], saveAsRule: false }),
      ctx(),
    );

    expect(res.status).toBe(404);
  });

  it("edits가 빈 배열이면 400", async () => {
    const res = await PATCH(request({ edits: [], saveAsRule: false }), ctx());

    expect(res.status).toBe(400);
  });

  it("다른 분석에 속한 edits[].id면 400이고 갱신 호출이 없다", async () => {
    const res = await PATCH(
      request({
        edits: [{ id: "tx-other", classification: "business", accountCode: "supplies" }],
        saveAsRule: false,
      }),
      ctx(),
    );

    expect(res.status).toBe(400);
    expect(updateChains.length).toBe(0);
  });

  it("classification이 유효하지 않으면 400", async () => {
    const res = await PATCH(
      request({
        edits: [{ id: "tx-1", classification: "unknown", accountCode: null }],
        saveAsRule: false,
      }),
      ctx(),
    );

    expect(res.status).toBe(400);
  });

  it("정상 수정 시 is_user_edited=true, confidence=null로 갱신된다", async () => {
    await PATCH(
      request({
        edits: [{ id: "tx-1", classification: "business", accountCode: "supplies" }],
        saveAsRule: false,
      }),
      ctx(),
    );

    expect(updateChains.length).toBe(1);
    const [[payload]] = updateChains[0]?.update.mock.calls as [
      [Record<string, unknown>],
    ];
    expect(payload.is_user_edited).toBe(true);
    expect(payload.confidence).toBeNull();
    expect(payload.classification).toBe("business");
    expect(payload.account_code).toBe("supplies");
  });

  it("classification:'personal' + accountCode 지정 → account_code가 null로 정규화된다", async () => {
    await PATCH(
      request({
        edits: [{ id: "tx-1", classification: "personal", accountCode: "travel" }],
        saveAsRule: false,
      }),
      ctx(),
    );

    const [[payload]] = updateChains[0]?.update.mock.calls as [
      [Record<string, unknown>],
    ];
    expect(payload.account_code).toBeNull();
  });

  it("saveAsRule:true면 user_rules upsert가 호출되고 ruleIds가 반환된다", async () => {
    const res = await PATCH(
      request({
        edits: [{ id: "tx-1", classification: "business", accountCode: "entertainment" }],
        saveAsRule: true,
      }),
      ctx(),
    );
    const json = (await res.json()) as { ok: true; ruleIds: string[] };

    expect(upsertChains.length).toBe(1);
    const [[, options]] = upsertChains[0]?.upsert.mock.calls as [
      [unknown, { onConflict: string }],
    ];
    expect(options.onConflict).toBe("owner_id,merchant_pattern");
    expect(json.ruleIds).toEqual(["rule-1"]);
  });

  it("saveAsRule:false면 user_rules에 접근하지 않는다", async () => {
    await PATCH(
      request({
        edits: [{ id: "tx-1", classification: "business", accountCode: "entertainment" }],
        saveAsRule: false,
      }),
      ctx(),
    );

    expect(upsertChains.length).toBe(0);
  });

  it("같은 가맹점 패턴을 두 번 수정해도 upsert 한 번(같은 배치에서 중복 제거)으로 처리된다", async () => {
    existingTxFixture = [
      { id: "tx-1", merchant: "스타벅스 강남점" },
      { id: "tx-2", merchant: "스타벅스 홍대점" },
    ];

    await PATCH(
      request({
        edits: [
          { id: "tx-1", classification: "business", accountCode: "entertainment" },
          { id: "tx-2", classification: "business", accountCode: "entertainment" },
        ],
        saveAsRule: true,
      }),
      ctx(),
    );

    expect(upsertChains.length).toBe(1);
    const [[payload]] = upsertChains[0]?.upsert.mock.calls as [
      [Record<string, unknown>[]],
    ];
    expect(payload.length).toBe(1);
    expect(payload[0]?.merchant_pattern).toBe("스타벅스");
  });
});
