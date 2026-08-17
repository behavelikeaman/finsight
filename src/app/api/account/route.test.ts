import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabase: vi.fn(),
  from: vi.fn(),
  signOut: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/supabase/session", async (importActual) => {
  const actual =
    await importActual<typeof import("@/lib/supabase/session")>();
  return { ...actual, requireUser: mocks.requireUser };
});

vi.mock("@/lib/supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

import { UnauthorizedError } from "@/lib/supabase/session";

import { DELETE, PATCH } from "./route";

function user(overrides: Partial<User> = {}): User {
  return {
    id: "uid-1",
    app_metadata: {},
    user_metadata: {},
    aud: "authenticated",
    created_at: "2026-01-01T00:00:00Z",
    is_anonymous: false,
    ...overrides,
  } as User;
}

function chain() {
  const obj: {
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    then: (resolve: (v: unknown) => unknown) => unknown;
  } = {
    delete: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    then: (resolve) => Promise.resolve({ data: null, error: null }).then(resolve),
  };
  return obj;
}

let fromCalls: string[];
let chains: Record<string, ReturnType<typeof chain>[]>;

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.from.mockReset();
  mocks.signOut.mockReset();
  mocks.rpc.mockReset();

  mocks.requireUser.mockResolvedValue(user());
  mocks.rpc.mockResolvedValue({ data: true, error: null });
  mocks.createServerSupabase.mockResolvedValue({
    from: mocks.from,
    rpc: mocks.rpc,
    auth: { signOut: mocks.signOut },
  });

  fromCalls = [];
  chains = {};

  mocks.from.mockImplementation((table: string) => {
    fromCalls.push(table);
    const c = chain();
    chains[table] = [...(chains[table] ?? []), c];
    return c;
  });
});

describe("DELETE /api/account", () => {
  it("미인증이면 401", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await DELETE();

    expect(res.status).toBe(401);
  });

  it("정상 시 analyses·user_rules를 지우고 signOut을 호출한다", async () => {
    const res = await DELETE();
    const json = (await res.json()) as { ok: boolean };

    expect(json.ok).toBe(true);
    expect(fromCalls).toContain("analyses");
    expect(fromCalls).toContain("user_rules");
    expect(mocks.signOut).toHaveBeenCalledTimes(1);
  });

  it("owner_id로만 삭제한다", async () => {
    await DELETE();

    const analysesChain = chains["analyses"]?.[0];
    expect(analysesChain?.eq).toHaveBeenCalledWith("owner_id", "uid-1");
  });

  it("profiles를 건드리지 않는다", async () => {
    await DELETE();

    expect(fromCalls).not.toContain("profiles");
  });

  it("usage_counters에 접근하지 않는다", async () => {
    await DELETE();

    expect(fromCalls).not.toContain("usage_counters");
  });
});

function patchRequest(body: unknown, raw?: string): Request {
  return new Request("http://localhost/api/account", {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: raw ?? JSON.stringify(body),
  });
}

describe("PATCH /api/account", () => {
  it("미인증이면 401", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await PATCH(patchRequest({ emailOptIn: true }));

    expect(res.status).toBe(401);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("익명 세션이면 403이고 RPC를 부르지 않는다", async () => {
    mocks.requireUser.mockResolvedValue(user({ is_anonymous: true }));

    const res = await PATCH(patchRequest({ emailOptIn: true }));
    const json = (await res.json()) as { ok: boolean; reason?: string };

    expect(res.status).toBe(403);
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("anonymous_denied");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("emailOptIn이 boolean이 아니면 400이고 RPC를 부르지 않는다", async () => {
    const res = await PATCH(patchRequest({ emailOptIn: "true" }));
    const json = (await res.json()) as { ok: boolean; reason?: string };

    expect(res.status).toBe(400);
    expect(json.reason).toBe("invalid");
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("emailOptIn이 없으면 400", async () => {
    const res = await PATCH(patchRequest({}));

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("본문이 JSON이 아니면 400", async () => {
    const res = await PATCH(patchRequest(null, "not json"));

    expect(res.status).toBe(400);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("동의를 켜면 set_email_opt_in RPC를 호출하고 200을 준다", async () => {
    mocks.rpc.mockResolvedValue({ data: true, error: null });

    const res = await PATCH(patchRequest({ emailOptIn: true }));
    const json = (await res.json()) as { ok: boolean; emailOptIn?: boolean };

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("set_email_opt_in", {
      opt_in: true,
    });
    expect(json).toEqual({ ok: true, emailOptIn: true });
  });

  it("동의를 끄면(해지) 같은 RPC를 false로 호출한다", async () => {
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const res = await PATCH(patchRequest({ emailOptIn: false }));
    const json = (await res.json()) as { ok: boolean; emailOptIn?: boolean };

    expect(res.status).toBe(200);
    expect(mocks.rpc).toHaveBeenCalledWith("set_email_opt_in", {
      opt_in: false,
    });
    expect(json).toEqual({ ok: true, emailOptIn: false });
  });

  it("요청 값이 아니라 RPC가 돌려준 값을 echo한다", async () => {
    // DB가 저장한 값이 정답이다. 요청 값을 되돌려주면 화면과 DB가 어긋난다.
    mocks.rpc.mockResolvedValue({ data: false, error: null });

    const res = await PATCH(patchRequest({ emailOptIn: true }));
    const json = (await res.json()) as { emailOptIn?: boolean };

    expect(json.emailOptIn).toBe(false);
  });

  it("RPC가 실패하면 500", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    const res = await PATCH(patchRequest({ emailOptIn: true }));
    const json = (await res.json()) as { ok: boolean; reason?: string };

    expect(res.status).toBe(500);
    expect(json.ok).toBe(false);
    expect(json.reason).toBe("write_failed");
  });

  it("profiles를 직접 UPDATE하지 않는다", async () => {
    // 0002가 걷어낸 사용자 UPDATE 권한을 다시 쓰려는 회귀를 막는다.
    await PATCH(patchRequest({ emailOptIn: true }));

    expect(fromCalls).not.toContain("profiles");
  });
});
