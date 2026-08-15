"use client";

/**
 * 컬럼 매핑 확인. guessMapping()이 미리 채운 드롭다운을 사용자가 교정한다.
 * 값을 봐야 매핑이 맞는지 알 수 있으므로 상위 5행 미리보기를 함께 보여준다.
 */
import { useMemo, useState } from "react";

import { guessMapping, validateMapping } from "@/lib/mapping";
import type { ColumnMapping, RawTable } from "@/types/domain";

interface MappingPanelProps {
  table: RawTable;
  onConfirm: (mapping: ColumnMapping) => void;
  onCancel: () => void;
}

const FIELDS: { key: keyof ColumnMapping; label: string }[] = [
  { key: "date", label: "날짜" },
  { key: "merchant", label: "가맹점" },
  { key: "amount", label: "금액" },
];

const PREVIEW_ROWS = 5;

export function MappingPanel({ table, onConfirm, onCancel }: MappingPanelProps) {
  const [mapping, setMapping] = useState<ColumnMapping>(() =>
    guessMapping(table.headers, table.rows),
  );
  const issues = useMemo(
    () => validateMapping(table, mapping),
    [table, mapping],
  );
  const hasMissing = issues.some((issue) => issue.kind === "missing");
  const previewRows = table.rows.slice(0, PREVIEW_ROWS);

  return (
    <div className="flex flex-col gap-6 rounded-2xl border border-hairline bg-canvas p-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {FIELDS.map((field) => (
          <label key={field.key} className="flex flex-col gap-1 text-sm">
            <span className="font-medium text-ink">{field.label} 컬럼</span>
            <select
              value={mapping[field.key] ?? ""}
              onChange={(e) =>
                setMapping((m) => ({
                  ...m,
                  [field.key]: e.target.value === "" ? null : e.target.value,
                }))
              }
              className="rounded-md border border-hairline bg-canvas px-3 py-2 text-ink focus:border-primary focus:outline-none"
            >
              <option value="">선택 안 함</option>
              {table.headers.map((header) => (
                <option key={header} value={header}>
                  {header}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>

      {issues.length > 0 && (
        <ul className="flex flex-col gap-1 rounded-md bg-review-soft px-4 py-3 text-sm text-ink">
          {issues.map((issue) => (
            <li key={`${issue.field}-${issue.kind}`}>{issue.detail}</li>
          ))}
        </ul>
      )}

      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              {table.headers.map((header) => (
                <th key={header} className="px-3 py-2 font-medium">
                  {header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {previewRows.map((row, rowIndex) => (
              <tr key={rowIndex} className="border-b border-hairline-soft">
                {row.map((cell, cellIndex) => (
                  <td key={cellIndex} className="px-3 py-2 text-body">
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex justify-end gap-3">
        <button
          type="button"
          onClick={onCancel}
          className="rounded-full bg-surface-strong px-5 py-2.5 text-sm font-medium text-ink"
        >
          취소
        </button>
        <button
          type="button"
          disabled={hasMissing}
          onClick={() => onConfirm(mapping)}
          className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary disabled:cursor-not-allowed disabled:bg-primary-disabled"
        >
          분석 실행
        </button>
      </div>
    </div>
  );
}
