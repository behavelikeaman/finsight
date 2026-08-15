/**
 * 엑셀 파싱.
 *
 * ExcelJS는 반드시 동적 import한다. 정적으로 포함하면 랜딩 초기 번들에 들어가
 * LCP를 해친다 — 사용자가 .xlsx를 드롭한 순간에만 로드되어야 한다.
 */
import type { CellValue } from "exceljs";

export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]> {
  const ExcelJS = await import("exceljs");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  const sheet = workbook.worksheets[0];
  if (sheet === undefined) return [];

  const width = sheet.columnCount;
  const rows: string[][] = [];

  sheet.eachRow({ includeEmpty: true }, (row) => {
    const cells: string[] = [];
    for (let column = 1; column <= width; column += 1) {
      cells.push(toCellText(row.getCell(column).value));
    }
    if (cells.some((cell) => cell !== "")) rows.push(cells);
  });

  return rows;
}

/** 셀 값을 전부 문자열로 만든다. 날짜는 'YYYY-MM-DD'. */
function toCellText(value: CellValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    if ("richText" in value) {
      return value.richText.map((part) => part.text).join("");
    }
    if ("result" in value) return toCellText(value.result ?? null);
    if ("text" in value) return String(value.text);
    if ("error" in value) return "";
  }
  return String(value);
}
