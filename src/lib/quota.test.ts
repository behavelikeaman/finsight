import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getEffectiveTier: vi.fn(),
  createServerSupabase: vi.fn(),
  from: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("./supabase/session", () => ({
  getEffectiveTier: mocks.getEffectiveTier,
}));

vi.mock("./supabase/server", () => ({
  createServerSupabase: mocks.createServerSupabase,
}));

import {
  checkQuota,
  checkSampleAllowance,
  consumeQuota,
  markSampleUsed,
} from "./quota";

/** .from(table).select().eq().eq().maybeSingle() 체인을 흉내낸다. */
function chain(result: { data: unknown; error: unknown }) {
  const obj: {
    select: ReturnType<typeof vi.fn>;
    eq: ReturnType<typeof vi.fn>;
    maybeSingle: ReturnType<typeof vi.fn>;
  } = {
    select: vi.fn(() => obj),
    eq: vi.fn(() => obj),
    maybeSingle: vi.fn(() => Promise.resolve(result)),
  };
  return obj;
}

beforeEach(() => {
  mocks.getEffectiveTier.mockReset();
  mocks.from.mockReset();
  mocks.rpc.mockReset();
  mocks.createServerSupabase.mockResolvedValue({
    from: mocks.from,
    rpc: mocks.rpc,
  });
});

describe("checkQuota", () => {
  it("free classify: 사용량 0이면 허용, left=1", async () => {
    mocks.getEffectiveTier.mockResolvedValue("free");
    mocks.from.mockReturnValue(
      chain({ data: { classify_used: 0 }, error: null }),
    );

    await expect(checkQuota("uid-1", "classify")).resolves.toEqual({
      allowed: true,
      left: 1,
    });
  });

  it("free classify: 한도(1) 소진이면 거부", async () => {
    mocks.getEffectiveTier.mockResolvedValue("free");
    mocks.from.mockReturnValue(
      chain({ data: { classify_used: 1 }, error: null }),
    );

    await expect(checkQuota("uid-1", "classify")).resolves.toEqual({
      allowed: false,
      reason: "quota_exceeded",
    });
  });

  it("pro classify: 한도(10) 경계 — 9면 허용, 10이면 거부", async () => {
    mocks.getEffectiveTier.mockResolvedValue("pro");
    mocks.from.mockReturnValue(
      chain({ data: { classify_used: 9 }, error: null }),
    );

    await expect(checkQuota("uid-1", "classify")).resolves.toEqual({
      allowed: true,
      left: 1,
    });

    mocks.from.mockReturnValue(
      chain({ data: { classify_used: 10 }, error: null }),
    );

    await expect(checkQuota("uid-1", "classify")).resolves.toEqual({
      allowed: false,
      reason: "quota_exceeded",
    });
  });

  it("사용 기록이 없으면 0건으로 취급한다", async () => {
    mocks.getEffectiveTier.mockResolvedValue("pro");
    mocks.from.mockReturnValue(chain({ data: null, error: null }));

    await expect(checkQuota("uid-1", "classify")).resolves.toEqual({
      allowed: true,
      left: 10,
    });
  });

  it("chat + free → tier_required (쿼터 소진이 아니라 등급 문제)", async () => {
    mocks.getEffectiveTier.mockResolvedValue("free");

    await expect(checkQuota("uid-1", "chat")).resolves.toEqual({
      allowed: false,
      reason: "tier_required",
    });
    // free의 chatPerMonth가 0이므로 사용량 조회조차 필요 없다.
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("chat + pro: 한도(100) 안이면 허용", async () => {
    mocks.getEffectiveTier.mockResolvedValue("pro");
    mocks.from.mockReturnValue(
      chain({ data: { chat_used: 50 }, error: null }),
    );

    await expect(checkQuota("uid-1", "chat")).resolves.toEqual({
      allowed: true,
      left: 50,
    });
  });
});

describe("consumeQuota", () => {
  it("increment_usage RPC를 kind만 인자로 호출한다", async () => {
    mocks.rpc.mockResolvedValue({ data: 1, error: null });

    await consumeQuota("uid-1", "classify");

    expect(mocks.rpc).toHaveBeenCalledWith("increment_usage", {
      kind: "classify",
    });
    // 테이블을 직접 쓰지 않는다.
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("RPC가 실패하면 던진다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(consumeQuota("uid-1", "chat")).rejects.toThrow();
  });
});

describe("checkSampleAllowance", () => {
  it("sample_used가 false면 true", async () => {
    mocks.from.mockReturnValue(
      chain({ data: { sample_used: false }, error: null }),
    );

    await expect(checkSampleAllowance("uid-1")).resolves.toBe(true);
  });

  it("sample_used가 true면 false", async () => {
    mocks.from.mockReturnValue(
      chain({ data: { sample_used: true }, error: null }),
    );

    await expect(checkSampleAllowance("uid-1")).resolves.toBe(false);
  });

  it("프로필을 못 읽으면 안전하게 false", async () => {
    mocks.from.mockReturnValue(
      chain({ data: null, error: { message: "no row" } }),
    );

    await expect(checkSampleAllowance("uid-1")).resolves.toBe(false);
  });
});

describe("markSampleUsed", () => {
  it("mark_sample_used RPC를 호출한다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: null });

    await markSampleUsed("uid-1");

    expect(mocks.rpc).toHaveBeenCalledWith("mark_sample_used");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("RPC가 실패하면 던진다", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "boom" } });

    await expect(markSampleUsed("uid-1")).rejects.toThrow();
  });
});
