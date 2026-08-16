/**
 * RawTable → NormalizedRow[].
 *
 * 이 코드는 브라우저에서 돈다(ADR-006). I/O를 넣지 마라 — 서버의 재검증도
 * 같은 함수를 쓴다.
 */
import type { ColumnMapping, NormalizedRow, RawTable } from "@/types/domain";

import { parseAmountKrw, parseDate } from "./normalize";

export { guessMapping } from "./heuristics";
export { parseAmountKrw, parseDate } from "./normalize";

export interface MappingIssue {
  kind: "missing" | "unparsable";
  field: "date" | "merchant" | "amount";
  detail: string;
}

export interface NormalizeResult {
  rows: NormalizedRow[];
  /** 세 값 중 하나라도 읽지 못해 버린 행 수 */
  skipped: number;
}

/** 검증에 쓸 표본 행 수. 전체를 훑을 필요가 없다. */
const SAMPLE_ROWS = 20;

/** 이 비율을 넘게 실패하면 컬럼을 잘못 고른 것으로 본다. */
const FAILURE_LIMIT = 0.5;

const FIELD_LABEL = { date: "날짜", merchant: "가맹점", amount: "금액" } as const;

export function validateMapping(
  table: RawTable,
  mapping: ColumnMapping,
): MappingIssue[] {
  const issues: MappingIssue[] = [];
  const sample = table.rows.slice(0, SAMPLE_ROWS);

  for (const field of ["date", "merchant", "amount"] as const) {
    const header = mapping[field];
    const index = header === null ? -1 : table.headers.indexOf(header);

    if (index === -1) {
      issues.push({
        kind: "missing",
        field,
        detail: `${FIELD_LABEL[field]} 컬럼을 골라 주세요.`,
      });
      continue;
    }

    const cells = sample
      .map((row) => row[index] ?? "")
      .filter((cell) => cell.trim() !== "");
    if (cells.length === 0) continue;

    const failed = cells.filter((cell) => readField(field, cell) === null);
    if (failed.length / cells.length > FAILURE_LIMIT) {
      issues.push({
        kind: "unparsable",
        field,
        detail: `'${header}' 컬럼의 값을 ${FIELD_LABEL[field]}(으)로 읽을 수 없습니다. 예: ${failed[0] ?? ""}`,
      });
    }
  }

  return issues;
}

export function normalizeRows(
  table: RawTable,
  mapping: ColumnMapping,
): NormalizeResult {
  const dateIdx = indexOf(table, mapping.date);
  const merchantIdx = indexOf(table, mapping.merchant);
  const amountIdx = indexOf(table, mapping.amount);

  if (dateIdx === -1 || merchantIdx === -1 || amountIdx === -1) {
    return { rows: [], skipped: table.rows.length };
  }

  const fallbackYear = dominantYear(table.rows, dateIdx);
  const rows: NormalizedRow[] = [];
  let skipped = 0;

  for (const row of table.rows) {
    const occurredOn = parseDate(row[dateIdx] ?? "", fallbackYear);
    const merchant = cleanMerchant(row[merchantIdx] ?? "");
    const amountKrw = parseAmountKrw(row[amountIdx] ?? "");

    // 한 줄이 이상하다고 분석 전체를 버리면 사용자는 아무것도 얻지 못한다.
    if (occurredOn === null || merchant === "" || amountKrw === null) {
      skipped += 1;
      continue;
    }

    // 원본 행의 나머지 값(카드번호·승인번호·할부개월)은 싣지 않는다.
    // 이 배열이 그대로 서버로 가고, 서버에 도달한 값은 언젠가 저장된다.
    rows.push({ occurredOn, merchant, amountKrw });
  }

  return { rows, skipped };
}

function indexOf(table: RawTable, header: string | null): number {
  return header === null ? -1 : table.headers.indexOf(header);
}

function readField(
  field: "date" | "merchant" | "amount",
  cell: string,
): string | number | null {
  if (field === "date") return parseDate(cell, 2000);
  if (field === "amount") return parseAmountKrw(cell);
  return cleanMerchant(cell) === "" ? null : cell;
}

function cleanMerchant(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

/** 연도가 없는 표기('08/10')에 쓸 연도. 파일 안에서 가장 많이 나온 연도다. */
function dominantYear(rows: string[][], dateIdx: number): number | undefined {
  const counts = new Map<number, number>();

  for (const row of rows) {
    const parsed = parseDate(row[dateIdx] ?? "");
    if (parsed === null) continue;
    const year = Number(parsed.slice(0, 4));
    counts.set(year, (counts.get(year) ?? 0) + 1);
  }

  let best: number | undefined;
  let bestCount = 0;
  for (const [year, count] of counts) {
    if (count > bestCount) {
      best = year;
      bestCount = count;
    }
  }

  return best;
}
