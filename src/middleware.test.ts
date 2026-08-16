import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type CookieToSet = { name: string; value: string; options?: object };
type CookieAdapter = {
  getAll: () => { name: string; value: string }[];
  setAll: (cookies: CookieToSet[]) => void;
};

const mocks = vi.hoisted(() => ({
  createServerClient: vi.fn(),
  getUser: vi.fn(),
}));

vi.mock("@supabase/ssr", () => ({
  createServerClient: mocks.createServerClient,
}));

import { config, middleware } from "./middleware";

const ORIGINAL = { ...process.env };

/** getUser() 호출 시 세션 쿠키를 갱신하는(= setAll을 부르는) 클라이언트를 흉내낸다. */
function mockSupabase(refreshed: CookieToSet[] = []) {
  mocks.createServerClient.mockImplementation(
    (_url: string, _key: string, options: { cookies: CookieAdapter }) => ({
      auth: {
        getUser: mocks.getUser.mockImplementation(async () => {
          if (refreshed.length > 0) options.cookies.setAll(refreshed);
          return { data: { user: null }, error: null };
        }),
      },
    }),
  );
}

beforeEach(() => {
  mocks.createServerClient.mockReset();
  mocks.getUser.mockReset();
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "anon-key";
});

afterEach(() => {
  process.env = { ...ORIGINAL };
});

describe("middleware", () => {
  it("세션을 갱신하기 위해 getUser를 호출한다", async () => {
    mockSupabase();

    await middleware(new NextRequest("http://localhost:3000/analyses/1"));

    expect(mocks.getUser).toHaveBeenCalledTimes(1);
  });

  it("갱신된 쿠키를 응답에 실어 보낸다", async () => {
    mockSupabase([
      { name: "sb-access-token", value: "refreshed", options: { path: "/" } },
    ]);

    const response = await middleware(
      new NextRequest("http://localhost:3000/analyses/1"),
    );

    expect(response.cookies.get("sb-access-token")?.value).toBe("refreshed");
  });

  it("요청 쿠키를 그대로 읽는다", async () => {
    mockSupabase();
    const request = new NextRequest("http://localhost:3000/");
    request.cookies.set("sb-access-token", "existing");

    await middleware(request);

    const call = mocks.createServerClient.mock.calls[0] as unknown as [
      string,
      string,
      { cookies: CookieAdapter },
    ];
    expect(call[2].cookies.getAll()).toContainEqual(
      expect.objectContaining({ name: "sb-access-token", value: "existing" }),
    );
  });

  it("anon 키로만 동작한다 — service role 키를 쓰지 않는다", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-key";
    mockSupabase();

    await middleware(new NextRequest("http://localhost:3000/"));

    const call = mocks.createServerClient.mock.calls[0] as unknown as [string, string];
    expect(call[1]).toBe("anon-key");
  });

  it("환경변수가 없으면 세션 갱신을 건너뛰고 요청을 통과시킨다", async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    mockSupabase();

    const response = await middleware(new NextRequest("http://localhost:3000/"));

    expect(mocks.createServerClient).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
  });

  it("세션을 새로 만들지 않는다 — auth에서 getUser 외에는 아무것도 부르지 않는다", async () => {
    const touched: string[] = [];
    mocks.createServerClient.mockImplementation(() => ({
      auth: new Proxy(
        {},
        {
          get(_target, property: string) {
            touched.push(property);
            return async () => ({ data: { user: null }, error: null });
          },
        },
      ),
    }));

    await middleware(new NextRequest("http://localhost:3000/"));

    // 미들웨어는 모든 요청에 걸린다. 여기서 세션을 만들면 크롤러까지 계정이 생긴다.
    expect(touched).toEqual(["getUser"]);
  });
});

describe("config.matcher", () => {
  const matches = (pathname: string) => {
    const pattern = config.matcher[0] ?? "";
    return new RegExp(`^${pattern}$`).test(pathname);
  };

  it("앱 경로는 통과시킨다", () => {
    expect(matches("/")).toBe(true);
    expect(matches("/analyses/abc")).toBe(true);
    expect(matches("/api/analyze")).toBe(true);
  });

  it("정적 자산·이미지·favicon은 제외한다", () => {
    expect(matches("/_next/static/chunk.js")).toBe(false);
    expect(matches("/_next/image")).toBe(false);
    expect(matches("/favicon.ico")).toBe(false);
    expect(matches("/logo.svg")).toBe(false);
    expect(matches("/screenshot.png")).toBe(false);
  });
});
