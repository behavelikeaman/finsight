"use client";

/**
 * Pro 업그레이드 CTA. 체크아웃 URL은 서버가 만든다 — 상품 ID·토큰이
 * 클라이언트에 내려가면 안 된다.
 */
import { useState } from "react";

import type { CheckoutRequest, CheckoutResponse } from "@/types/api";

export function UpgradeButton({ label }: { label?: string }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      const body: CheckoutRequest = { plan: "pro" };
      const res = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        setError("결제 페이지를 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }

      const json = (await res.json()) as CheckoutResponse;
      window.location.href = json.url;
    } catch {
      setError("결제 페이지를 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={() => void handleClick()}
        disabled={pending}
        className="rounded-full bg-primary px-5 py-2 text-sm font-medium text-on-primary disabled:cursor-not-allowed disabled:bg-primary-disabled"
      >
        {label ?? "Pro로 업그레이드"}
      </button>
      {error && <p className="text-xs text-review">{error}</p>}
    </div>
  );
}
