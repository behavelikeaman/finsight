import { describe, expect, it } from "vitest";

import type { RawTable } from "@/types/domain";
import { ingestFile } from "@/lib/ingest";
import {
  CSV_UTF8,
  CSV_WITH_PREAMBLE,
  encodeUtf8,
} from "@/lib/ingest/__fixtures__";

import { guessMapping, normalizeRows, validateMapping } from "./index";

async function tableOf(csv: string): Promise<RawTable> {
  const { table } = await ingestFile(encodeUtf8(csv), "card.csv");
  return table;
}

describe("normalizeRows — 픽스처 왕복", () => {
  it("ingest 결과를 그대로 정규화한다", async () => {
    const table = await tableOf(CSV_UTF8);
    const mapping = guessMapping(table.headers);

    expect(normalizeRows(table, mapping)).toEqual({
      rows: [
        { occurredOn: "2026-01-05", merchant: "스타벅스 강남점", amountKrw: 5500 },
        { occurredOn: "2026-01-07", merchant: "쿠팡", amountKrw: 32000 },
        { occurredOn: "2026-02-03", merchant: "GS25 역삼점", amountKrw: 3200 },
      ],
      skipped: 0,
    });
  });

  it("안내문이 걷힌 표도 동일하게 정규화한다", async () => {
    const table = await tableOf(CSV_WITH_PREAMBLE);
    const result = normalizeRows(table, guessMapping(table.headers));

    expect(result.rows).toHaveLength(3);
    expect(result.skipped).toBe(0);
  });
});

describe("normalizeRows — 실패 행 처리", () => {
  const table: RawTable = {
    headers: ["이용일자", "가맹점명", "이용금액"],
    rows: [
      ["2026-01-05", "스타벅스 강남점", "5,500"],
      ["", "쿠팡", "32,000"],
      ["2026-01-08", "", "1,000"],
      ["2026-01-09", "교보문고", "금액없음"],
      ["2026-02-03", "GS25 역삼점", "3,200"],
    ],
  };

  it("파싱 실패 행만 건너뛰고 나머지는 살린다", () => {
    const result = normalizeRows(table, guessMapping(table.headers));

    expect(result.rows).toHaveLength(2);
    expect(result.skipped).toBe(3);
  });

  it("음수(환불) 행을 그대로 살린다", () => {
    const result = normalizeRows(
      {
        headers: ["이용일자", "가맹점명", "이용금액"],
        rows: [["2026-01-05", "쿠팡", "(32,000)"]],
      },
      { date: "이용일자", merchant: "가맹점명", amount: "이용금액" },
    );

    expect(result.rows[0]?.amountKrw).toBe(-32000);
  });

  it("연도가 없는 날짜는 파일 내 최빈 연도를 쓴다", () => {
    const result = normalizeRows(
      {
        headers: ["이용일자", "가맹점명", "이용금액"],
        rows: [
          ["2025-01-05", "쿠팡", "1,000"],
          ["2025-01-07", "쿠팡", "1,000"],
          ["03/09", "스타벅스", "1,000"],
        ],
      },
      { date: "이용일자", merchant: "가맹점명", amount: "이용금액" },
    );

    expect(result.rows[2]?.occurredOn).toBe("2025-03-09");
  });

  it("날짜·가맹점·금액 세 필드만 담는다", () => {
    const result = normalizeRows(
      {
        headers: ["이용일자", "가맹점명", "이용금액", "카드번호", "승인번호"],
        rows: [["2026-01-05", "쿠팡", "1,000", "1234-5678-9012-3456", "00123"]],
      },
      { date: "이용일자", merchant: "가맹점명", amount: "이용금액" },
    );

    expect(Object.keys(result.rows[0] ?? {}).sort()).toEqual([
      "amountKrw",
      "merchant",
      "occurredOn",
    ]);
  });

  it("가맹점명의 앞뒤 공백과 연속 공백을 정리한다", () => {
    const result = normalizeRows(
      {
        headers: ["이용일자", "가맹점명", "이용금액"],
        rows: [["2026-01-05", "  스타벅스   강남점 ", "1,000"]],
      },
      { date: "이용일자", merchant: "가맹점명", amount: "이용금액" },
    );

    expect(result.rows[0]?.merchant).toBe("스타벅스 강남점");
  });
});

describe("validateMapping", () => {
  const table: RawTable = {
    headers: ["이용일자", "가맹점명", "이용금액", "카드번호"],
    rows: [
      ["2026-01-05", "스타벅스 강남점", "5,500", "1234-5678-9012-3456"],
      ["2026-01-07", "쿠팡", "32,000", "1234-5678-9012-3456"],
    ],
  };

  it("정상 매핑에는 이슈가 없다", () => {
    expect(
      validateMapping(table, {
        date: "이용일자",
        merchant: "가맹점명",
        amount: "이용금액",
      }),
    ).toEqual([]);
  });

  it("비어 있는 필드를 missing으로 잡는다", () => {
    const issues = validateMapping(table, {
      date: null,
      merchant: "가맹점명",
      amount: "이용금액",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]?.kind).toBe("missing");
    expect(issues[0]?.field).toBe("date");
  });

  it("헤더에 없는 컬럼명도 missing으로 잡는다", () => {
    const issues = validateMapping(table, {
      date: "이용일자",
      merchant: "가맹점명",
      amount: "없는컬럼",
    });

    expect(issues[0]).toMatchObject({ kind: "missing", field: "amount" });
  });

  it("금액에 카드번호를 매핑하면 unparsable로 잡는다", () => {
    const issues = validateMapping(table, {
      date: "이용일자",
      merchant: "가맹점명",
      amount: "카드번호",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "unparsable", field: "amount" });
  });

  it("날짜에 가맹점명을 매핑하면 unparsable로 잡는다", () => {
    const issues = validateMapping(table, {
      date: "가맹점명",
      merchant: "가맹점명",
      amount: "이용금액",
    });

    expect(issues).toHaveLength(1);
    expect(issues[0]).toMatchObject({ kind: "unparsable", field: "date" });
  });

  it("실패율이 50% 이하면 이슈로 보지 않는다", () => {
    const half: RawTable = {
      headers: ["이용일자", "가맹점명", "이용금액"],
      rows: [
        ["2026-01-05", "쿠팡", "5,500"],
        ["2026-01-06", "쿠팡", "미확정"],
      ],
    };

    expect(
      validateMapping(half, {
        date: "이용일자",
        merchant: "가맹점명",
        amount: "이용금액",
      }),
    ).toEqual([]);
  });
});
