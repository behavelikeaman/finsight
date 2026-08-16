/**
 * Q&A — 이 프로젝트에서 AI 비용이 발생하는 두 경로 중 하나(나머지는 classify).
 *
 * classify.ts와 완전히 같은 buildPromptBlocks(system·ledger)를 재사용한다.
 * 프리픽스가 한 글자라도 달라지면 캐시가 미스되어 비용이 10배가 된다. 이
 * 함수를 쓰는 라우트는 step6에서 만든다 — 여기서는 함수만 제공한다.
 */
import type Anthropic from "@anthropic-ai/sdk";

import { redactRows } from "@/lib/redact";
import type { IdentifiedRow } from "@/types/domain";

import { getClient } from "./client";
import { buildPromptBlocks } from "./prompt";

const MODEL = "claude-opus-5";

/**
 * 답변 상한.
 *
 * claude-opus-5는 thinking이 기본으로 켜져 있고, max_tokens는 thinking과 답변
 * 텍스트를 **합쳐서** 제한한다. 예전 값(2,048)에서는 thinking이 예산을 먹고
 * 텍스트 블록이 아예 안 나와, 사용자에게는 원인 없는 502로만 보였다.
 */
const MAX_TOKENS = 8_000;

/**
 * thinking 비용을 줄인다. 기본값은 'high'다.
 *
 * 분류(low)보다 한 단계 높게 둔 이유는, 여기는 답의 형태를 스키마로 잡아둘 수
 * 없는 자유 질의응답이고 호출량도 월 100회로 작기 때문이다.
 */
const EFFORT = "medium";

/** classify.ts와 같은 이유의 우회. SDK 0.68.0 타입에 output_config가 없다. */
const EFFORT_PARAM = { output_config: { effort: EFFORT } } as object;

export async function askAboutLedger(
  rows: IdentifiedRow[],
  question: string,
): Promise<string> {
  const { data: redacted } = redactRows(rows);
  const { system, ledger } = buildPromptBlocks(redacted);

  const client = getClient();
  const message = await client.messages.create({
    ...EFFORT_PARAM,
    model: MODEL,
    max_tokens: MAX_TOKENS,
    system,
    messages: [
      {
        role: "user",
        // 질문은 캐시하지 않는 세 번째 블록이다 — 매번 바뀌므로 캐시 지점을
        // 두지 않는다(cache_control을 붙이지 않는다).
        content: [ledger, { type: "text", text: question }],
      },
    ],
  });

  if (message.stop_reason === "max_tokens") {
    throw new Error(
      `모델 답변이 max_tokens(${MAX_TOKENS})에서 잘렸습니다.`,
    );
  }

  // thinking 블록이 먼저 오므로 타입으로 골라낸다. content[0]을 집으면 안 된다.
  const block = message.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );

  if (!block) {
    throw new Error("모델이 답변을 반환하지 않았습니다.");
  }

  return block.text;
}
