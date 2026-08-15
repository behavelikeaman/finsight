import { describe, expect, it } from "vitest";

import { parseAmountKrw, parseDate } from "./normalize";

describe("parseAmountKrw", () => {
  it("천 단위 구분자를 제거한다", () => {
    expect(parseAmountKrw("1,234")).toBe(1234);
    expect(parseAmountKrw("1,234,567")).toBe(1234567);
  });

  it("원화 기호와 단위를 제거한다", () => {
    expect(parseAmountKrw("₩1,234")).toBe(1234);
    expect(parseAmountKrw("1234원")).toBe(1234);
    expect(parseAmountKrw("  ₩ 1,234 원 ")).toBe(1234);
  });

  it("음수 표기 두 가지를 모두 처리한다", () => {
    expect(parseAmountKrw("-1,234")).toBe(-1234);
    expect(parseAmountKrw("(1,234)")).toBe(-1234);
    expect(parseAmountKrw("(₩1,234)")).toBe(-1234);
  });

  it("소수부가 0이면 버린다", () => {
    expect(parseAmountKrw("1,234.00")).toBe(1234);
    expect(parseAmountKrw("1234.000")).toBe(1234);
  });

  it("소수부가 0이 아니면 반올림해 정수를 만든다", () => {
    expect(parseAmountKrw("1234.5")).toBe(1235);
    expect(parseAmountKrw("1234.49")).toBe(1234);
    expect(parseAmountKrw("-1234.5")).toBe(-1235);
  });

  it("0을 정상 값으로 반환한다", () => {
    expect(parseAmountKrw("0")).toBe(0);
  });

  it("정수만 반환한다", () => {
    const value = parseAmountKrw("12,345.67");
    expect(value).not.toBeNull();
    expect(Number.isInteger(value)).toBe(true);
  });

  it("금액이 아닌 값은 null이다", () => {
    expect(parseAmountKrw("")).toBeNull();
    expect(parseAmountKrw("   ")).toBeNull();
    expect(parseAmountKrw("일시불")).toBeNull();
    expect(parseAmountKrw("2026-01-05")).toBeNull();
  });

  it("카드번호를 금액으로 읽지 않는다", () => {
    expect(parseAmountKrw("1234-5678-9012-3456")).toBeNull();
    expect(parseAmountKrw("1234********3456")).toBeNull();
  });
});

describe("parseDate", () => {
  it("구분자 세 종류를 처리한다", () => {
    expect(parseDate("2026.08.10")).toBe("2026-08-10");
    expect(parseDate("2026-08-10")).toBe("2026-08-10");
    expect(parseDate("2026/08/10")).toBe("2026-08-10");
  });

  it("한 자리 월·일을 0으로 채운다", () => {
    expect(parseDate("2026.8.1")).toBe("2026-08-01");
  });

  it("구분자 없는 8자리를 처리한다", () => {
    expect(parseDate("20260810")).toBe("2026-08-10");
  });

  it("한글 표기를 처리한다", () => {
    expect(parseDate("2026년 8월 10일")).toBe("2026-08-10");
    expect(parseDate("2026년8월10일")).toBe("2026-08-10");
  });

  it("연도가 없으면 fallbackYear를 쓴다", () => {
    expect(parseDate("08/10", 2026)).toBe("2026-08-10");
    expect(parseDate("08.10", 2025)).toBe("2025-08-10");
  });

  it("연도가 없고 fallbackYear도 없으면 null이다", () => {
    expect(parseDate("08/10")).toBeNull();
  });

  it("실재하지 않는 날짜는 null이다", () => {
    expect(parseDate("2026-13-01")).toBeNull();
    expect(parseDate("2026-02-30")).toBeNull();
    expect(parseDate("20261301")).toBeNull();
  });

  it("날짜가 아닌 값은 null이다", () => {
    expect(parseDate("")).toBeNull();
    expect(parseDate("스타벅스")).toBeNull();
    expect(parseDate("5,500")).toBeNull();
  });
});
