"use client";

/**
 * 랜딩 상단의 로그인·내 분석 진입점. 재방문자가 파일을 다시 올리지 않고도
 * 자기 분석으로 돌아갈 수 있게 한다.
 *
 * 여기서 ensureSession을 부르지 마라 — 랜딩 방문만으로 익명 계정이 생긴다.
 * 세션은 조회만 한다.
 */
import Link from "next/link";
import { useEffect, useState } from "react";

import { decideAuthRoute, isAnonymousUser } from "@/lib/supabase/auth";
import { createBrowserSupabase } from "@/lib/supabase/browser";
import { linkGoogle, signInGoogle } from "@/lib/supabase/identity";

type State =
  | { kind: "loading" }
  | { kind: "guest" }
  | { kind: "anonymous"; hasPendingAnalysis: boolean }
  | { kind: "member" };

export function HeaderAuth() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const supabase = createBrowserSupabase();

    void (async () => {
      const { data } = await supabase.auth.getUser();
      const user = data.user;

      if (!user) {
        setState({ kind: "guest" });
        return;
      }

      if (!isAnonymousUser(user)) {
        setState({ kind: "member" });
        return;
      }

      // 익명 세션에 귀속되지 않은 결과가 있으면 link로 가야 한다. signin으로
      // 가면 새 uid가 생겨 그 결과를 잃는다.
      const { count } = await supabase
        .from("analyses")
        .select("id", { count: "exact", head: true });

      setState({ kind: "anonymous", hasPendingAnalysis: (count ?? 0) > 0 });
    })();
  }, []);

  if (state.kind === "loading") return null;

  if (state.kind === "member") {
    return (
      <Link
        href="/dashboard"
        className="rounded-full border border-hairline px-4 py-2 text-sm text-ink"
      >
        내 분석
      </Link>
    );
  }

  const handleSignIn = async () => {
    setPending(true);

    const route = decideAuthRoute({
      isAnonymous: state.kind === "anonymous",
      hasPendingAnalysis:
        state.kind === "anonymous" && state.hasPendingAnalysis,
    });

    if (route === "link") {
      const { error } = await linkGoogle("/dashboard");
      if (error) setPending(false);
      return;
    }

    await signInGoogle("/dashboard");
  };

  return (
    <button
      type="button"
      onClick={() => void handleSignIn()}
      disabled={pending}
      className="rounded-full border border-hairline px-4 py-2 text-sm text-ink disabled:cursor-not-allowed disabled:text-muted"
    >
      로그인
    </button>
  );
}
