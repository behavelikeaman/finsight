import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  exchangeCodeForSession: vi.fn(),
  createServerSupabase: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

import { GET } from "./route";

function request(query: string): NextRequest {
  return new NextRequest(`http://localhost/auth/callback${query}`);
}

beforeEach(() => {
  mocks.exchangeCodeForSession.mockReset();
  mocks.createServerSupabase.mockResolvedValue({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSession },
  });
});

describe("GET /auth/callback", () => {
  it("code를 세션으로 교환하고 next로 리다이렉트한다", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(request("?code=abc123&next=/analyses/analysis-1"));

    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith("abc123");
    expect(res.status).toBe(307);
    expect(res.headers.get("location")).toBe(
      "http://localhost/analyses/analysis-1",
    );
  });

  it("next가 없으면 /dashboard로 보낸다", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(request("?code=abc123"));

    expect(res.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("next가 외부 URL이면 거부하고 기본 경로로 보낸다", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      request("?code=abc123&next=https://evil.com/steal"),
    );

    expect(res.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("next가 프로토콜 상대 URL(//)이면 거부한다", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(request("?code=abc123&next=//evil.com"));

    expect(res.headers.get("location")).toBe("http://localhost/dashboard");
  });

  // 프리픽스 문자열 검사만으로는 부족하다. WHATWG URL 파서는 http(s) 스킴에서
  // 백슬래시를 슬래시와 똑같이 취급하므로, `//`로 시작하지 않는 `/\evil.com`도
  // 외부 오리진으로 풀린다.
  it("next가 백슬래시 변형(/\\)이면 거부한다", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(request("?code=abc123&next=/%5Cevil.com"));

    expect(res.headers.get("location")).toBe("http://localhost/dashboard");
  });

  it("OAuth 에러 경로에서도 백슬래시 변형을 거부한다", async () => {
    const res = await GET(request("?error=access_denied&next=/%5Cevil.com"));

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("http://localhost");
    expect(location.pathname).toBe("/dashboard");
  });

  // safeNext는 통과한 값을 그대로 돌려주지 않고 pathname·search·hash로 다시
  // 조립한다. 조립에서 한 조각이라도 빠지면 도착 화면이 탭·앵커를 잃는다.
  it("next의 쿼리와 해시를 보존한 채 리다이렉트한다", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({ error: null });

    const res = await GET(
      request(
        "?code=abc123&next=%2Fanalyses%2Fanalysis-1%3Ftab%3Dsummary%23section",
      ),
    );

    expect(res.headers.get("location")).toBe(
      "http://localhost/analyses/analysis-1?tab=summary#section",
    );
  });

  it("code가 없으면 에러 쿼리를 달아 next로 되돌린다", async () => {
    const res = await GET(request("?next=/analyses/analysis-1"));

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/analyses/analysis-1");
    expect(location.searchParams.get("auth_error")).toBeTruthy();
  });

  it("교환이 실패하면 에러 쿼리를 달아 next로 되돌린다 — 결과를 잃지 않는다", async () => {
    mocks.exchangeCodeForSession.mockResolvedValue({
      error: { message: "invalid code" },
    });

    const res = await GET(request("?code=bad&next=/analyses/analysis-1"));

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/analyses/analysis-1");
    expect(location.searchParams.get("auth_error")).toBeTruthy();
  });

  // Supabase는 연결 실패를 code 없이 error_code 쿼리로 돌려보낸다. 이걸 구분하지
  // 않으면 "이미 가입된 Google"과 "코드 누락"이 같은 메시지가 되어, 사용자는
  // 무엇을 해야 하는지 알 수 없는 채로 화면에 갇힌다.
  it("이미 다른 계정에 연결된 Google이면 identity_taken으로 되돌린다", async () => {
    const res = await GET(
      request(
        "?error=server_error&error_code=identity_already_exists&next=/analyses/analysis-1",
      ),
    );

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.pathname).toBe("/analyses/analysis-1");
    expect(location.searchParams.get("auth_error")).toBe("identity_taken");
  });

  it("그 밖의 OAuth 실패는 oauth_failed로 되돌린다", async () => {
    const res = await GET(
      request("?error=access_denied&next=/analyses/analysis-1"),
    );

    expect(mocks.exchangeCodeForSession).not.toHaveBeenCalled();
    const location = new URL(res.headers.get("location") ?? "");
    expect(location.searchParams.get("auth_error")).toBe("oauth_failed");
  });

  it("OAuth 에러가 와도 next의 오리진 검사는 그대로 적용한다", async () => {
    const res = await GET(
      request("?error_code=identity_already_exists&next=https://evil.com/steal"),
    );

    const location = new URL(res.headers.get("location") ?? "");
    expect(location.origin).toBe("http://localhost");
    expect(location.pathname).toBe("/dashboard");
  });
});
