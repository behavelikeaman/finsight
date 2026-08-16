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

import { askAboutLedger } from "./chat";
import { buildPromptBlocks } from "./prompt";

const ROWS: IdentifiedRow[] = [
  { id: "tx-a", occurredOn: "2026-01-05", merchant: "스타벅스", amountKrw: 5500 },
];

function textResponse(text: string) {
  return {
    id: "msg_1",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
    content: [{ type: "text", text, citations: null }],
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

  mocks.create.mockImplementation(async () => {
    mocks.callOrder.push("create");
    return textResponse("1월에는 스타벅스에서 5,500원을 썼습니다.");
  });
});

describe("askAboutLedger", () => {
  it("redactRows를 먼저 호출한 뒤 SDK를 호출한다", async () => {
    await askAboutLedger(ROWS, "1월에 얼마 썼어?");

    expect(mocks.callOrder).toEqual(["redactRows", "create"]);
  });

  it("모델의 텍스트 응답을 그대로 반환한다", async () => {
    const answer = await askAboutLedger(ROWS, "1월에 얼마 썼어?");

    expect(answer).toBe("1월에는 스타벅스에서 5,500원을 썼습니다.");
  });

  it("buildPromptBlocks가 만든 system·ledger를 그대로 쓴다(질문 간 캐시 재사용)", async () => {
    await askAboutLedger(ROWS, "질문");

    const params = mocks.create.mock.calls[0]?.[0] as {
      system: unknown;
      messages: { content: unknown[] }[];
    };

    const expected = buildPromptBlocks(ROWS as never);
    expect(params.system).toEqual(expected.system);
    expect(params.messages[0]?.content[0]).toEqual(expected.ledger);
  });

  it("질문이 캐시되지 않는 세 번째 블록으로 들어간다", async () => {
    await askAboutLedger(ROWS, "지난달 접대성 지출이 얼마야?");

    const params = mocks.create.mock.calls[0]?.[0] as {
      messages: { content: { type: string; text: string; cache_control?: unknown }[] }[];
    };
    const lastBlock = params.messages[0]?.content.at(-1);

    expect(lastBlock?.text).toBe("지난달 접대성 지출이 얼마야?");
    expect(lastBlock?.cache_control).toBeUndefined();
  });

  it("claude-opus-5 모델을 쓴다", async () => {
    await askAboutLedger(ROWS, "질문");

    const params = mocks.create.mock.calls[0]?.[0] as { model: string };
    expect(params.model).toBe("claude-opus-5");
  });

  it("effort를 medium으로 낮춰 thinking 비용을 줄인다", async () => {
    await askAboutLedger(ROWS, "질문");

    const params = mocks.create.mock.calls[0]?.[0] as {
      output_config?: { effort?: string };
    };

    expect(params.output_config?.effort).toBe("medium");
  });

  it("모델이 텍스트 블록을 반환하지 않으면 에러", async () => {
    mocks.create.mockImplementation(async () => ({
      ...textResponse(""),
      content: [],
    }));

    await expect(askAboutLedger(ROWS, "질문")).rejects.toThrow();
  });

  it("thinking 몫까지 감당할 만큼 max_tokens를 잡는다", async () => {
    await askAboutLedger(ROWS, "질문");

    const params = mocks.create.mock.calls[0]?.[0] as { max_tokens: number };
    // claude-opus-5는 thinking이 기본 on이고, max_tokens가 thinking과 답변을
    // 함께 제한한다. 2,048에서는 thinking이 예산을 먹고 답변이 잘린다.
    expect(params.max_tokens).toBeGreaterThanOrEqual(8_000);
  });

  it("thinking 블록이 앞에 와도 답변 텍스트를 골라낸다", async () => {
    mocks.create.mockImplementation(async () => ({
      ...textResponse("답변입니다."),
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "답변입니다.", citations: null },
      ],
    }));

    await expect(askAboutLedger(ROWS, "질문")).resolves.toBe("답변입니다.");
  });

  it("max_tokens에서 잘리면 잘렸다고 알려주는 에러를 낸다", async () => {
    mocks.create.mockImplementation(async () => ({
      ...textResponse(""),
      stop_reason: "max_tokens",
      content: [{ type: "thinking", thinking: "", signature: "sig" }],
    }));

    await expect(askAboutLedger(ROWS, "질문")).rejects.toThrow(/max_tokens/);
  });
});
