"use client";

/**
 * 업로드 전체 흐름을 오케스트레이션한다. 원본 파일은 여기서 서버로 나가지
 * 않는다 — normalizeRows()가 만든 정규화 배열만 /api/analyze로 보낸다(ADR-006).
 */
import { useState } from "react";

import { normalizeRows } from "@/lib/mapping";
import type { AnalyzeRequest, AnalyzeResponse } from "@/types/api";
import type { ColumnMapping, RawTable, SourceKind } from "@/types/domain";

import { DropZone, type IngestedFile } from "./DropZone";
import { MappingPanel } from "./MappingPanel";
import { PreviewPanel } from "@/components/preview/PreviewPanel";

type FlowState =
  | { step: "idle" }
  | { step: "mapping"; table: RawTable; sourceKind: SourceKind; fileName: string; isAnonymous: boolean }
  | { step: "analyzing" }
  | { step: "duplicate"; existingId: string }
  | {
      step: "preview";
      analysisId: string;
      totalKrw: number;
      rowCount: number;
      topMerchants: { merchant: string; amountKrw: number }[];
      isAnonymous: boolean;
    };

export function UploadFlow() {
  const [state, setState] = useState<FlowState>({ step: "idle" });
  const [error, setError] = useState<string | null>(null);

  const handleIngested = (result: IngestedFile) => {
    setError(null);
    setState({
      step: "mapping",
      table: result.table,
      sourceKind: result.sourceKind,
      fileName: result.fileName,
      isAnonymous: result.isAnonymous,
    });
  };

  const handleConfirmMapping = async (
    table: RawTable,
    sourceKind: SourceKind,
    fileName: string,
    isAnonymous: boolean,
    mapping: ColumnMapping,
  ) => {
    const { rows } = normalizeRows(table, mapping);

    if (rows.length === 0) {
      setError("읽을 수 있는 거래가 없습니다. 컬럼 매핑을 확인해 주세요.");
      return;
    }

    setState({ step: "analyzing" });

    try {
      const body: AnalyzeRequest = { rows, cardLabel: fileName, sourceKind };
      const res = await fetch("/api/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as AnalyzeResponse;

      if (!json.ok) {
        setState({ step: "duplicate", existingId: json.existingId });
        return;
      }

      setState({
        step: "preview",
        analysisId: json.analysisId,
        totalKrw: json.summary.totalKrw,
        rowCount: json.summary.rowCount,
        topMerchants: json.summary.topMerchants,
        isAnonymous,
      });
    } catch {
      setError("분석 요청에 실패했습니다. 잠시 후 다시 시도해 주세요.");
      setState({ step: "idle" });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {error && (
        <p className="rounded-md bg-review-soft px-4 py-3 text-sm text-ink">
          {error}
        </p>
      )}

      {state.step === "idle" && (
        <DropZone onIngested={handleIngested} onError={setError} />
      )}

      {state.step === "mapping" && (
        <MappingPanel
          table={state.table}
          onCancel={() => setState({ step: "idle" })}
          onConfirm={(mapping) =>
            void handleConfirmMapping(
              state.table,
              state.sourceKind,
              state.fileName,
              state.isAnonymous,
              mapping,
            )
          }
        />
      )}

      {state.step === "analyzing" && (
        <p className="text-sm text-muted">분석 중입니다...</p>
      )}

      {state.step === "duplicate" && (
        <div className="flex flex-col gap-3 rounded-2xl border border-hairline bg-surface-soft p-6">
          <p className="text-sm text-body">
            이미 올린 적이 있는 파일입니다. 기존 결과를 볼까요?
          </p>
          <div className="flex gap-3">
            <button
              type="button"
              onClick={() => setState({ step: "idle" })}
              className="rounded-full bg-surface-strong px-5 py-2.5 text-sm font-medium text-ink"
            >
              취소
            </button>
            <a
              href={`/dashboard/${state.existingId}`}
              className="rounded-full bg-primary px-5 py-2.5 text-sm font-medium text-on-primary"
            >
              기존 결과 보기
            </a>
          </div>
        </div>
      )}

      {state.step === "preview" && (
        <PreviewPanel
          analysisId={state.analysisId}
          totalKrw={state.totalKrw}
          rowCount={state.rowCount}
          topMerchants={state.topMerchants}
          isAnonymous={state.isAnonymous}
          redirectTo={`/dashboard/${state.analysisId}`}
        />
      )}
    </div>
  );
}
