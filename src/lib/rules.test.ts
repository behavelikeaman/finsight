import { describe, expect, it } from "vitest";

import type { IdentifiedRow } from "@/types/domain";
import type { UserRuleRow } from "@/types/db";

import { applyRules, derivePattern } from "./rules";

function rule(overrides: Partial<UserRuleRow> = {}): UserRuleRow {
  return {
    id: "rule-1",
    owner_id: "uid-1",
    merchant_pattern: "스타벅스",
    classification: "business",
    account_code: "entertainment",
    created_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function row(overrides: Partial<IdentifiedRow> = {}): IdentifiedRow {
  return {
    id: "t1",
    occurredOn: "2026-01-05",
    merchant: "스타벅스 강남점",
    amountKrw: 5000,
    ...overrides,
  };
}

describe("applyRules", () => {
  it("부분 문자열로 매칭한다", () => {
    const result = applyRules([row()], [rule()]);

    expect(result.matched).toHaveLength(1);
    expect(result.unmatched).toHaveLength(0);
    expect(result.matched[0]).toMatchObject({
      classification: "business",
      accountCode: "entertainment",
      ruleId: "rule-1",
    });
  });

  it("매칭되지 않으면 unmatched에 남는다", () => {
    const result = applyRules(
      [row({ id: "t2", merchant: "이디야커피" })],
      [rule()],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched.map((r) => r.id)).toEqual(["t2"]);
  });

  it("빈 규칙 배열이면 전건 unmatched", () => {
    const result = applyRules([row(), row({ id: "t2" })], []);

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(2);
  });

  it("가장 긴 패턴이 이긴다", () => {
    const rules = [
      rule({ id: "r1", merchant_pattern: "스타벅스", classification: "personal" }),
      rule({
        id: "r2",
        merchant_pattern: "스타벅스 강남점",
        classification: "business",
        account_code: "entertainment",
      }),
    ];

    const result = applyRules([row()], rules);

    expect(result.matched[0]?.ruleId).toBe("r2");
    expect(result.matched[0]?.classification).toBe("business");
  });

  it("매칭된 건은 unmatched에 없다", () => {
    const rows = [row({ id: "t1" }), row({ id: "t2", merchant: "이디야" })];
    const result = applyRules(rows, [rule()]);

    const unmatchedIds = result.unmatched.map((r) => r.id);
    expect(unmatchedIds).not.toContain("t1");
    expect(unmatchedIds).toContain("t2");
  });

  it("merchant_pattern에 .*가 들어와도 정규식으로 해석하지 않는다", () => {
    const result = applyRules(
      [row({ merchant: "아무개 상점" })],
      [rule({ merchant_pattern: ".*" })],
    );

    // 리터럴 '.*'가 가맹점명에 없으므로 매칭되지 않는다. 정규식이었다면 전건 매칭됐을 것.
    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it("merchant_pattern에 [a-z]+가 들어와도 정규식으로 해석하지 않는다", () => {
    const result = applyRules(
      [row({ merchant: "abc상점" })],
      [rule({ merchant_pattern: "[a-z]+" })],
    );

    expect(result.matched).toHaveLength(0);
    expect(result.unmatched).toHaveLength(1);
  });

  it("matched·unmatched 양쪽에 원본 id가 보존된다", () => {
    const rows = [
      row({ id: "keep-1" }),
      row({ id: "keep-2", merchant: "이디야" }),
    ];
    const result = applyRules(rows, [rule()]);

    expect(result.matched[0]?.row.id).toBe("keep-1");
    expect(result.unmatched[0]?.id).toBe("keep-2");
  });

  it("공백·대소문자를 무시하고 매칭한다", () => {
    const result = applyRules(
      [row({ merchant: "STARBUCKS 강남점" })],
      [rule({ merchant_pattern: "starbucks" })],
    );

    expect(result.matched).toHaveLength(1);
  });
});

describe("derivePattern", () => {
  it("지점 꼬리를 뗀다", () => {
    expect(derivePattern("스타벅스 강남점")).toBe("스타벅스");
  });

  it("번호 꼬리를 뗀다", () => {
    expect(derivePattern("던킨도너츠 2호점")).toBe("던킨도너츠");
  });

  it("원본이 4자 이하면 그대로 쓴다", () => {
    expect(derivePattern("GS25")).toBe("GS25");
    expect(derivePattern("이디야")).toBe("이디야");
  });

  it("공백이 없으면 그대로 쓴다", () => {
    expect(derivePattern("이마트24시편의점")).toBe("이마트24시편의점");
  });

  it("지점 표기가 없으면 그대로 쓴다", () => {
    expect(derivePattern("스타벅스 코리아")).toBe("스타벅스 코리아");
  });
});
