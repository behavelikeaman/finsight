import { describe, expect, it } from "vitest";

import { decide } from "./review-gate.mjs";

const verdictOf = (counts, verdict) => ({ verdict, counts });

describe("차단 — critical·major는 승인도 머지도 없다", () => {
  it("critical이 1건이라도 있으면 차단한다", () => {
    const d = decide(verdictOf({ critical: 1, major: 0, minor: 0, nit: 0 }, "Blocked"));
    expect(d.action).toBe("block");
  });

  it("major가 1건이라도 있으면 차단한다", () => {
    const d = decide(
      verdictOf({ critical: 0, major: 1, minor: 0, nit: 0 }, "Changes Requested"),
    );
    expect(d.action).toBe("block");
  });

  it("minor·nit이 아무리 많아도 major가 있으면 차단이다", () => {
    const d = decide(
      verdictOf({ critical: 0, major: 2, minor: 9, nit: 9 }, "Changes Requested"),
    );
    expect(d.action).toBe("block");
  });
});

describe("승인만 — minor가 있으면 머지는 사람이 한다", () => {
  it("minor가 있으면 approve까지만 한다", () => {
    const d = decide(verdictOf({ critical: 0, major: 0, minor: 1, nit: 0 }, "Approve"));
    expect(d.action).toBe("approve");
  });

  it("minor와 nit이 섞여 있어도 approve까지만 한다", () => {
    const d = decide(verdictOf({ critical: 0, major: 0, minor: 3, nit: 5 }, "Approve"));
    expect(d.action).toBe("approve");
  });
});

describe("자동 머지 — nit만 있거나 아무것도 없을 때", () => {
  it("발견이 하나도 없으면 머지한다", () => {
    const d = decide(verdictOf({ critical: 0, major: 0, minor: 0, nit: 0 }, "Approve"));
    expect(d.action).toBe("merge");
  });

  it("nit만 있으면 머지한다", () => {
    const d = decide(verdictOf({ critical: 0, major: 0, minor: 0, nit: 4 }, "Approve"));
    expect(d.action).toBe("merge");
  });
});

describe("불신 조건 — 판정을 믿을 수 없으면 차단한다", () => {
  it("판정 파일이 없으면 차단한다", () => {
    expect(decide(null).action).toBe("block");
  });

  it("counts가 없거나 숫자가 아니면 차단한다", () => {
    expect(decide({ verdict: "Approve" }).action).toBe("block");
    expect(
      decide(verdictOf({ critical: "0", major: 0, minor: 0, nit: 0 }, "Approve")).action,
    ).toBe("block");
    expect(
      decide(verdictOf({ critical: 0, major: 0, minor: 0 }, "Approve")).action,
    ).toBe("block");
  });

  it("모르는 verdict 문자열이면 차단한다", () => {
    expect(
      decide(verdictOf({ critical: 0, major: 0, minor: 0, nit: 0 }, "LGTM")).action,
    ).toBe("block");
  });

  // 자동 머지는 되돌리기 어려운 경로다. 숫자와 판정이 어긋나면
  // 어느 쪽이 맞는지 알 수 없으므로 관대한 쪽을 고르지 않는다.
  it("counts와 verdict가 어긋나면 차단한다", () => {
    const lying = verdictOf({ critical: 0, major: 0, minor: 0, nit: 0 }, "Blocked");
    expect(decide(lying).action).toBe("block");

    const alsoLying = verdictOf({ critical: 3, major: 0, minor: 0, nit: 0 }, "Approve");
    expect(decide(alsoLying).action).toBe("block");
  });

  it("음수 개수는 차단한다", () => {
    expect(
      decide(verdictOf({ critical: -1, major: 0, minor: 0, nit: 0 }, "Approve")).action,
    ).toBe("block");
  });
});

describe("결정에는 항상 사람이 읽을 이유가 붙는다", () => {
  it("각 분기가 reason을 채운다", () => {
    const cases = [
      verdictOf({ critical: 1, major: 0, minor: 0, nit: 0 }, "Blocked"),
      verdictOf({ critical: 0, major: 0, minor: 2, nit: 0 }, "Approve"),
      verdictOf({ critical: 0, major: 0, minor: 0, nit: 0 }, "Approve"),
      null,
    ];

    for (const c of cases) {
      expect(decide(c).reason).toBeTruthy();
    }
  });
});
