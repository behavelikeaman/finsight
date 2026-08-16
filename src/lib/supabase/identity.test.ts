import { beforeEach, describe, expect, it, vi } from "vitest";

import { decideAuthRoute } from "./auth";

const mocks = vi.hoisted(() => ({
  linkIdentity: vi.fn(),
  signInWithOAuth: vi.fn(),
  signOut: vi.fn(),
  createBrowserSupabase: vi.fn(),
}));

vi.mock("./browser", () => ({
  createBrowserSupabase: mocks.createBrowserSupabase,
}));

import {
  buildCallbackUrl,
  linkGoogle,
  parseOAuthErrorFromHash,
  signInGoogle,
} from "./identity";

const ORIGIN = "http://localhost:3000";

beforeEach(() => {
  mocks.linkIdentity.mockReset();
  mocks.signInWithOAuth.mockReset();
  mocks.signOut.mockReset();
  mocks.createBrowserSupabase.mockReturnValue({
    auth: {
      linkIdentity: mocks.linkIdentity,
      signInWithOAuth: mocks.signInWithOAuth,
      signOut: mocks.signOut,
    },
  });
  // node 환경이라 window가 없다. origin만 있으면 된다.
  vi.stubGlobal("window", { location: { origin: ORIGIN } });
});

describe("buildCallbackUrl", () => {
  it("code를 교환하는 /auth/callback을 가리키는 절대 URL을 만든다", () => {
    expect(buildCallbackUrl(ORIGIN, "/dashboard")).toBe(
      "http://localhost:3000/auth/callback?next=%2Fdashboard",
    );
  });

  it("돌아갈 경로를 next로 실어 보낸다", () => {
    expect(buildCallbackUrl(ORIGIN, "/dashboard/abc-123")).toBe(
      "http://localhost:3000/auth/callback?next=%2Fdashboard%2Fabc-123",
    );
  });
});

// Supabase는 연결 실패를 쿼리가 아니라 URL 프래그먼트로 붙여 보낸다.
// 프래그먼트는 서버로 전송되지 않아 콜백 라우트에서는 보이지 않는다.
describe("parseOAuthErrorFromHash", () => {
  it("이미 다른 계정이 쓰는 Google이면 identity_taken을 돌려준다", () => {
    expect(
      parseOAuthErrorFromHash(
        "#error=server_error&error_code=identity_already_exists&error_description=Identity%20is%20already%20linked",
      ),
    ).toBe("identity_taken");
  });

  it("그 밖의 실패는 oauth_failed로 묶는다", () => {
    expect(parseOAuthErrorFromHash("#error=access_denied")).toBe("oauth_failed");
  });

  it("실패가 아니면 null을 돌려준다", () => {
    expect(parseOAuthErrorFromHash("")).toBeNull();
    expect(parseOAuthErrorFromHash("#")).toBeNull();
    expect(parseOAuthErrorFromHash("#access_token=abc&type=bearer")).toBeNull();
  });
});

describe("linkGoogle", () => {
  it("성공하면 error가 없다", async () => {
    mocks.linkIdentity.mockResolvedValue({ error: null });

    const result = await linkGoogle("/dashboard");

    expect(mocks.linkIdentity).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard",
      },
    });
    expect(result.error).toBeUndefined();
  });

  it("앱 경로를 그대로 넘기지 않는다 — 상대 경로면 Supabase가 Site URL로 폴백해 code가 교환되지 않는다", async () => {
    mocks.linkIdentity.mockResolvedValue({ error: null });

    await linkGoogle("/dashboard/abc-123");

    const [call] = mocks.linkIdentity.mock.calls as [
      [{ options: { redirectTo: string } }],
    ];
    const sent = call[0].options.redirectTo;
    expect(sent).not.toBe("/dashboard/abc-123");
    expect(sent.startsWith("http://localhost:3000/auth/callback")).toBe(true);
  });

  it("이미 다른 계정에 연결된 Google이면 identity_taken", async () => {
    mocks.linkIdentity.mockResolvedValue({
      error: { code: "identity_already_exists", message: "Identity is already linked to another user" },
    });

    const result = await linkGoogle("/dashboard");

    expect(result.error).toBe("identity_taken");
  });

  it("이미 이 계정에 연결돼 있으면 already_linked", async () => {
    mocks.linkIdentity.mockResolvedValue({
      error: { code: "provider_already_linked", message: "already linked" },
    });

    const result = await linkGoogle("/dashboard");

    expect(result.error).toBe("already_linked");
  });

  it("그 외 실패는 unknown", async () => {
    mocks.linkIdentity.mockResolvedValue({
      error: { code: "network_error", message: "boom" },
    });

    const result = await linkGoogle("/dashboard");

    expect(result.error).toBe("unknown");
  });

  it("실패해도 signOut을 호출하지 않는다 — 익명 세션과 결과를 보존한다", async () => {
    mocks.linkIdentity.mockResolvedValue({
      error: { code: "identity_already_exists", message: "taken" },
    });

    await linkGoogle("/dashboard");

    expect(mocks.signOut).not.toHaveBeenCalled();
  });
});

describe("signInGoogle", () => {
  it("signInWithOAuth를 호출한다", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ error: null });

    await signInGoogle("/dashboard");

    expect(mocks.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: {
        redirectTo: "http://localhost:3000/auth/callback?next=%2Fdashboard",
      },
    });
  });
});

describe("decideAuthRoute와의 연동", () => {
  it("'link'이면 linkGoogle(linkIdentity)이 호출되고 signInWithOAuth는 호출되지 않는다", async () => {
    mocks.linkIdentity.mockResolvedValue({ error: null });
    const route = decideAuthRoute({ isAnonymous: true, hasPendingAnalysis: true });
    expect(route).toBe("link");

    if (route === "link") {
      await linkGoogle("/dashboard");
    } else {
      await signInGoogle("/dashboard");
    }

    expect(mocks.linkIdentity).toHaveBeenCalledTimes(1);
    expect(mocks.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("'signin'이면 signInGoogle(signInWithOAuth)이 호출되고 linkIdentity는 호출되지 않는다", async () => {
    mocks.signInWithOAuth.mockResolvedValue({ error: null });
    const route = decideAuthRoute({ isAnonymous: false, hasPendingAnalysis: false });
    expect(route).toBe("signin");

    if (route === "link") {
      await linkGoogle("/dashboard");
    } else {
      await signInGoogle("/dashboard");
    }

    expect(mocks.signInWithOAuth).toHaveBeenCalledTimes(1);
    expect(mocks.linkIdentity).not.toHaveBeenCalled();
  });
});
