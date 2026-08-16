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

/**
 * 한 번의 API 호출에 실어 보낼 거래 건수.
 *
 * 전건 분류는 최대 10,000건까지 들어온다. 한 호출에 전부 보내면 tool 응답이
 * max_tokens에서 잘려 normalize()의 건수 검사에 걸리고, 사용자는 결과 없이
 * 502만 받는다(비용은 이미 나간 뒤다). 그래서 반드시 나눠 보낸다.
 */
export const BATCH_SIZE = 100;

/**
 * 배치 하나의 응답 상한.
 *
 * 건당 tool JSON이 약 35토큰이라 100건이면 약 3,500토큰이다. 여기에 thinking
 * 몫을 더 얹는다 — claude-opus-5는 thinking이 기본으로 켜져 있고, max_tokens는
 * thinking과 응답 텍스트를 **합쳐서** 제한한다. 넉넉하지 않으면 조용히 잘린다.
 */
const MAX_TOKENS = 16_000;

/**
 * 동시에 띄우는 배치 수.
 *
 * 순차로 돌리면 800건짜리 명세서가 8회 직렬 호출이 되어 서버리스 실행 시간을
 * 넘긴다. 반대로 무제한으로 풀면 레이트리밋에 걸린다.
 */
const CONCURRENCY = 4;

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

  const batches: IdentifiedRow[][] = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  const results: ClassifyOutputItem[] = [];

  // CONCURRENCY개씩 묶어 순차로 흘린다. 한 배치라도 실패하면 던진다 —
  // 부분 결과를 반환하면 호출부가 "분류 완료"로 오인해 남은 건이 영영 빈다.
  for (let i = 0; i < batches.length; i += CONCURRENCY) {
    const wave = batches.slice(i, i + CONCURRENCY);
    const settled = await Promise.all(wave.map(classifyBatch));

    for (const items of settled) {
      results.push(...items);
    }
  }

  return results;
}

async function classifyBatch(
  rows: IdentifiedRow[],
): Promise<ClassifyOutputItem[]> {
  const { data: redacted } = redactRows(rows);
  const { system, ledger } = buildPromptBlocks(redacted);

  const client = getClient();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: MAX_TOKENS,
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

  // 잘림은 건수 불일치로도 드러나지만, 그 메시지만 보면 모델이 건수를 틀린
  // 것처럼 읽힌다. 원인을 그대로 말해준다.
  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `모델 응답이 max_tokens(${MAX_TOKENS})에서 잘렸습니다. 배치 크기를 줄이거나 상한을 올려야 합니다.`,
    );
  }

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
