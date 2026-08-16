/**
 * 집계 — 이 제품의 금액 계산은 전부 여기서만 일어난다.
 *
 * LLM에게 합계를 계산시키지 않으므로 산술 오류가 구조적으로 불가능하다.
 * 정수(원)만 누적한다. 부동소수점을 거치지 마라.
 */
import type { AnalysisSummary, MerchantTotal, PeriodTotal } from "@/types/analysis";
import type { NormalizedRow } from "@/types/domain";

/** 프리뷰에 보여줄 상위 가맹점 수. */
const TOP_MERCHANTS = 10;

export function summarize(rows: NormalizedRow[]): AnalysisSummary {
  let totalKrw = 0;
  const periods = new Map<string, number>();
  const merchants = new Map<string, number>();

  for (const row of rows) {
    totalKrw += row.amountKrw;

    const period = row.occurredOn.slice(0, 7);
    periods.set(period, (periods.get(period) ?? 0) + row.amountKrw);

    const merchant = normalizeMerchant(row.merchant);
    merchants.set(merchant, (merchants.get(merchant) ?? 0) + row.amountKrw);
  }

  return {
    totalKrw,
    rowCount: rows.length,
    periods: toPeriods(periods),
    topMerchants: toTopMerchants(merchants),
  };
}

/**
 * 앞뒤·연속 공백만 정리한다. 말미의 지점 표기('강남점')는 제거하지 않는다 —
 * 지점이 다르면 성격이 다를 수 있고(사무실 앞 카페 vs 여행지 카페), 병합은
 * 되돌릴 수 없다.
 */
function normalizeMerchant(raw: string): string {
  return raw.trim().replace(/\s+/g, " ");
}

function toPeriods(totals: Map<string, number>): PeriodTotal[] {
  return [...totals.entries()]
    .map(([period, totalKrw]) => ({ period, totalKrw }))
    .sort((a, b) => a.period.localeCompare(b.period));
}

function toTopMerchants(totals: Map<string, number>): MerchantTotal[] {
  return [...totals.entries()]
    .map(([merchant, amountKrw]) => ({ merchant, amountKrw }))
    .sort(
      (a, b) =>
        b.amountKrw - a.amountKrw || a.merchant.localeCompare(b.merchant),
    )
    .slice(0, TOP_MERCHANTS);
}
