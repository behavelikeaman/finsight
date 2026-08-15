import { describe, expect, it } from "vitest";

import { parseXlsx } from "./xlsx";
import { XLSX_ROWS, buildXlsx } from "./__fixtures__";

// ExcelJS는 동적 import라 첫 로드가 느리다. 기본 5초 타임아웃으로는 부족하다.
const TIMEOUT_MS = 30_000;

describe("parseXlsx", () => {
  it(
    "첫 워크시트의 헤더와 거래 행을 읽는다",
    async () => {
      const rows = await parseXlsx(await buildXlsx(XLSX_ROWS));

      expect(rows).toHaveLength(4);
      expect(rows[0]).toEqual(["이용일자", "가맹점명", "이용금액"]);
      expect(rows[2]).toEqual(["2026-01-07", "쿠팡", "32000"]);
    },
    TIMEOUT_MS,
  );

  it(
    "날짜 셀을 YYYY-MM-DD 문자열로 바꾼다",
    async () => {
      const rows = await parseXlsx(await buildXlsx(XLSX_ROWS));

      expect(rows[1]?.[0]).toBe("2026-01-05");
      expect(rows[3]?.[0]).toBe("2026-02-03");
    },
    TIMEOUT_MS,
  );

  it(
    "모든 셀이 문자열이다",
    async () => {
      const rows = await parseXlsx(await buildXlsx(XLSX_ROWS));

      for (const row of rows) {
        for (const cell of row) expect(typeof cell).toBe("string");
      }
    },
    TIMEOUT_MS,
  );

  it(
    "빈 셀은 빈 문자열이 되고 행 길이가 유지된다",
    async () => {
      const rows = await parseXlsx(
        await buildXlsx([
          ["날짜", "가맹점", "금액"],
          ["2026-01-05", "", 1000],
        ]),
      );

      expect(rows[1]).toEqual(["2026-01-05", "", "1000"]);
    },
    TIMEOUT_MS,
  );

  it(
    "거래가 없는 시트는 빈 배열이 된다",
    async () => {
      expect(await parseXlsx(await buildXlsx([]))).toEqual([]);
    },
    TIMEOUT_MS,
  );
});
