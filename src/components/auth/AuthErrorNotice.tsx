"use client";

/**
 * OAuth 복귀 시 붙어 온 실패 사유를 사람이 읽을 수 있게 바꾸고, 막힌 자리에서
 * 나갈 길을 준다.
 *
 * identity_taken은 재시도해도 결과가 같다 — 이미 다른 계정이 그 Google을 쓰고
 * 있다. 그래서 "다시 시도"가 아니라 로그인으로 안내한다. 로그인하면 익명
 * 세션의 분석은 따라가지 않으므로, 그 사실을 누르기 전에 밝힌다.
 */
import { useSyncExternalStore } from "react";

import { parseOAuthErrorFromHash, signInGoogle } from "@/lib/supabase/identity";

interface AuthErrorNoticeProps {
  reason: string;
}

function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener("hashchange", onChange);
  return () => window.removeEventListener("hashchange", onChange);
}

export function AuthErrorNotice({ reason }: AuthErrorNoticeProps) {
  // Supabase는 실패 사유를 프래그먼트로 붙여 보내는데 서버는 그것을 볼 수 없어
  // missing_code로 뭉갠다. 브라우저에서 실제 사유를 되찾는다. 서버 스냅샷은
  // 빈 문자열이라 프래그먼트를 못 읽는 쪽에서는 prop이 그대로 쓰인다.
  const hash = useSyncExternalStore(
    subscribeToHash,
    () => window.location.hash,
    () => "",
  );
  const resolved = parseOAuthErrorFromHash(hash) ?? reason;

  if (resolved !== "identity_taken") {
    return (
      <p className="no-print rounded-md border border-hairline bg-surface-soft px-4 py-3 text-sm text-review">
        Google 연결에 실패했습니다. 잠시 후 다시 시도해 주세요.
      </p>
    );
  }

  return (
    <div className="no-print flex flex-col items-start gap-3 rounded-md border border-hairline bg-surface-soft px-4 py-4">
      <p className="text-sm text-review">
        이 Google 계정은 이미 FinSight에 가입되어 있어, 지금 세션에는 연결할 수
        없습니다.
      </p>
      <p className="text-sm text-body">
        기존 계정으로 로그인하실 수 있습니다. 다만 지금 보고 있는 분석은 이 임시
        세션에 남아, 로그인한 계정으로 옮겨지지 않습니다.
      </p>
      <button
        type="button"
        onClick={() => void signInGoogle("/dashboard")}
        className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary"
      >
        기존 계정으로 로그인
      </button>
    </div>
  );
}
