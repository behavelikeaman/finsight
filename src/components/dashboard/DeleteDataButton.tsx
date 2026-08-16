"use client";

/**
 * 내 데이터 전체 삭제. "계정 삭제"라고 쓰지 않는다 — 계정 자체는 남는다(ADR-018).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteDataButton() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);

  const handleDelete = async () => {
    setPending(true);
    try {
      await fetch("/api/account", { method: "DELETE" });
      router.push("/");
    } finally {
      setPending(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-sm font-medium text-review"
      >
        내 데이터 전체 삭제
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-2 rounded-md bg-review-soft p-4 text-sm">
      <p className="text-ink">
        정말로 삭제할까요? 업로드한 분석과 규칙이 모두 사라집니다. 이 작업은
        되돌릴 수 없습니다.
      </p>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setConfirming(false)}
          className="rounded-full bg-surface-strong px-4 py-2 font-medium text-ink"
        >
          취소
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => void handleDelete()}
          className="rounded-full bg-ink px-4 py-2 font-medium text-canvas disabled:opacity-60"
        >
          삭제 확정
        </button>
      </div>
    </div>
  );
}
