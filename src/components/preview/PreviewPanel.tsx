"use client";

/**
 * 집계 프리뷰 + 표본 분류(ADR-015).
 *
 * 총액·월별·상위 가맹점은 /api/analyze 응답의 summary를 그대로 쓴다 — 여기까지는
 * LLM이 관여하지 않았다. 표본 분류는 POST classify(mode:'sample')를 호출한
 * 뒤, 결과 행은 브라우저 Supabase 클라이언트로 직접 조회한다(RLS가
 * owner_id=auth.uid()로 막아준다). 새 읽기 API 라우트를 만들지 않는다.
 */
import { useEffect, useState } from "react";

import { createBrowserSupabase } from "@/lib/supabase/browser";
import type { ClassifiedTransaction } from "@/types/analysis";
import type { ClassifyRequest, ClassifyResponse } from "@/types/api";
import type { AccountCode, Classification } from "@/types/domain";
import { SAMPLE_SIZE } from "@/types/tier";

import { ConnectPanel } from "@/components/auth/ConnectPanel";

interface PreviewPanelProps {
  analysisId: string;
  totalKrw: number;
  rowCount: number;
  topMerchants: { merchant: string; amountKrw: number }[];
  isAnonymous: boolean;
  redirectTo: string;
}

interface SampleTxRow {
  id: string;
  occurred_on: string;
  merchant: string;
  amount_krw: number;
  classification: Classification | null;
  account_code: AccountCode | null;
  confidence: number | null;
  rule_id: string | null;
}

type LoadState =
  | { kind: "loading" }
  | { kind: "sample_used" }
  | { kind: "ready"; rows: ClassifiedTransaction[] }
  | { kind: "error"; message: string };

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  business: "사업경비",
  personal: "개인지출",
  review: "확인 필요",
};

const CLASSIFICATION_BADGE: Record<Classification, string> = {
  business: "bg-business-soft text-business",
  personal: "bg-personal-soft text-personal",
  review: "bg-review-soft text-review",
};

export function PreviewPanel({
  analysisId,
  totalKrw,
  rowCount,
  topMerchants,
  isAnonymous,
  redirectTo,
}: PreviewPanelProps) {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const body: ClassifyRequest = { mode: "sample" };
        const res = await fetch(`/api/analyses/${analysisId}/classify`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json()) as ClassifyResponse;

        if (cancelled) return;

        if (!json.ok) {
          if (json.reason === "sample_used") {
            setState({ kind: "sample_used" });
            return;
          }
          setState({ kind: "error", message: "표본 분류에 실패했습니다." });
          return;
        }

        const supabase = createBrowserSupabase();
        const { data, error } = await supabase
          .from("transactions")
          .select(
            "id, occurred_on, merchant, amount_krw, classification, account_code, confidence, rule_id",
          )
          .eq("analysis_id", analysisId)
          .not("classification", "is", null)
          .order("amount_krw", { ascending: false })
          .limit(SAMPLE_SIZE);

        if (cancelled) return;

        if (error || !data) {
          setState({ kind: "error", message: "분류 결과를 불러오지 못했습니다." });
          return;
        }

        const rows: ClassifiedTransaction[] = (data as SampleTxRow[]).map((row) => ({
          id: row.id,
          occurredOn: row.occurred_on,
          merchant: row.merchant,
          amountKrw: row.amount_krw,
          classification: row.classification,
          accountCode: row.account_code,
          confidence: row.confidence,
          isUserEdited: false,
          fromRule: row.rule_id !== null,
        }));

        setState({ kind: "ready", rows });
      } catch {
        if (!cancelled) {
          setState({ kind: "error", message: "표본 분류에 실패했습니다." });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [analysisId]);

  const sampleCount = state.kind === "ready" ? state.rows.length : 0;
  const remaining = Math.max(rowCount - sampleCount, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="총액" value={`${totalKrw.toLocaleString("ko-KR")}원`} />
        <StatCard label="거래 건수" value={`${rowCount.toLocaleString("ko-KR")}건`} />
        <StatCard
          label="상위 가맹점"
          value={topMerchants[0]?.merchant ?? "-"}
        />
      </div>

      {state.kind === "loading" && (
        <p className="text-sm text-muted">표본 {SAMPLE_SIZE}건을 분류하는 중입니다...</p>
      )}

      {state.kind === "error" && (
        <p className="text-sm text-review">{state.message}</p>
      )}

      {state.kind === "sample_used" && (
        <p className="text-sm text-body">
          이 계정의 표본 분류는 이미 사용했습니다. Google 계정을 연결하면
          전체 {rowCount}건을 분류합니다.
        </p>
      )}

      {state.kind === "ready" && (
        <div className="flex flex-col gap-2">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-hairline text-left text-muted">
                <th className="px-3 py-2 font-medium">날짜</th>
                <th className="px-3 py-2 font-medium">가맹점</th>
                <th className="px-3 py-2 text-right font-mono font-medium">금액</th>
                <th className="px-3 py-2 font-medium">분류</th>
              </tr>
            </thead>
            <tbody>
              {state.rows.map((tx) => (
                <tr key={tx.id} className="border-b border-hairline-soft">
                  <td className="px-3 py-2 text-body">{tx.occurredOn}</td>
                  <td className="px-3 py-2 text-ink">{tx.merchant}</td>
                  <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                    {tx.amountKrw.toLocaleString("ko-KR")}원
                  </td>
                  <td className="px-3 py-2">
                    {tx.classification && (
                      <span
                        className={`rounded-full px-2.5 py-1 text-xs font-medium ${CLASSIFICATION_BADGE[tx.classification]}`}
                      >
                        {CLASSIFICATION_LABEL[tx.classification]}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <p className="text-sm text-muted">
            상위 {sampleCount}건을 분류했습니다. 나머지 {remaining}건은
            Google 계정을 연결하면 분류합니다.
          </p>
        </div>
      )}

      <ConnectPanel
        isAnonymous={isAnonymous}
        hasPendingAnalysis={true}
        redirectTo={redirectTo}
      />

      <p className="rounded-md bg-surface-soft px-4 py-3 text-xs text-muted">
        이 결과는 세무 조언이 아닙니다. 최종 판단은 세무 대리인과 상의하세요.
      </p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-canvas p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg font-medium tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
