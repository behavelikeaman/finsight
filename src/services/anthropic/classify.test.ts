import { beforeEach, describe, expect, it, vi } from "vitest";

import type { IdentifiedRow } from "@/types/domain";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  redactRows: vi.fn(),
  callOrder: [] as string[],
}));

vi.mock("./client", () => ({
  getClient: () => ({ messages: { create: mocks.create } }),
}));

vi.mock("@/lib/redact", () => ({
  redactRows: mocks.redactRows,
}));

import { BATCH_SIZE, classifyTransactions } from "./classify";

const ROWS: IdentifiedRow[] = [
  { id: "tx-a", occurredOn: "2026-01-05", merchant: "스타벅스", amountKrw: 5500 },
  { id: "tx-b", occurredOn: "2026-01-07", merchant: "이마트24", amountKrw: 12000 },
];

/** 거래 n건을 만든다. 배치 분할 검증용. */
function makeRows(n: number): IdentifiedRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `tx-${i}`,
    occurredOn: "2026-03-01",
    merchant: `가맹점${i}`,
    amountKrw: 1000 + i,
  }));
}

/** SDK 호출 인자에서 이 배치가 몇 건을 요청했는지 읽는다. */
function requestedCount(params: unknown): number {
  const ledger = (
    params as { messages: { content: { text?: string }[] }[] }
  ).messages[0]?.content[0]?.text;

  const match = /거래내역 \((\d+)건\)/.exec(ledger ?? "");
  return Number(match?.[1] ?? 0);
}

/** tool_use 블록을 담은 최소 Message 응답을 흉내낸다. */
function toolResponse(items: unknown[]) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    stop_reason: "tool_use",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [
      {
        type: "tool_use",
        id: "tool_1",
        name: "submit_classifications",
        input: { items },
      },
    ],
  };
}

beforeEach(() => {
  mocks.create.mockReset();
  mocks.redactRows.mockReset();
  mocks.callOrder.length = 0;

  mocks.redactRows.mockImplementation((rows: IdentifiedRow[]) => {
    mocks.callOrder.push("redactRows");
    return { data: [...rows], removedCount: 0 };
  });

  // 요청한 건수만큼 돌려준다. 배치가 나뉘면 배치마다 그 크기에 맞춰 응답한다.
  mocks.create.mockImplementation(async (params: unknown) => {
    mocks.callOrder.push("create");
    return toolResponse(
      Array.from({ length: requestedCount(params) }, (_, i) => ({
        index: i + 1,
        classification: "business",
        accountCode: "supplies",
        confidence: 0.9,
      })),
    );
  });
});

describe("classifyTransactions", () => {
  it("redactRows를 먼저 호출한 뒤 SDK를 호출한다", async () => {
    await classifyTransactions({ rows: ROWS });

    expect(mocks.callOrder).toEqual(["redactRows", "create"]);
  });

  it("id로 결과를 반환한다(배열 index가 아니다)", async () => {
    const result = await classifyTransactions({ rows: ROWS });

    expect(result.map((r) => r.id).sort()).toEqual(["tx-a", "tx-b"]);
  });

  it("반환된 id가 전부 입력 배열의 id 집합에 속한다", async () => {
    const result = await classifyTransactions({ rows: ROWS });
    const inputIds = new Set(ROWS.map((r) => r.id));

    for (const item of result) {
      expect(inputIds.has(item.id)).toBe(true);
    }
  });

  it("부분 배열을 넘겨도 올바른 id가 돌아온다(index 기반이 아님을 고정)", async () => {
    const subset: IdentifiedRow[] = [
      { id: "tx-99", occurredOn: "2026-02-01", merchant: "GS25", amountKrw: 3000 },
      { id: "tx-3", occurredOn: "2026-02-02", merchant: "이디야", amountKrw: 4000 },
    ];
    mocks.create.mockImplementation(async () =>
      toolResponse([
        { index: 1, classification: "personal", accountCode: null, confidence: 0.95 },
        { index: 2, classification: "personal", accountCode: null, confidence: 0.95 },
      ]),
    );

    const result = await classifyTransactions({ rows: subset });

    expect(result.find((r) => r.id === "tx-99")).toBeDefined();
    expect(result.find((r) => r.id === "tx-3")).toBeDefined();
  });

  it("응답 길이가 입력과 다르면 에러", async () => {
    mocks.create.mockImplementation(async () =>
      toolResponse([
        { index: 1, classification: "business", accountCode: "other", confidence: 0.9 },
      ]),
    );

    await expect(classifyTransactions({ rows: ROWS })).rejects.toThrow();
  });

  it("알 수 없는 accountCode는 'other'로 강등한다", async () => {
    mocks.create.mockImplementation(async () =>
      toolResponse(
        ROWS.map((_, i) => ({
          index: i + 1,
          classification: "business",
          accountCode: "made_up_code",
          confidence: 0.9,
        })),
      ),
    );

    const result = await classifyTransactions({ rows: ROWS });

    expect(result.every((r) => r.accountCode === "other")).toBe(true);
  });

  it("confidence가 임계값 미만인 business는 review로 강등한다", async () => {
    mocks.create.mockImplementation(async () =>
      toolResponse(
        ROWS.map((_, i) => ({
          index: i + 1,
          classification: "business",
          accountCode: "supplies",
          confidence: 0.5,
        })),
      ),
    );

    const result = await classifyTransactions({ rows: ROWS });

    expect(result.every((r) => r.classification === "review")).toBe(true);
    expect(result.every((r) => r.accountCode === null)).toBe(true);
  });

  it("classification이 셋 중 하나가 아니면 review, confidence는 0", async () => {
    mocks.create.mockImplementation(async () =>
      toolResponse(
        ROWS.map((_, i) => ({
          index: i + 1,
          classification: "unknown_value",
          accountCode: null,
          confidence: 0.95,
        })),
      ),
    );

    const result = await classifyTransactions({ rows: ROWS });

    expect(result.every((r) => r.classification === "review")).toBe(true);
    expect(result.every((r) => r.confidence === 0)).toBe(true);
  });

  it("personal인데 accountCode가 있으면 null로 강제한다", async () => {
    mocks.create.mockImplementation(async () =>
      toolResponse(
        ROWS.map((_, i) => ({
          index: i + 1,
          classification: "personal",
          accountCode: "supplies",
          confidence: 0.95,
        })),
      ),
    );

    const result = await classifyTransactions({ rows: ROWS });

    expect(result.every((r) => r.accountCode === null)).toBe(true);
  });

  it("입력이 빈 배열이면 SDK를 호출하지 않는다", async () => {
    const result = await classifyTransactions({ rows: [] });

    expect(result).toEqual([]);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("SDK에 전달된 시스템·거래내역 블록에 cache_control이 붙는다", async () => {
    await classifyTransactions({ rows: ROWS });

    const params = mocks.create.mock.calls[0]?.[0] as {
      system: { cache_control?: unknown }[];
      messages: { content: { cache_control?: unknown }[] }[];
    };

    expect(params.system[0]?.cache_control).toBeTruthy();
    expect(params.messages[0]?.content[0]?.cache_control).toBeTruthy();
  });

  it("claude-opus-5 모델을 쓴다", async () => {
    await classifyTransactions({ rows: ROWS });

    const params = mocks.create.mock.calls[0]?.[0] as { model: string };
    expect(params.model).toBe("claude-opus-5");
  });

  describe("배치 분할", () => {
    it("BATCH_SIZE 이하면 한 번만 호출한다", async () => {
      await classifyTransactions({ rows: makeRows(BATCH_SIZE) });

      expect(mocks.create).toHaveBeenCalledTimes(1);
    });

    it("BATCH_SIZE를 넘으면 나눠 호출한다", async () => {
      await classifyTransactions({ rows: makeRows(BATCH_SIZE * 2 + 1) });

      expect(mocks.create).toHaveBeenCalledTimes(3);
    });

    it("어느 배치도 BATCH_SIZE를 넘게 요청하지 않는다", async () => {
      await classifyTransactions({ rows: makeRows(BATCH_SIZE * 2 + 1) });

      for (const call of mocks.create.mock.calls) {
        expect(requestedCount(call[0])).toBeLessThanOrEqual(BATCH_SIZE);
      }
    });

    it("나뉜 배치의 결과를 빠짐없이 합쳐 돌려준다", async () => {
      const rows = makeRows(BATCH_SIZE * 2 + 1);

      const result = await classifyTransactions({ rows });

      expect(result).toHaveLength(rows.length);
      expect(new Set(result.map((r) => r.id))).toEqual(
        new Set(rows.map((r) => r.id)),
      );
    });

    it("두 번째 배치가 실패하면 전체가 실패한다", async () => {
      let call = 0;
      mocks.create.mockImplementation(async (params: unknown) => {
        call += 1;
        if (call === 2) throw new Error("api down");
        return toolResponse(
          Array.from({ length: requestedCount(params) }, (_, i) => ({
            index: i + 1,
            classification: "business",
            accountCode: "supplies",
            confidence: 0.9,
          })),
        );
      });

      await expect(
        classifyTransactions({ rows: makeRows(BATCH_SIZE * 2) }),
      ).rejects.toThrow();
    });
  });

  describe("응답 잘림", () => {
    it("배치 하나의 결과를 담을 만큼 max_tokens를 잡는다", async () => {
      await classifyTransactions({ rows: makeRows(BATCH_SIZE) });

      const params = mocks.create.mock.calls[0]?.[0] as { max_tokens: number };
      // 건당 tool JSON은 약 35토큰이다. 여기에 thinking 몫까지 얹어야 한다 —
      // claude-opus-5는 thinking이 기본 on이고 max_tokens는 thinking과 응답을
      // 함께 제한한다.
      expect(params.max_tokens).toBeGreaterThan(BATCH_SIZE * 35);
    });

    it("max_tokens에서 잘리면 잘렸다고 알려주는 에러를 낸다", async () => {
      mocks.create.mockImplementation(async () => ({
        ...toolResponse([]),
        stop_reason: "max_tokens",
      }));

      await expect(classifyTransactions({ rows: ROWS })).rejects.toThrow(
        /max_tokens/,
      );
    });
  });
});
