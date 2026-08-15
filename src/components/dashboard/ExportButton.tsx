"use client";

/**
 * CSV 내보내기 · 인쇄. Pro 전용. 부모가 getEffectiveTier()로 서버에서
 * 판정해 free면 이 컴포넌트를 렌더하지 않는다 — CSS로 숨기지 않는다.
 */
import type { ClassifiedTransaction } from "@/types/analysis";

export function ExportButton({ rows }: { rows: ClassifiedTransaction[] }) {
  const handleExport = () => {
    const header = "날짜,가맹점,금액,분류,계정과목\n";
    const body = rows
      .map((r) =>
        [
          r.occurredOn,
          csvEscape(r.merchant),
          String(r.amountKrw),
          r.classification ?? "",
          r.accountCode ?? "",
        ].join(","),
      )
      .join("\n");

    const blob = new Blob([header + body], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "finsight-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="no-print flex gap-2">
      <button
        type="button"
        onClick={handleExport}
        className="rounded-full bg-surface-strong px-4 py-2 text-sm font-medium text-ink"
      >
        CSV 내보내기
      </button>
      <button
        type="button"
        onClick={() => window.print()}
        className="rounded-full bg-surface-strong px-4 py-2 text-sm font-medium text-ink"
      >
        인쇄
      </button>
    </div>
  );
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}
