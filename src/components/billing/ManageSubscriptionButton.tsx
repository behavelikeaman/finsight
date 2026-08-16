"use client";

/**
 * 구독 관리 — 해지·카드 교체·영수증은 전부 Polar 고객 포털에서 처리한다.
 *
 * 포털 URL은 1회용 토큰을 포함하므로 서버가 클릭 시점에 발급한다.
 * 미리 받아 링크로 박아두지 마라.
 */
import { useState } from "react";

import type { PortalResponse } from "@/types/api";

export function ManageSubscriptionButton() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleClick = async () => {
    if (pending) return;

    setPending(true);
    setError(null);

    try {
      const res = await fetch("/api/billing/portal", { method: "POST" });

      if (res.status === 404) {
        setError("연결된 구독 정보가 없습니다.");
        return;
      }

      if (!res.ok) {
        setError("구독 관리 페이지를 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
        return;
      }

      const json = (await res.json()) as PortalResponse;
      window.location.href = json.url;
    } catch {
      setError("구독 관리 페이지를 열지 못했습니다. 잠시 후 다시 시도해 주세요.");
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
        className="rounded-full border border-hairline bg-canvas px-5 py-2 text-sm font-medium text-ink disabled:cursor-not-allowed disabled:opacity-60"
      >
        구독 관리
      </button>
      {error && <p className="text-xs text-review">{error}</p>}
    </div>
  );
}
