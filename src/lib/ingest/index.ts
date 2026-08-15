/**
 * 파일 → RawTable.
 *
 * 이 코드는 브라우저에서 돈다(ADR-006: 원본 파일은 서버로 가지 않는다).
 * fs·path·Buffer 같은 Node 전용 API를 쓰지 마라. 입력은 ArrayBuffer다.
 *
 * 컬럼 매핑·집계·분류는 여기서 하지 않는다. 각각 step3·4·10의 범위다.
 */
import type { RawTable, SourceKind } from "@/types/domain";
import { MAX_ROWS } from "@/types/tier";

import { dropTotalRows, findHeaderRow } from "./cleanup";
import { parseCsv } from "./csv";
import { decodeText } from "./encoding";
import { parseXlsx } from "./xlsx";

export interface IngestResult {
  table: RawTable;
  /** 헤더 앞에서 걷어낸 안내문 행 수 */
  skippedPreambleRows: number;
  /** 표 끝에서 걷어낸 합계 행 수 */
  droppedTotalRows: number;
}

export interface IngestOptions {
  maxRows?: number;
}

export async function ingestFile(
  buffer: ArrayBuffer,
  fileName: string,
  options?: IngestOptions,
): Promise<IngestResult> {
  const maxRows = options?.maxRows ?? MAX_ROWS;
  const kind = detectSourceKind(fileName);

  const parsed =
    kind === "csv" ? parseCsv(decodeText(buffer)) : await parseXlsx(buffer);

  const headerIdx = findHeaderRow(parsed);
  if (headerIdx === -1) {
    throw new Error(
      `${fileName}에 읽을 내용이 없습니다. 카드사에서 내려받은 원본 파일인지 확인해 주세요.`,
    );
  }

  const { rows: kept, dropped } = dropTotalRows(parsed, headerIdx);
  const headers = kept[headerIdx] ?? [];
  const dataRows = kept.slice(headerIdx + 1);

  // 조용히 잘라내지 않는다. 일부만 분석된 사실을 모른 채 잘못된 결론을 얻는 편이,
  // 업로드가 거부되는 것보다 나쁘다.
  if (dataRows.length > maxRows) {
    throw new Error(
      `업로드 상한은 ${maxRows}행입니다. 이 파일은 ${dataRows.length}행입니다. 기간을 나눠 올려 주세요.`,
    );
  }

  return {
    table: {
      headers,
      // 매핑 단계가 헤더 위치로 셀을 찾으므로 행 길이를 헤더에 맞춘다.
      rows: dataRows.map((row) => alignWidth(row, headers.length)),
    },
    skippedPreambleRows: headerIdx,
    droppedTotalRows: dropped,
  };
}

export function detectSourceKind(fileName: string): SourceKind {
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".xlsx")) return "xlsx";

  throw new Error(
    `지원하지 않는 파일 형식입니다: ${fileName}. CSV(.csv) 또는 엑셀(.xlsx) 파일을 올려 주세요.`,
  );
}

function alignWidth(row: string[], width: number): string[] {
  if (row.length === width) return row;
  if (row.length > width) return row.slice(0, width);
  return [...row, ...Array<string>(width - row.length).fill("")];
}
