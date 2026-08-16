/**
 * CSV 파서.
 *
 * 외부 라이브러리를 쓰지 않는다 — 의존성 하나를 아끼는 것보다, 카드사 파일에서
 * 실제로 나오는 형태(따옴표, 필드 내 쉼표·줄바꿈, "" 이스케이프)를 픽스처로
 * 완전히 고정하는 편이 낫다.
 *
 * 전부 비어 있는 행은 버린다. 카드사 파일은 구획 구분에 빈 줄을 쓰고, 이 행들이
 * 남으면 헤더 판정과 합계 행 판정이 둘 다 흔들린다.
 */
export function parseCsv(text: string): string[][] {
  const source = text.startsWith("﻿") ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let index = 0;

  const endField = () => {
    row.push(field);
    field = "";
  };

  const endRow = () => {
    endField();
    if (row.some((cell) => cell !== "")) rows.push(row);
    row = [];
  };

  while (index < source.length) {
    const char = source.charAt(index);

    if (inQuotes) {
      if (char === '"') {
        if (source.charAt(index + 1) === '"') {
          field += '"';
          index += 2;
        } else {
          inQuotes = false;
          index += 1;
        }
      } else {
        field += char;
        index += 1;
      }
      continue;
    }

    if (char === '"' && field === "") {
      inQuotes = true;
      index += 1;
    } else if (char === ",") {
      endField();
      index += 1;
    } else if (char === "\r") {
      index += source.charAt(index + 1) === "\n" ? 2 : 1;
      endRow();
    } else if (char === "\n") {
      index += 1;
      endRow();
    } else {
      field += char;
      index += 1;
    }
  }

  if (field !== "" || row.length > 0) endRow();

  return rows;
}
