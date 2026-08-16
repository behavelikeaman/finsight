/**
 * 셀 값 → 도메인 값.
 *
 * 금액은 정수(원)로만 다룬다. parseFloat을 쓰지 않는 이유는 통화를 부동소수점으로
 * 거치면 합계에 오차가 쌓이기 때문이다 — 문자열에서 정수부·소수부를 따로 떼어낸다.
 */

/** '(1,234)' — 회계 표기의 음수 */
const PARENTHESIZED = /^\((.*)\)$/;

/** 통화 기호·천 단위 구분자·공백 */
const CURRENCY_NOISE = /[₩,\s]/g;

/** 부호를 뗀 뒤 남아야 하는 형태. 그 외(카드번호 등)는 금액이 아니다. */
const DECIMAL = /^(\d+)(?:\.(\d+))?$/;

/**
 * '1,234' · '₩1,234' · '1234원' · '-1,234' · '(1,234)' · '1,234.00'
 *
 * @returns 정수(원). 금액으로 읽을 수 없으면 null
 */
export function parseAmountKrw(raw: string): number | null {
  let text = raw.trim();
  if (text === "") return null;

  let negative = false;

  const wrapped = PARENTHESIZED.exec(text);
  if (wrapped !== null) {
    negative = true;
    text = (wrapped[1] ?? "").trim();
  }

  text = text.replace(CURRENCY_NOISE, "").replace(/원$/, "");

  if (text.startsWith("-")) {
    negative = !negative;
    text = text.slice(1);
  } else if (text.startsWith("+")) {
    text = text.slice(1);
  }

  const parts = DECIMAL.exec(text);
  if (parts === null) return null;

  const whole = Number(parts[1]);
  if (!Number.isSafeInteger(whole)) return null;

  // 소수부는 첫 자리만 보고 반올림한다. 원 단위 아래는 명세서에 의미가 없다.
  const fraction = parts[2] ?? "";
  const carry = fraction !== "" && Number(fraction[0]) >= 5 ? 1 : 0;
  const value = whole + carry;

  return negative ? -value : value;
}

/** '2026.08.10' · '2026-08-10' · '2026/08/10' */
const YMD = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})$/;
/** '20260810' */
const COMPACT = /^(\d{4})(\d{2})(\d{2})$/;
/** '08/10' — 연도 없음 */
const MD = /^(\d{1,2})[-./](\d{1,2})$/;

/**
 * @param fallbackYear 연도가 없는 표기('08/10')에 쓸 연도. 파일 내 최빈 연도다
 * @returns 'YYYY-MM-DD'. 날짜로 읽을 수 없으면 null
 */
export function parseDate(raw: string, fallbackYear?: number): string | null {
  const text = raw
    .trim()
    .replace(/\s*[년월]\s*/g, "-")
    .replace(/\s*일\s*$/, "");

  const ymd = YMD.exec(text) ?? COMPACT.exec(text);
  if (ymd !== null) {
    return build(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  }

  const md = MD.exec(text);
  if (md !== null && fallbackYear !== undefined) {
    return build(fallbackYear, Number(md[1]), Number(md[2]));
  }

  return null;
}

function build(year: number, month: number, day: number): string | null {
  // 실재하지 않는 날짜(2026-02-30)를 조용히 다음 달로 넘기지 않는다.
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return `${pad(year, 4)}-${pad(month, 2)}-${pad(day, 2)}`;
}

function pad(value: number, width: number): string {
  return String(value).padStart(width, "0");
}
