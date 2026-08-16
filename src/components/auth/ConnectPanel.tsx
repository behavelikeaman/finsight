"use client";

/**
 * Google 계정 연결 유도. 경로 판정은 decideAuthRoute()만 쓴다 — 여기서 다시
 * 구현하면 익명 세션에 결과가 있는데 signin을 골라 uid가 버려지는 사고가 난다.
 */
import { useState } from "react";

import { decideAuthRoute } from "@/lib/supabase/auth";
import { linkGoogle, signInGoogle, type LinkError } from "@/lib/supabase/identity";

interface ConnectPanelProps {
  isAnonymous: boolean;
  hasPendingAnalysis: boolean;
  /** OAuth 완료 후 돌아올 경로. 같은 오리진의 경로여야 한다. */
  redirectTo: string;
}

const ERROR_MESSAGE: Record<LinkError, string> = {
  identity_taken:
    "이미 사용 중인 Google 계정입니다. 로그인 후 이 파일을 다시 올려 주세요.",
  already_linked: "이미 이 계정에 연결된 Google입니다.",
  unknown: "연결에 실패했습니다. 잠시 후 다시 시도해 주세요.",
};

export function ConnectPanel({
  isAnonymous,
  hasPendingAnalysis,
  redirectTo,
}: ConnectPanelProps) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<LinkError | null>(null);

  const handleConnect = async () => {
    setPending(true);
    setError(null);

    const route = decideAuthRoute({ isAnonymous, hasPendingAnalysis });

    if (route === "link") {
      const { error: linkError } = await linkGoogle(redirectTo);
      if (linkError) {
        setError(linkError);
        setPending(false);
      }
      // 성공하면 OAuth 리다이렉트가 일어나 이 컴포넌트는 언마운트된다.
      return;
    }

    await signInGoogle(redirectTo);
  };

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface-soft p-6">
      <p className="text-sm text-body">
        전체 거래를 분류하려면 Google 계정을 연결하세요. 지금까지의 분석
        결과는 그대로 이어집니다.
      </p>
      <button
        type="button"
        onClick={() => void handleConnect()}
        disabled={pending}
        className="self-start rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary disabled:cursor-not-allowed disabled:bg-primary-disabled"
      >
        Google 계정으로 연결
      </button>
      {error && <p className="text-sm text-review">{ERROR_MESSAGE[error]}</p>}
    </div>
  );
}
