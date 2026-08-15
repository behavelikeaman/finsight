import { describe, expect, it } from "vitest";

import type { NormalizedRow } from "@/types/domain";

import { summarize } from "./summarize";

function row(
  occurredOn: string,
  merchant: string,
  amountKrw: number,
): NormalizedRow {
  return { occurredOn, merchant, amountKrw };
}

describe("summarize", () => {
  it("빈 입력에도 형태를 유지한다", () => {
    expect(summarize([])).toEqual({
      totalKrw: 0,
      rowCount: 0,
      periods: [],
      topMerchants: [],
    });
  });

  it("총액과 행 수를 센다", () => {
    const summary = summarize([
      row("2026-01-05", "스타벅스", 5500),
      row("2026-01-07", "쿠팡", 32000),
    ]);

    expect(summary.totalKrw).toBe(37500);
    expect(summary.rowCount).toBe(2);
  });

  it("음수(환불) 행을 그대로 더한다", () => {
    const summary = summarize([
      row("2026-01-05", "쿠팡", 32000),
      row("2026-01-09", "쿠팡", -32000),
      row("2026-01-10", "스타벅스", 5500),
    ]);

    expect(summary.totalKrw).toBe(5500);
    expect(summary.rowCount).toBe(3);
  });

  it("합계가 정수를 유지한다", () => {
    const summary = summarize([
      row("2026-01-05", "A", 1),
      row("2026-01-05", "B", 2),
      row("2026-01-05", "C", 3),
    ]);

    expect(Number.isInteger(summary.totalKrw)).toBe(true);
    expect(summary.topMerchants.every((m) => Number.isInteger(m.amountKrw))).toBe(
      true,
    );
    expect(summary.periods.every((p) => Number.isInteger(p.totalKrw))).toBe(true);
  });

  it("월별로 묶어 오름차순 정렬한다", () => {
    const summary = summarize([
      row("2026-03-01", "A", 1000),
      row("2026-01-05", "B", 2000),
      row("2026-01-20", "C", 3000),
      row("2026-02-03", "D", 4000),
    ]);

    expect(summary.periods).toEqual([
      { period: "2026-01", totalKrw: 5000 },
      { period: "2026-02", totalKrw: 4000 },
      { period: "2026-03", totalKrw: 1000 },
    ]);
  });

  it("가맹점별 합계를 내림차순 상위 10건만 낸다", () => {
    const rows = Array.from({ length: 12 }, (_, index) =>
      row("2026-01-05", `가맹점${index}`, (index + 1) * 1000),
    );

    const summary = summarize(rows);

    expect(summary.topMerchants).toHaveLength(10);
    expect(summary.topMerchants[0]).toEqual({
      merchant: "가맹점11",
      amountKrw: 12000,
    });
    expect(summary.topMerchants.map((m) => m.amountKrw)).toEqual([
      12000, 11000, 10000, 9000, 8000, 7000, 6000, 5000, 4000, 3000,
    ]);
  });

  it("가맹점명의 앞뒤·연속 공백만 정리해 묶는다", () => {
    const summary = summarize([
      row("2026-01-05", " 스타벅스  강남점 ", 5500),
      row("2026-01-06", "스타벅스 강남점", 4500),
    ]);

    expect(summary.topMerchants).toEqual([
      { merchant: "스타벅스 강남점", amountKrw: 10000 },
    ]);
  });

  it("지점 표기를 제거해 병합하지 않는다", () => {
    const summary = summarize([
      row("2026-01-05", "스타벅스 강남점", 5500),
      row("2026-01-06", "스타벅스 판교점", 4500),
    ]);

    expect(summary.topMerchants).toHaveLength(2);
  });
});
