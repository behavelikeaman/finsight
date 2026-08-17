import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createAdminSupabase: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminSupabase: mocks.createAdminSupabase,
}));

import { POST } from "./route";

describe("POST /api/reclassify", () => {
  it("핸들러가 정의되어 있다", () => {
    expect(POST).toBeDefined();
  });

  it("함수 시그니처가 하나의 인자를 받는다", () => {
    expect(POST.length).toBe(1);
  });
});
