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

export async function askAboutLedger(
  rows: IdentifiedRow[],
  question: string,
): Promise<string> {
  const { data: redacted } = redactRows(rows);
  const { system, ledger } = buildPromptBlocks(redacted);

  const client = getClient();
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 2048,
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

  const block = message.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );

  if (!block) {
    throw new Error("모델이 답변을 반환하지 않았습니다.");
  }

  return block.text;
}
