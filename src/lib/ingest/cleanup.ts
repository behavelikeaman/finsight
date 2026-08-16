/**
 * 표 정리 — 헤더 앞 안내문과 표 끝 합계 행을 걷어낸다.
 *
 * 합계 행을 놓치면 총액이 2배가 된다. 금액 정확성이 이 제품의 존재 이유이므로
 * 판정 기준을 두 갈래(라벨형·숫자만형)로 두고 픽스처로 고정한다.
 */

/** '2026-01-05' · '26.1.5' · '2026년 1월 5일' */
const DATE_LIKE = /^\d{2,4}\s*[-./년]\s*\d{1,2}\s*[-./월]\s*\d{1,2}/;

/** '40,700' · '-5500' · '₩ 3,200원' */
const NUMERIC_LIKE = /^[-+]?\s*₩?\s*\d[\d,]*(\.\d+)?\s*원?$/;

const TOTAL_LABELS = ["합계", "총계", "계", "소계", "total", "sum"];

/**
 * 헤더 행의 인덱스. 카드사 명세서는 헤더 앞에 안내문이 붙어 나오므로
 * 첫 행으로 단정하지 않는다. 비어 있지 않은 셀 수가 최대인 첫 행을 고른다.
 *
 * @returns 행이 하나도 없으면 -1
 */
export function findHeaderRow(rows: string[][]): number {
  let headerIdx = -1;
  let maxFilled = 0;

  rows.forEach((row, index) => {
    const filled = row.filter((cell) => cell.trim() !== "").length;
    if (filled > maxFilled) {
      maxFilled = filled;
      headerIdx = index;
    }
  });

  return headerIdx;
}

/**
 * 표 끝의 합계 행을 제거한다. 표 중간의 소계는 건드리지 않는다 — 중간 행까지
 * 판정하면 거래 행을 오인해 지울 위험이 생기고, 그건 합계 중복보다 나쁘다.
 */
export function dropTotalRows(
  rows: string[][],
  headerIdx: number,
): { rows: string[][]; dropped: number } {
  let end = rows.length;

  while (end - 1 > headerIdx) {
    const row = rows[end - 1];
    if (row === undefined || !isTotalRow(row)) break;
    end -= 1;
  }

  return { rows: rows.slice(0, end), dropped: rows.length - end };
}

function isTotalRow(row: string[]): boolean {
  const filled = row.map((cell) => cell.trim()).filter((cell) => cell !== "");
  if (filled.length === 0) return false;

  const label = filled[0]?.replace(/\s+/g, "").toLowerCase() ?? "";
  if (TOTAL_LABELS.includes(label)) return true;

  // 날짜가 없고 남은 셀이 전부 숫자면 거래 행일 수 없다.
  return (
    !filled.some((cell) => DATE_LIKE.test(cell)) &&
    filled.every((cell) => NUMERIC_LIKE.test(cell))
  );
}
