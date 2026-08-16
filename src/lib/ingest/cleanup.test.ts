import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";
import { dropTotalRows, findHeaderRow } from "./cleanup";
import {
  CSV_PREAMBLE_AND_TOTAL,
  CSV_UTF8,
  CSV_WITH_PREAMBLE,
  CSV_WITH_TOTAL,
} from "./__fixtures__";

describe("findHeaderRow", () => {
  it("안내문이 없으면 첫 행이 헤더다", () => {
    expect(findHeaderRow(parseCsv(CSV_UTF8))).toBe(0);
  });

  it("상단 안내문 3줄을 건너뛴다", () => {
    expect(findHeaderRow(parseCsv(CSV_WITH_PREAMBLE))).toBe(3);
  });

  it("빈 표에서는 -1을 반환한다", () => {
    expect(findHeaderRow([])).toBe(-1);
  });

  it("셀 개수가 최대인 행이 여럿이면 첫 행을 고른다", () => {
    const rows = [
      ["안내문"],
      ["날짜", "가맹점", "금액"],
      ["2026-01-05", "쿠팡", "1000"],
    ];

    expect(findHeaderRow(rows)).toBe(1);
  });
});

describe("dropTotalRows", () => {
  it("'합계' 라벨 행을 정확히 하나만 제거한다", () => {
    const rows = parseCsv(CSV_WITH_TOTAL);
    const result = dropTotalRows(rows, 0);

    expect(rows).toHaveLength(5);
    expect(result.dropped).toBe(1);
    expect(result.rows).toHaveLength(4);
    expect(result.rows.at(-1)).toEqual(["2026-02-03", "GS25 역삼점", "3200"]);
  });

  it("라벨 없이 숫자만 있는 합계 행도 제거한다", () => {
    const rows = parseCsv(CSV_PREAMBLE_AND_TOTAL);
    const result = dropTotalRows(rows, 3);

    expect(result.dropped).toBe(1);
    expect(result.rows.at(-1)).toEqual(["2026-02-03", "GS25 역삼점", "3200"]);
  });

  it("합계 행이 없으면 아무것도 제거하지 않는다", () => {
    const rows = parseCsv(CSV_UTF8);
    const result = dropTotalRows(rows, 0);

    expect(result.dropped).toBe(0);
    expect(result.rows).toEqual(rows);
  });

  it("가맹점명이 있는 거래 행은 금액이 커도 제거하지 않는다", () => {
    const rows = [
      ["날짜", "가맹점", "금액"],
      ["2026-01-05", "쿠팡", "12345678"],
    ];

    expect(dropTotalRows(rows, 0).dropped).toBe(0);
  });

  it("헤더 행 자체는 제거하지 않는다", () => {
    const rows = [["합계", "", "40700"]];

    expect(dropTotalRows(rows, 0).dropped).toBe(0);
  });

  it("연속된 합계 행을 모두 제거한다", () => {
    const rows = [
      ["날짜", "가맹점", "금액"],
      ["2026-01-05", "쿠팡", "1000"],
      ["소계", "", "1000"],
      ["합계", "", "1,000"],
    ];
    const result = dropTotalRows(rows, 0);

    expect(result.dropped).toBe(2);
    expect(result.rows).toHaveLength(2);
  });
});
