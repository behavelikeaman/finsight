"use client";

/**
 * 전건 분류 실행. quotaLeft는 서버 응답만 신뢰한다 — 클라이언트에서 계산하지 않는다.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

import type { ClassifyRequest, ClassifyResponse } from "@/types/api";

export function ClassifyFullButton({ analysisId }: { analysisId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleClick = async () => {
    setPending(true);
    setMessage(null);

    try {
      const body: ClassifyRequest = { mode: "full" };
      const res = await fetch(`/api/analyses/${analysisId}/classify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as ClassifyResponse;

      if (!json.ok) {
        setMessage(reasonMessage(json.reason));
        return;
      }

      // 서버 상태가 바뀌었으니 이 라우트의 Server Component를 다시 읽는다.
      router.refresh();
    } catch {
      setMessage("전체 분류 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending}
        className="self-start rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary disabled:cursor-not-allowed disabled:bg-primary-disabled"
      >
        {pending ? "분류 중..." : "전체 분류 실행"}
      </button>
      {message && <p className="text-sm text-review">{message}</p>}
    </div>
  );
}

function reasonMessage(reason: string): string {
  if (reason === "quota_exceeded") {
    return "이번 달 분류 횟수를 모두 사용했습니다. 다음 달에 다시 시도하거나 Pro로 업그레이드하세요.";
  }
  if (reason === "anonymous_full_denied") {
    return "Google 계정을 연결해야 전체 분류를 실행할 수 있습니다.";
  }
  if (reason === "sample_used") {
    return "표본 분류는 이미 사용했습니다.";
  }
  return "전체 분류에 실패했습니다.";
}
