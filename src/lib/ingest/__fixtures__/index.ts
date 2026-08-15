/**
 * ingest 테스트 픽스처.
 *
 * 바이너리 픽스처(EUC-KR, xlsx)는 파일로 커밋하지 않고 여기서 생성한다.
 * 커밋된 바이너리는 diff로 확인할 수 없어, 내용이 바뀌어도 리뷰에서 보이지 않는다.
 */

/** 1. UTF-8 정상 CSV */
export const CSV_UTF8 = [
  "이용일자,가맹점명,이용금액",
  "2026-01-05,스타벅스 강남점,5500",
  "2026-01-07,쿠팡,32000",
  "2026-02-03,GS25 역삼점,3200",
  "",
].join("\n");

/** 2. EUC-KR로 인코딩할 원문. 한글 가맹점명이 핵심이다. */
export const CSV_KOREAN = [
  "이용일자,가맹점명,이용금액",
  "2026-01-05,스타벅스 강남점,5500",
  "2026-01-07,쿠팡 로켓배송,32000",
  "2026-02-03,교보문고 광화문점,18000",
  "",
].join("\n");

/** 3. 상단 안내문 3줄 */
export const CSV_WITH_PREAMBLE = [
  "고객님의 카드 이용내역입니다",
  "조회기간: 2026-01-01 ~ 2026-02-28",
  "※ 본 내역은 참고용입니다",
  "이용일자,가맹점명,이용금액",
  "2026-01-05,스타벅스 강남점,5500",
  "2026-01-07,쿠팡,32000",
  "2026-02-03,GS25 역삼점,3200",
  "",
].join("\n");

/** 4. 하단 합계 행 (라벨형) */
export const CSV_WITH_TOTAL = [
  "이용일자,가맹점명,이용금액",
  "2026-01-05,스타벅스 강남점,5500",
  "2026-01-07,쿠팡,32000",
  "2026-02-03,GS25 역삼점,3200",
  "합계,,40700",
  "",
].join("\n");

/** 5. 안내문 + 합계 행. 합계는 라벨 없이 숫자만 있는 형태다. */
export const CSV_PREAMBLE_AND_TOTAL = [
  "고객님의 카드 이용내역입니다",
  "조회기간: 2026-01-01 ~ 2026-02-28",
  "※ 본 내역은 참고용입니다",
  "이용일자,가맹점명,이용금액",
  "2026-01-05,스타벅스 강남점,5500",
  "2026-01-07,쿠팡,32000",
  "2026-02-03,GS25 역삼점,3200",
  ",,40700",
  "",
].join("\n");

/** 6. 따옴표·필드 내 쉼표·이스케이프된 따옴표·필드 내 줄바꿈 */
export const CSV_QUOTED = [
  "이용일자,가맹점명,이용금액",
  '2026-01-05,"카페, 스타벅스",5500',
  '2026-01-06,"그는 ""최고""라고 했다",1000',
  '2026-01-07,"두 줄',
  '가맹점",2000',
  "",
].join("\n");

/** 8-a. 헤더만 있고 거래 0건 */
export const CSV_HEADER_ONLY = "이용일자,가맹점명,이용금액\n";

/** 8-b. 빈 파일 */
export const CSV_EMPTY = "";

/** 7. xlsx 픽스처의 원본 행. 날짜는 Date 셀로 넣어 문자열 변환을 검증한다. */
export const XLSX_ROWS: (string | number | Date)[][] = [
  ["이용일자", "가맹점명", "이용금액"],
  [new Date(Date.UTC(2026, 0, 5)), "스타벅스 강남점", 5500],
  [new Date(Date.UTC(2026, 0, 7)), "쿠팡", 32000],
  [new Date(Date.UTC(2026, 1, 3)), "GS25 역삼점", 3200],
];

export function encodeUtf8(text: string, options?: { bom?: boolean }): ArrayBuffer {
  const body = new TextEncoder().encode(text);
  if (options?.bom !== true) return toArrayBuffer(body);

  const withBom = new Uint8Array(body.length + 3);
  withBom.set([0xef, 0xbb, 0xbf], 0);
  withBom.set(body, 3);
  return toArrayBuffer(withBom);
}

/**
 * EUC-KR 인코더.
 *
 * 표준 TextEncoder는 UTF-8만 지원하므로, TextDecoder('euc-kr')로 전체 2바이트
 * 조합을 디코딩해 역방향 표를 만든다. 인코딩 표를 손으로 적는 것보다 안전하다.
 */
export function encodeEucKr(text: string): ArrayBuffer {
  const table = eucKrTable();
  const bytes: number[] = [];

  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (code < 0x80) {
      bytes.push(code);
      continue;
    }

    const pair = table.get(char);
    if (pair === undefined) {
      throw new Error(`EUC-KR로 인코딩할 수 없는 문자입니다: ${char}`);
    }
    bytes.push(pair[0], pair[1]);
  }

  return toArrayBuffer(new Uint8Array(bytes));
}

export async function buildXlsx(
  rows: (string | number | Date)[][],
): Promise<ArrayBuffer> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("이용내역");
  for (const row of rows) sheet.addRow(row);
  return workbook.xlsx.writeBuffer() as Promise<ArrayBuffer>;
}

let cachedTable: Map<string, [number, number]> | null = null;

function eucKrTable(): Map<string, [number, number]> {
  if (cachedTable !== null) return cachedTable;

  const decoder = new TextDecoder("euc-kr");
  const table = new Map<string, [number, number]>();

  for (let lead = 0x81; lead <= 0xfe; lead++) {
    for (let trail = 0x41; trail <= 0xfe; trail++) {
      const decoded = decoder.decode(new Uint8Array([lead, trail]));
      if (decoded.length !== 1 || decoded === "�") continue;
      if (!table.has(decoded)) table.set(decoded, [lead, trail]);
    }
  }

  cachedTable = table;
  return table;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
