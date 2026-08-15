/**
 * 헤더 추측 — AI를 쓰지 않는다(ADR-007).
 *
 * 카드사 별칭 사전으로 맞히고, 틀리면 사용자가 드롭다운으로 고친다. 추측이
 * 틀리는 비용은 클릭 한 번이지만, AI 추론은 첫 사용자에게 지연과 실패를 지운다.
 */
import type { ColumnMapping } from "@/types/domain";

import { parseAmountKrw, parseDate } from "./normalize";

const DATE_ALIASES = [
  "이용일",
  "이용일자",
  "거래일",
  "거래일자",
  "승인일",
  "승인일자",
  "매출일자",
  "결제일",
  "date",
  "transactiondate",
];

const MERCHANT_ALIASES = [
  "가맹점",
  "가맹점명",
  "이용하신곳",
  "이용가맹점",
  "상호",
  "내용",
  "적요",
  "merchant",
  "description",
];

const AMOUNT_ALIASES = [
  "이용금액",
  "승인금액",
  "결제금액",
  "청구금액",
  "거래금액",
  "금액",
  "원화금액",
  "국내이용금액",
  "amount",
];

/**
 * 해외 결제 명세서는 외화 금액 컬럼이 함께 온다. 그걸 고르면 값이 통째로 틀리므로
 * 원화·청구 계열을 먼저 고른다.
 */
const AMOUNT_PREFERRED = ["원화", "청구", "국내"];

/**
 * 카드번호는 저장하지 않기로 한 데이터다. 후보에 뜨면 사용자가 실수로 고를 수
 * 있으므로 어떤 필드에도 매핑하지 않는다.
 */
const EXCLUDED = ["카드번호", "cardno", "cardnumber", "카드no"];

/**
 * @param rows 별칭에 걸리는 헤더가 없을 때 값 패턴으로 추론하기 위한 데이터 행.
 *             주지 않으면 추론하지 않는다
 */
export function guessMapping(
  headers: string[],
  rows?: string[][],
): ColumnMapping {
  const normalized = headers.map(normalizeHeader);
  const excluded = normalized.map(isExcluded);

  const date = pick(headers, normalized, excluded, DATE_ALIASES, []);
  const merchant = pick(headers, normalized, excluded, MERCHANT_ALIASES, []);
  const amount = pick(
    headers,
    normalized,
    excluded,
    AMOUNT_ALIASES,
    AMOUNT_PREFERRED,
  );

  const taken = new Set([date, merchant, amount].filter((v) => v !== null));

  return {
    date:
      date ??
      inferByValues(headers, excluded, rows, taken, (cell) =>
        parseDate(cell, 2000) !== null,
      ),
    merchant,
    amount:
      amount ??
      inferByValues(
        headers,
        excluded,
        rows,
        taken,
        (cell) => parseAmountKrw(cell) !== null,
      ),
  };
}

/** 대소문자·공백·괄호(와 그 안의 단위 표기)를 걷어낸다. */
function normalizeHeader(header: string): string {
  return header
    .replace(/[([{][^)\]}]*[)\]}]/g, "")
    .replace(/[\s_·\-/]/g, "")
    .toLowerCase();
}

function isExcluded(header: string): boolean {
  return EXCLUDED.some((token) => header.includes(token));
}

/**
 * 별칭 적중(정확 일치 > 부분 일치)보다 원화·청구 우선순위를 먼저 본다.
 * 순서가 반대면 '이용금액(외화)'가 '원화청구금액'을 이긴다.
 */
function pick(
  headers: string[],
  normalized: string[],
  excluded: boolean[],
  aliases: string[],
  preferred: string[],
): string | null {
  let bestIndex = -1;
  let bestAlias = 0;
  let bestPrefer = -1;

  normalized.forEach((header, index) => {
    if (excluded[index] === true || header === "") return;

    const alias = aliases.includes(header)
      ? 2
      : aliases.some((candidate) => header.includes(candidate))
        ? 1
        : 0;
    if (alias === 0) return;

    const prefer = preferred.some((token) => header.includes(token)) ? 1 : 0;

    if (prefer > bestPrefer || (prefer === bestPrefer && alias > bestAlias)) {
      bestIndex = index;
      bestAlias = alias;
      bestPrefer = prefer;
    }
  });

  return bestIndex === -1 ? null : (headers[bestIndex] ?? null);
}

/** 값의 절반 넘게 파싱되는 컬럼을 고른다. 동률이면 왼쪽 컬럼. */
function inferByValues(
  headers: string[],
  excluded: boolean[],
  rows: string[][] | undefined,
  taken: Set<string>,
  matches: (cell: string) => boolean,
): string | null {
  if (rows === undefined || rows.length === 0) return null;

  let bestHeader: string | null = null;
  let bestRatio = 0.5;

  headers.forEach((header, index) => {
    if (excluded[index] === true || taken.has(header)) return;

    const filled = rows
      .map((row) => row[index] ?? "")
      .filter((cell) => cell.trim() !== "");
    if (filled.length === 0) return;

    const ratio = filled.filter(matches).length / filled.length;
    if (ratio > bestRatio) {
      bestHeader = header;
      bestRatio = ratio;
    }
  });

  return bestHeader;
}
