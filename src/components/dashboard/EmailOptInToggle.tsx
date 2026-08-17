"use client";

/**
 * 이메일 수신 동의 토글. 켜기와 끄기(해지)가 같은 컨트롤이다.
 *
 * 권한 판정은 하지 않는다 — 익명 세션에는 서버가 이 컴포넌트를 아예 렌더하지
 * 않는다. 상태는 서버가 돌려준 값으로만 바꾼다. 요청 값으로 낙관 갱신하면
 * 저장이 실패했을 때 화면과 DB가 어긋난 채 남는다.
 */
import { useState } from "react";

import type { AccountSettingsResponse } from "@/types/api";

export function EmailOptInToggle({ initialOptIn }: { initialOptIn: boolean }) {
  const [optIn, setOptIn] = useState(initialOptIn);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);

  const handleChange = async (next: boolean) => {
    setPending(true);
    setFailed(false);

    try {
      const res = await fetch("/api/account", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ emailOptIn: next }),
      });
      const json = (await res.json()) as AccountSettingsResponse;

      // 성공 응답에서만 상태를 바꾼다. 실패는 직전 값을 그대로 둔다 —
      // 실패를 동의로 해석하면 동의하지 않은 사용자에게 메일이 나간다.
      if (json.ok) {
        setOptIn(json.emailOptIn);
      } else {
        setFailed(true);
      }
    } catch {
      setFailed(true);
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-2.5 text-sm text-ink">
        <input
          type="checkbox"
          checked={optIn}
          disabled={pending}
          onChange={(e) => void handleChange(e.target.checked)}
          className="size-4 accent-primary disabled:opacity-60"
        />
        정리 결과 안내를 이메일로 받기
      </label>
      {failed && (
        <p role="status" className="text-xs text-review-ink">
          설정을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      )}
    </div>
  );
}
