import type { User } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  createServerSupabase: vi.fn(),
  from: vi.fn(),
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

function chain(result: { data: unknown; error: unknown }) {
  const obj: {
    select: ReturnType<typeof vi.fn>;
    delete: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
    then: (resolve: (v: unknown) => unknown) => unknown;
  } = {
    select: vi.fn(() => obj),
    delete: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
    then: (resolve) => Promise.resolve(result).then(resolve),
  };
  return obj;
}

function ctx(id = "analysis-1") {
  return { params: Promise.resolve({ id }) };
}

let analysisOwnerRow: { id: string; owner_id: string } | null;
let deleteEqCalls: [string, unknown][];

beforeEach(() => {
  mocks.requireUser.mockReset();
  mocks.from.mockReset();
  mocks.requireUser.mockResolvedValue(user());
  mocks.createServerSupabase.mockResolvedValue({ from: mocks.from });

  analysisOwnerRow = { id: "analysis-1", owner_id: "uid-1" };
  deleteEqCalls = [];

  let calls = 0;
  mocks.from.mockImplementation((table: string) => {
    if (table !== "analyses") throw new Error(`예상치 못한 테이블: ${table}`);
    calls += 1;

    if (calls === 1) {
      return chain({ data: analysisOwnerRow, error: null });
    }

    const c = chain({ data: null, error: null });
    c.eq.mockImplementation((col: string, val: unknown) => {
      deleteEqCalls.push([col, val]);
      return c;
    });
    return c;
  });
});

describe("DELETE /api/analyses/:id", () => {
  it("미인증이면 401", async () => {
    mocks.requireUser.mockRejectedValue(new UnauthorizedError());

    const res = await DELETE(new Request("http://localhost"), ctx());

    expect(res.status).toBe(401);
  });

  it("남의 분석이면 404", async () => {
    analysisOwnerRow = null;

    const res = await DELETE(new Request("http://localhost"), ctx());

    expect(res.status).toBe(404);
  });

  it("소유한 분석이면 삭제하고 ok:true", async () => {
    const res = await DELETE(new Request("http://localhost"), ctx());
    const json = (await res.json()) as { ok: boolean };

    expect(json.ok).toBe(true);
    expect(deleteEqCalls).toContainEqual(["id", "analysis-1"]);
    expect(deleteEqCalls).toContainEqual(["owner_id", "uid-1"]);
  });
});
