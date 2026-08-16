"use client";

/**
 * 결제 성공 리다이렉트 직후 실행되는 동기화.
 *
 * 웹훅은 수 초~수 분 지연될 수 있고 사용자는 리다이렉트 직후 화면을 본다.
 * 그래서 화면을 그리기 전에 POST /api/billing/sync 를 먼저 호출한다.
 * 아직 웹훅이 도착하지 않아 free로 나오면 몇 초 간격으로 다시 확인한다.
 *
 * 티어 판정은 전적으로 서버가 한다. 여기서는 응답을 표시만 한다.
 */
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import type { BillingSyncResponse } from "@/types/api";

const MAX_ATTEMPTS = 4;
const RETRY_DELAY_MS = 2500;

export function BillingSync({ checkoutId }: { checkoutId: string }) {
  const router = useRouter();
  const [state, setState] = useState<
    "pending" | "pro" | "unresolved" | "failed"
  >("pending");

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      // 서버가 에러를 낸 것과 아직 반영이 안 된 것은 다른 상황이다.
      // 구분하지 않으면 설정 오류에도 "잠시 후 새로고침"이라 안내하게 된다.
      let serverErrored = false;

      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (cancelled) return;

        try {
          // checkoutId를 보내는 것이 핵심이다. 첫 결제에서는 profiles의
          // polar_* 가 아직 비어 있어(웹훅이 채운다) 서버가 이 값 없이는
          // 어떤 구독을 확인해야 할지 알 수 없다.
          const res = await fetch("/api/billing/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ checkoutId }),
          });

          serverErrored = res.status >= 500;

          if (res.ok) {
            const json = (await res.json()) as BillingSyncResponse;
            if (json.tier === "pro") {
              if (cancelled) return;
              setState("pro");
              router.refresh();
              return;
            }
          }
        } catch {
          // 네트워크 오류는 재시도로 흡수한다.
        }

        await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS));
      }

      if (!cancelled) setState(serverErrored ? "failed" : "unresolved");
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, [checkoutId, router]);

  if (state === "pro") {
    return (
      <p className="rounded-md bg-business-soft px-4 py-3 text-sm text-business">
        Pro가 활성화되었습니다.
      </p>
    );
  }

  if (state === "unresolved") {
    return (
      <p className="rounded-md bg-surface-soft px-4 py-3 text-sm text-body">
        결제 확인이 아직 끝나지 않았습니다. 잠시 후 페이지를 새로고침해 주세요.
      </p>
    );
  }

  // 새로고침으로 풀리지 않는 상황이다. 그렇게 안내하면 사용자가 같은 화면을
  // 반복해서 보게 된다. 결제 자체는 이미 완료됐다는 사실을 알린다.
  if (state === "failed") {
    return (
      <p className="rounded-md bg-review-soft px-4 py-3 text-sm text-ink">
        결제는 완료되었지만 계정 반영 중 문제가 발생했습니다. 다시
        결제하지 마시고 문의해 주세요.
      </p>
    );
  }

  return (
    <p className="rounded-md bg-surface-soft px-4 py-3 text-sm text-body">
      결제 상태를 확인하는 중입니다…
    </p>
  );
}
