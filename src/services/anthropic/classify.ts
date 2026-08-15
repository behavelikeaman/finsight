/**
 * 거래 분류 — 이 프로젝트에서 AI 비용이 발생하는 두 경로 중 하나(나머지는 chat).
 *
 * 결과는 배열 index가 아니라 id로 반환한다. 호출부(classify 라우트)는
 * applyRules가 쪼갠 부분 배열을 넘기므로, index로는 원본 거래를 가리키지
 * 못한다. 모델에게는 1부터 시작하는 번호를 매겨 보내고, 응답을 받은 뒤 그
 * 번호를 입력 배열의 id로 되돌린다.
 */
import type Anthropic from "@anthropic-ai/sdk";

import { redactRows } from "@/lib/redact";
import type { AccountCode, Classification, IdentifiedRow } from "@/types/domain";
import { CONFIDENCE_THRESHOLD } from "@/types/tier";

import { ACCOUNT_CODES, buildPromptBlocks } from "./prompt";
import { getClient } from "./client";

export interface ClassifyInput {
  rows: IdentifiedRow[];
}

export interface ClassifyOutputItem {
  id: string;
  classification: Classification;
  accountCode: AccountCode | null;
  confidence: number;
}

const MODEL = "claude-opus-5";

const CLASSIFY_TOOL_NAME = "submit_classifications";

const CLASSIFY_TOOL: Anthropic.Tool = {
  name: CLASSIFY_TOOL_NAME,
  description:
    "거래내역 목록 전체에 대한 분류 판단을 제출한다. 목록의 모든 번호를 빠짐없이 포함해야 한다.",
  input_schema: {
    type: "object",
    properties: {
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            index: {
              type: "integer",
              description: "거래내역 목록의 1부터 시작하는 번호",
            },
            classification: {
              type: "string",
              enum: ["business", "personal", "review"],
            },
            accountCode: {
              type: ["string", "null"],
              enum: [...ACCOUNT_CODES, null],
            },
            confidence: { type: "number", minimum: 0, maximum: 1 },
          },
          required: ["index", "classification", "accountCode", "confidence"],
        },
      },
    },
    required: ["items"],
  },
};

interface RawClassifyItem {
  index: unknown;
  classification: unknown;
  accountCode: unknown;
  confidence: unknown;
}

export async function classifyTransactions(
  input: ClassifyInput,
): Promise<ClassifyOutputItem[]> {
  const { rows } = input;
  if (rows.length === 0) return [];

  const { data: redacted } = redactRows(rows);
  const { system, ledger } = buildPromptBlocks(redacted);

  const client = getClient();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 4096,
    system,
    messages: [
      {
        role: "user",
        content: [
          ledger,
          {
            type: "text",
            text: `위 거래내역 ${rows.length}건 전체에 대해 ${CLASSIFY_TOOL_NAME} 도구로 분류를 제출하세요. 목록의 모든 번호를 빠짐없이 포함하세요.`,
          },
        ],
      },
    ],
    tools: [CLASSIFY_TOOL],
    tool_choice: { type: "tool", name: CLASSIFY_TOOL_NAME },
  });

  const rawItems = extractItems(message);
  return normalize(rawItems, rows);
}

function extractItems(message: Anthropic.Message): RawClassifyItem[] {
  const block = message.content.find(
    (b): b is Anthropic.ToolUseBlock =>
      b.type === "tool_use" && b.name === CLASSIFY_TOOL_NAME,
  );

  if (!block) {
    throw new Error("모델이 분류 결과를 반환하지 않았습니다.");
  }

  const input = block.input as { items?: unknown };
  if (!Array.isArray(input.items)) {
    throw new Error("모델 응답 형식이 올바르지 않습니다.");
  }

  return input.items as RawClassifyItem[];
}

function normalize(
  rawItems: RawClassifyItem[],
  rows: IdentifiedRow[],
): ClassifyOutputItem[] {
  if (rawItems.length !== rows.length) {
    throw new Error(
      `모델 응답 건수(${rawItems.length})가 요청 건수(${rows.length})와 다릅니다.`,
    );
  }

  return rawItems.map((item) => {
    const row = rows[toIndex(item.index) - 1];
    if (!row) {
      throw new Error(`모델 응답의 index(${String(item.index)})가 유효하지 않습니다.`);
    }

    return { id: row.id, ...normalizeJudgement(item) };
  });
}

function normalizeJudgement(item: RawClassifyItem): {
  classification: Classification;
  accountCode: AccountCode | null;
  confidence: number;
} {
  let classification: Classification;
  let confidence: number;

  if (isClassification(item.classification)) {
    classification = item.classification;
    confidence = isValidConfidence(item.confidence) ? item.confidence : 0;
  } else {
    // 셋 중 하나가 아니면 확신 없이 단정하지 않는다 — review와 confidence 0.
    classification = "review";
    confidence = 0;
  }

  if (classification !== "review" && confidence < CONFIDENCE_THRESHOLD) {
    classification = "review";
  }

  const accountCode =
    classification === "business"
      ? isAccountCode(item.accountCode)
        ? item.accountCode
        : "other"
      : null;

  return { classification, accountCode, confidence };
}

function toIndex(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

function isClassification(value: unknown): value is Classification {
  return value === "business" || value === "personal" || value === "review";
}

function isValidConfidence(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= 0 &&
    value <= 1
  );
}

function isAccountCode(value: unknown): value is AccountCode {
  return (
    typeof value === "string" &&
    (ACCOUNT_CODES as readonly string[]).includes(value)
  );
}
