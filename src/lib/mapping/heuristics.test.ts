import { describe, expect, it } from "vitest";

import { guessMapping } from "./heuristics";

describe("guessMapping — 별칭 사전", () => {
  it("한국 카드사 헤더를 매핑한다", () => {
    expect(guessMapping(["이용일자", "가맹점명", "이용금액"])).toEqual({
      date: "이용일자",
      merchant: "가맹점명",
      amount: "이용금액",
    });
  });

  it("카드사마다 다른 별칭을 모두 인식한다", () => {
    expect(guessMapping(["승인일", "이용하신곳", "승인금액"])).toEqual({
      date: "승인일",
      merchant: "이용하신곳",
      amount: "승인금액",
    });
    expect(guessMapping(["거래일자", "적요", "거래금액"])).toEqual({
      date: "거래일자",
      merchant: "적요",
      amount: "거래금액",
    });
  });

  it("영문 헤더를 인식한다", () => {
    expect(guessMapping(["Transaction Date", "Merchant", "Amount"])).toEqual({
      date: "Transaction Date",
      merchant: "Merchant",
      amount: "Amount",
    });
  });

  it("공백·괄호를 무시하고 비교한다", () => {
    expect(guessMapping([" 이용 일자 ", "가맹점명", "이용금액(원)"])).toEqual({
      date: " 이용 일자 ",
      merchant: "가맹점명",
      amount: "이용금액(원)",
    });
  });

  it("걸리는 헤더가 없으면 null이다", () => {
    expect(guessMapping(["할부개월", "승인번호"])).toEqual({
      date: null,
      merchant: null,
      amount: null,
    });
  });
});

describe("guessMapping — 금액 후보 우선순위", () => {
  it("외화 컬럼이 함께 있으면 원화 계열을 고른다", () => {
    const mapping = guessMapping([
      "이용일자",
      "가맹점명",
      "이용금액(USD)",
      "원화금액",
    ]);

    expect(mapping.amount).toBe("원화금액");
  });

  it("청구금액을 이용금액보다 먼저 고른다", () => {
    const mapping = guessMapping([
      "이용일자",
      "가맹점명",
      "이용금액",
      "청구금액",
    ]);

    expect(mapping.amount).toBe("청구금액");
  });

  it("국내이용금액을 해외 컬럼보다 먼저 고른다", () => {
    const mapping = guessMapping([
      "이용일자",
      "가맹점명",
      "해외이용금액",
      "국내이용금액",
    ]);

    expect(mapping.amount).toBe("국내이용금액");
  });
});

describe("guessMapping — 카드번호 제외", () => {
  it("카드번호 컬럼은 어떤 필드에도 매핑하지 않는다", () => {
    const mapping = guessMapping([
      "카드번호",
      "카드번호뒷자리",
      "Card No",
      "이용일자",
      "가맹점명",
      "이용금액",
    ]);

    expect(Object.values(mapping)).not.toContain("카드번호");
    expect(Object.values(mapping)).not.toContain("카드번호뒷자리");
    expect(Object.values(mapping)).not.toContain("Card No");
  });

  it("별칭이 없어 값 패턴으로 추론할 때도 카드번호를 제외한다", () => {
    const headers = ["카드번호", "컬럼A", "컬럼B", "컬럼C"];
    const rows = [
      ["1234-5678-9012-3456", "2026-01-05", "스타벅스 강남점", "5,500"],
      ["1234-5678-9012-3456", "2026-01-07", "쿠팡", "32,000"],
    ];

    const mapping = guessMapping(headers, rows);

    expect(mapping.date).toBe("컬럼A");
    expect(mapping.amount).toBe("컬럼C");
    expect(Object.values(mapping)).not.toContain("카드번호");
  });
});

describe("guessMapping — 값 패턴 추론", () => {
  it("별칭에 걸리는 헤더가 없으면 값으로 날짜·금액을 추론한다", () => {
    const headers = ["A", "B", "C"];
    const rows = [
      ["2026-01-05", "스타벅스 강남점", "5,500"],
      ["2026-01-07", "쿠팡", "32,000"],
      ["2026-02-03", "GS25 역삼점", "3,200"],
    ];

    const mapping = guessMapping(headers, rows);

    expect(mapping.date).toBe("A");
    expect(mapping.amount).toBe("C");
  });

  it("행을 주지 않으면 추론하지 않는다", () => {
    expect(guessMapping(["A", "B", "C"])).toEqual({
      date: null,
      merchant: null,
      amount: null,
    });
  });
});
