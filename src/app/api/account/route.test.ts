import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabase: vi.fn(),
  from: vi.fn(),
  signOut: vi.fn(),
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

import { DELETE } from "./route";

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

  mocks.requireUser.mockResolvedValue(user());
  mocks.createServerSupabase.mockResolvedValue({
    from: mocks.from,
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
