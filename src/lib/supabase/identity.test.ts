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

import { linkGoogle, signInGoogle } from "./identity";

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
});

describe("linkGoogle", () => {
  it("성공하면 error가 없다", async () => {
    mocks.linkIdentity.mockResolvedValue({ error: null });

    const result = await linkGoogle("/dashboard");

    expect(mocks.linkIdentity).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "/dashboard" },
    });
    expect(result.error).toBeUndefined();
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
      options: { redirectTo: "/dashboard" },
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
