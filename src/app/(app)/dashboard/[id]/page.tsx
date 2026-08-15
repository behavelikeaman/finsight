import { notFound, redirect } from "next/navigation";

import { bucketByClassification } from "@/lib/analysis";
import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser, getEffectiveTier } from "@/lib/supabase/session";
import type { ClassifiedTransaction } from "@/types/analysis";
import type { AccountCode, Classification } from "@/types/domain";

import { ChatPanel } from "@/components/dashboard/ChatPanel";
import { ClassifyFullButton } from "@/components/dashboard/ClassifyFullButton";
import { DeleteDataButton } from "@/components/dashboard/DeleteDataButton";
import { ExportButton } from "@/components/dashboard/ExportButton";
import { MonthlyChart, type MonthlyDatum } from "@/components/dashboard/MonthlyChart";
import { TransactionTable } from "@/components/dashboard/TransactionTable";

// 사용자별 데이터라 정적 프리렌더 대상이 아니다. 키가 없는 빌드 환경에서
// cookies() 호출 전에 env 검사가 먼저 실행돼 프리렌더가 깨지는 것도 막는다.
export const dynamic = "force-dynamic";

interface AnalysisRow {
  id: string;
  card_label: string | null;
  classified_at: string | null;
}

interface TxRow {
  id: string;
  occurred_on: string;
  merchant: string;
  amount_krw: number;
  classification: Classification | null;
  account_code: AccountCode | null;
  confidence: number | null;
  is_user_edited: boolean;
  rule_id: string | null;
}

export default async function AnalysisDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  const { id: analysisId } = await params;
  const supabase = await createServerSupabase();

  const { data: analysis } = await supabase
    .from("analyses")
    .select("id, card_label, classified_at")
    .eq("id", analysisId)
    .eq("owner_id", user.id)
    .maybeSingle();

  if (!analysis) notFound();
  const analysisRow = analysis as AnalysisRow;

  const { data: txData } = await supabase
    .from("transactions")
    .select(
      "id, occurred_on, merchant, amount_krw, classification, account_code, confidence, is_user_edited, rule_id",
    )
    .eq("analysis_id", analysisId)
    .eq("owner_id", user.id)
    .order("occurred_on", { ascending: true })
    .order("id", { ascending: true });

  const transactions: ClassifiedTransaction[] = ((txData ?? []) as TxRow[]).map(
    (row) => ({
      id: row.id,
      occurredOn: row.occurred_on,
      merchant: row.merchant,
      amountKrw: row.amount_krw,
      classification: row.classification,
      accountCode: row.account_code,
      confidence: row.confidence,
      isUserEdited: row.is_user_edited,
      fromRule: row.rule_id !== null,
    }),
  );

  const view = bucketByClassification(transactions);
  const totalKrw = transactions.reduce((sum, tx) => sum + tx.amountKrw, 0);
  const unresolvedCount = view.review.length + view.unclassified.length;
  const needsFullClassify =
    analysisRow.classified_at === null || view.unclassified.length > 0;

  const tier = await getEffectiveTier(user.id);
  const monthlyData = buildMonthlyData(transactions);

  const businessSorted = [...view.business].sort((a, b) =>
    (a.accountCode ?? "").localeCompare(b.accountCode ?? ""),
  );

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-8 px-6 py-10">
      <p className="no-print rounded-md bg-surface-soft px-4 py-3 text-xs text-muted">
        이 결과는 세무 조언이 아닙니다. 최종 판단은 세무 대리인과 상의하세요.
      </p>

      <div>
        <h1 className="text-2xl font-normal text-ink">
          {analysisRow.card_label ?? "명세서"}
        </h1>
      </div>

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-4">
        <SummaryCard label="총액" value={`${totalKrw.toLocaleString("ko-KR")}원`} />
        <SummaryCard
          label="사업경비 합계"
          value={`${view.businessTotalKrw.toLocaleString("ko-KR")}원`}
        />
        <SummaryCard
          label="개인지출 합계"
          value={`${view.personalTotalKrw.toLocaleString("ko-KR")}원`}
        />
        <SummaryCard label="미확정 건수" value={`${unresolvedCount}건`} />
      </section>

      <div className="no-print flex flex-wrap items-center gap-3">
        {needsFullClassify && <ClassifyFullButton analysisId={analysisId} />}
        {tier === "pro" && <ExportButton rows={transactions} />}
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-normal text-ink">확인 필요</h2>
        <TransactionTable
          analysisId={analysisId}
          rows={[...view.review, ...view.unclassified]}
          emptyMessage="확인이 필요한 거래가 없습니다."
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-normal text-ink">사업경비</h2>
        <TransactionTable
          analysisId={analysisId}
          rows={businessSorted}
          groupByAccountCode
          emptyMessage="사업경비로 분류된 거래가 없습니다."
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-normal text-ink">개인지출</h2>
        <TransactionTable
          analysisId={analysisId}
          rows={view.personal}
          emptyMessage="개인지출로 분류된 거래가 없습니다."
        />
      </section>

      <MonthlyChart data={monthlyData} />

      {tier === "pro" && (
        <div className="no-print">
          <ChatPanel analysisId={analysisId} />
        </div>
      )}

      <section className="no-print flex flex-col gap-2 border-t border-hairline pt-6">
        <h2 className="text-sm font-medium text-ink">설정</h2>
        <DeleteDataButton />
      </section>
    </main>
  );
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-2xl border border-hairline bg-canvas p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-mono text-lg font-medium tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}

/** 월별 사업경비/개인지출 합계. LLM이 아니라 코드가 계산한다. */
function buildMonthlyData(transactions: ClassifiedTransaction[]): MonthlyDatum[] {
  const byPeriod = new Map<string, { business: number; personal: number }>();

  for (const tx of transactions) {
    if (tx.classification !== "business" && tx.classification !== "personal") {
      continue;
    }

    const period = tx.occurredOn.slice(0, 7);
    const entry = byPeriod.get(period) ?? { business: 0, personal: 0 };
    entry[tx.classification] += tx.amountKrw;
    byPeriod.set(period, entry);
  }

  return [...byPeriod.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([period, totals]) => ({ period, ...totals }));
}
