"use client";

/**
 * Q&A. Pro 전용 — 부모(Server Component)가 getEffectiveTier()로 판정해
 * free면 이 컴포넌트를 아예 렌더하지 않는다. 대화 이력은 저장하지 않는다.
 */
import { useState } from "react";

import type { ChatRequest, ChatResponse } from "@/types/api";

interface Message {
  role: "user" | "assistant";
  text: string;
}

export function ChatPanel({ analysisId }: { analysisId: string }) {
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [pending, setPending] = useState(false);
  const [quotaLeft, setQuotaLeft] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = question.trim();
    if (q === "" || pending) return;

    setMessages((m) => [...m, { role: "user", text: q }]);
    setQuestion("");
    setPending(true);
    setError(null);

    try {
      const body: ChatRequest = { question: q };
      const res = await fetch(`/api/analyses/${analysisId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ChatResponse;

      if (!json.ok) {
        setError(
          json.reason === "quota_exceeded"
            ? "이번 달 질문 횟수를 모두 사용했습니다."
            : "Pro 전용 기능입니다.",
        );
        return;
      }

      setMessages((m) => [...m, { role: "assistant", text: json.answer }]);
      setQuotaLeft(json.quotaLeft);
    } catch {
      setError("답변을 가져오지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-hairline bg-canvas p-6">
      <h2 className="text-lg font-normal text-ink">거래내역에 대해 물어보세요</h2>
      <p className="text-xs text-muted">
        대화 이력은 저장되지 않습니다. 페이지를 벗어나면 사라집니다.
      </p>

      <div className="flex flex-col gap-2">
        {messages.map((m, i) => (
          <p
            key={i}
            className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
              m.role === "user"
                ? "self-end bg-ink text-canvas"
                : "self-start bg-surface-soft text-ink"
            }`}
          >
            {m.text}
          </p>
        ))}
      </div>

      {error && <p className="text-sm text-review">{error}</p>}

      <form onSubmit={(e) => void handleSubmit(e)} className="flex gap-2">
        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="예: 지난달 접대비 얼마 썼어?"
          className="flex-1 rounded-full border border-hairline px-4 py-2 text-sm focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary disabled:cursor-not-allowed disabled:bg-primary-disabled"
        >
          보내기
        </button>
      </form>

      {quotaLeft !== null && (
        <p className="text-xs text-muted">이번 달 남은 질문: {quotaLeft}회</p>
      )}

      <p className="rounded-md bg-surface-soft px-3 py-2 text-xs text-muted">
        이 답변은 세무 조언이 아닙니다. 최종 판단은 세무 대리인과 상의하세요.
      </p>
    </div>
  );
}
