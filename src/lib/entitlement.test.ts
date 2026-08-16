import { describe, expect, it } from "vitest";

import { isEntitledStatus } from "./entitlement";

describe("isEntitledStatus", () => {
  it("정상 구독은 권리가 있다", () => {
    expect(isEntitledStatus("active")).toBe(true);
    expect(isEntitledStatus("trialing")).toBe(true);
  });

  // 재청구가 성공하면 곧 active로 돌아온다. 그 사이 잘라내면 사용자는
  // 이유를 모른 채 기능을 잃는다. 기간이 지나면 effective_tier가 닫는다.
  it("결제 실패(past_due)는 재시도 중이므로 권리를 거두지 않는다", () => {
    expect(isEntitledStatus("past_due")).toBe(true);
  });

  it("해지·미납 확정은 권리가 없다", () => {
    expect(isEntitledStatus("canceled")).toBe(false);
    expect(isEntitledStatus("unpaid")).toBe(false);
    expect(isEntitledStatus("incomplete")).toBe(false);
  });

  // 모르는 값에 권리를 주면, Polar가 상태를 추가하는 날 결제 없이 열린다.
  it("모르는 상태는 닫는다", () => {
    expect(isEntitledStatus("something_new")).toBe(false);
    expect(isEntitledStatus("")).toBe(false);
  });
});
