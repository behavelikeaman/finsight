import { describe, expect, it } from "vitest";

import { MAX_ROWS } from "@/types/tier";

import { detectSourceKind, ingestFile } from "./index";
import {
  CSV_EMPTY,
  CSV_HEADER_ONLY,
  CSV_KOREAN,
  CSV_PREAMBLE_AND_TOTAL,
  CSV_QUOTED,
  CSV_UTF8,
  CSV_WITH_PREAMBLE,
  CSV_WITH_TOTAL,
  XLSX_ROWS,
  buildXlsx,
  encodeEucKr,
  encodeUtf8,
} from "./__fixtures__";

describe("detectSourceKind", () => {
  it("확장자로 판별한다", () => {
    expect(detectSourceKind("card.csv")).toBe("csv");
    expect(detectSourceKind("card.xlsx")).toBe("xlsx");
    expect(detectSourceKind("CARD.CSV")).toBe("csv");
  });

  it("지원하지 않는 확장자는 throw한다", () => {
    expect(() => detectSourceKind("card.pdf")).toThrow(/지원하지 않는/);
    expect(() => detectSourceKind("card.xls")).toThrow(/지원하지 않는/);
  });
});

describe("ingestFile", () => {
  it("UTF-8 CSV를 RawTable로 만든다", async () => {
    const result = await ingestFile(encodeUtf8(CSV_UTF8), "card.csv");

    expect(result.table.headers).toEqual(["이용일자", "가맹점명", "이용금액"]);
    expect(result.table.rows).toHaveLength(3);
    expect(result.skippedPreambleRows).toBe(0);
    expect(result.droppedTotalRows).toBe(0);
  });

  it("EUC-KR CSV의 한글 가맹점명이 깨지지 않는다", async () => {
    const result = await ingestFile(encodeEucKr(CSV_KOREAN), "card.csv");

    expect(result.table.rows[0]?.[1]).toBe("스타벅스 강남점");
    expect(result.table.rows[2]?.[1]).toBe("교보문고 광화문점");
  });

  it("상단 안내문을 건너뛰고 그 줄 수를 보고한다", async () => {
    const result = await ingestFile(encodeUtf8(CSV_WITH_PREAMBLE), "card.csv");

    expect(result.skippedPreambleRows).toBe(3);
    expect(result.table.headers).toEqual(["이용일자", "가맹점명", "이용금액"]);
    expect(result.table.rows).toHaveLength(3);
  });

  it("하단 합계 행을 제거해 행 수가 정확히 하나 줄어든다", async () => {
    const withTotal = await ingestFile(encodeUtf8(CSV_WITH_TOTAL), "card.csv");
    const without = await ingestFile(encodeUtf8(CSV_UTF8), "card.csv");

    expect(withTotal.droppedTotalRows).toBe(1);
    expect(withTotal.table.rows).toHaveLength(without.table.rows.length);
    expect(withTotal.table.rows.flat()).not.toContain("40700");
  });

  it("안내문과 합계 행이 모두 있어도 거래 행만 남는다", async () => {
    const result = await ingestFile(
      encodeUtf8(CSV_PREAMBLE_AND_TOTAL),
      "card.csv",
    );

    expect(result.skippedPreambleRows).toBe(3);
    expect(result.droppedTotalRows).toBe(1);
    expect(result.table.rows).toHaveLength(3);
    expect(result.table.rows.flat()).not.toContain("40700");
  });

  it("따옴표로 감싼 필드를 보존한다", async () => {
    const result = await ingestFile(encodeUtf8(CSV_QUOTED), "card.csv");

    expect(result.table.rows[0]?.[1]).toBe("카페, 스타벅스");
    expect(result.table.rows).toHaveLength(3);
  });

  it("행 길이를 헤더 길이에 맞춘다", async () => {
    const csv = "이용일자,가맹점명,이용금액\n2026-01-05,쿠팡\n";
    const result = await ingestFile(encodeUtf8(csv), "card.csv");

    expect(result.table.rows[0]).toEqual(["2026-01-05", "쿠팡", ""]);
  });

  it("거래 0건인 파일은 빈 rows를 돌려준다", async () => {
    const result = await ingestFile(encodeUtf8(CSV_HEADER_ONLY), "card.csv");

    expect(result.table.headers).toHaveLength(3);
    expect(result.table.rows).toEqual([]);
  });

  it("빈 파일은 throw한다", async () => {
    await expect(ingestFile(encodeUtf8(CSV_EMPTY), "card.csv")).rejects.toThrow(
      /내용이 없습니다|비어/,
    );
  });

  it(
    "xlsx도 같은 RawTable을 만든다",
    async () => {
      const result = await ingestFile(await buildXlsx(XLSX_ROWS), "card.xlsx");

      expect(result.table.headers).toEqual(["이용일자", "가맹점명", "이용금액"]);
      expect(result.table.rows[0]).toEqual([
        "2026-01-05",
        "스타벅스 강남점",
        "5500",
      ]);
    },
    30_000,
  );

  it("상한을 넘으면 잘라내지 않고 throw한다", async () => {
    const csv = ["이용일자,가맹점명,이용금액", "a,b,1", "c,d,2", "e,f,3"].join(
      "\n",
    );

    await expect(
      ingestFile(encodeUtf8(csv), "card.csv", { maxRows: 2 }),
    ).rejects.toThrow(/2/);
  });

  it("상한 이내면 통과한다", async () => {
    const csv = ["이용일자,가맹점명,이용금액", "a,b,1", "c,d,2"].join("\n");
    const result = await ingestFile(encodeUtf8(csv), "card.csv", { maxRows: 2 });

    expect(result.table.rows).toHaveLength(2);
  });

  it("기본 상한은 tier.ts의 MAX_ROWS다", async () => {
    const rows = Array.from(
      { length: MAX_ROWS + 1 },
      () => "2026-01-05,쿠팡,1000",
    );
    const csv = ["이용일자,가맹점명,이용금액", ...rows].join("\n");

    await expect(ingestFile(encodeUtf8(csv), "card.csv")).rejects.toThrow(
      new RegExp(String(MAX_ROWS)),
    );
  });
});
