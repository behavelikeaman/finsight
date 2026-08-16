import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser, getEffectiveTier } from "@/lib/supabase/session";
import type { Tier } from "@/types/domain";

import { BillingSync } from "@/components/billing/BillingSync";
import { ManageSubscriptionButton } from "@/components/billing/ManageSubscriptionButton";
import { UpgradeButton } from "@/components/billing/UpgradeButton";

// 사용자별 데이터라 정적 프리렌더 대상이 아니다. 키가 없는 빌드 환경에서
// cookies() 호출 전에 env 검사가 먼저 실행돼 프리렌더가 깨지는 것도 막는다.
export const dynamic = "force-dynamic";

interface SubscriptionRow {
  current_period_end: string | null;
  polar_customer_id: string | null;
  subscription_status: string | null;
}

interface AnalysisListRow {
  id: string;
  card_label: string | null;
  row_count: number;
  classified_at: string | null;
  created_at: string;
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ checkout_id?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/");

  // Polar 체크아웃이 붙여준 식별자. 있으면 결제 직후 복귀한 것이므로
  // 화면을 그리기 전에 billing/sync 로 구독 상태를 먼저 확인한다.
  const { checkout_id: checkoutId } = await searchParams;

  const supabase = await createServerSupabase();
  const { data } = await supabase
    .from("analyses")
    .select("id, card_label, row_count, classified_at, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });

  const analyses = (data ?? []) as AnalysisListRow[];

  // 티어 판정은 effective_tier 하나로만 한다. current_period_end 는 화면에
  // 기간을 적기 위해서만 읽고, 여기서 다시 만료를 계산하지 않는다.
  const tier = await getEffectiveTier(user.id);
  const { data: profileData } = await supabase
    .from("profiles")
    .select("current_period_end, polar_customer_id, subscription_status")
    .eq("id", user.id)
    .maybeSingle();

  const profile = (profileData ?? null) as SubscriptionRow | null;
  // 결제 이력이 있어야 Polar에 고객이 존재한다. 없는 사용자에게 관리 버튼을
  // 보이면 눌러도 404다 — 서버가 판정해서 아예 내보내지 않는다.
  const hasPolarCustomer = Boolean(profile?.polar_customer_id);
  // 카드가 만료됐는데 사용자가 그 사실을 모르는 것이 결제 실패 이탈의 실제
  // 원인이다. 기능을 잠그는 대신 고칠 곳을 알려준다.
  const paymentFailed = profile?.subscription_status === "past_due";

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-normal text-ink">내 분석</h1>

      {checkoutId && <BillingSync checkoutId={checkoutId} />}

      {paymentFailed && (
        // 세무 판단이 아니라 결제 안내다. 남은 일수를 단정하지 않는다 —
        // 재시도 일정은 Polar가 정하고 우리는 그 값을 갖고 있지 않다.
        <section
          role="status"
          className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-review-soft px-5 py-4"
        >
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-ink">
              결제 수단 확인이 필요합니다
            </p>
            <p className="text-xs text-body">
              마지막 결제가 처리되지 않았습니다. 카드가 만료되었거나 한도를
              초과했을 수 있습니다. 결제 수단을 갱신하지 않으면 이용 기간이
              끝난 뒤 무료 플랜으로 전환됩니다.
            </p>
          </div>
          <ManageSubscriptionButton />
        </section>
      )}

      <section className="flex flex-wrap items-center justify-between gap-4 rounded-lg border border-hairline bg-canvas px-5 py-4">
        <div className="flex flex-col gap-1">
          <p className="text-sm font-medium text-ink">
            {tier === "pro" ? "Pro 플랜" : "무료 플랜"}
          </p>
          <p className="text-xs text-muted">
            {planNote(tier, profile?.current_period_end ?? null, hasPolarCustomer)}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {tier !== "pro" && <UpgradeButton />}
          {hasPolarCustomer && <ManageSubscriptionButton />}
        </div>
      </section>

      {analyses.length === 0 ? (
        <p className="text-sm text-muted">
          아직 업로드한 명세서가 없습니다.{" "}
          <Link href="/" className="text-primary">
            파일을 올려 시작하세요.
          </Link>
        </p>
      ) : (
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">업로드한 명세서 목록</caption>
          <thead>
            <tr className="border-b border-hairline text-left text-muted">
              <th scope="col" className="px-3 py-2 font-medium">
                카드 라벨
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                업로드일
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                행 수
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                분류 상태
              </th>
            </tr>
          </thead>
          <tbody>
            {analyses.map((analysis) => (
              <tr key={analysis.id} className="border-b border-hairline-soft">
                <td className="px-3 py-2">
                  <Link
                    href={`/dashboard/${analysis.id}`}
                    className="text-ink hover:text-primary"
                  >
                    {analysis.card_label ?? "명세서"}
                  </Link>
                </td>
                <td className="px-3 py-2 text-body">
                  {analysis.created_at.slice(0, 10)}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
                  {analysis.row_count.toLocaleString("ko-KR")}건
                </td>
                <td className="px-3 py-2">
                  {analysis.classified_at ? (
                    <span className="rounded-full bg-business-soft px-2.5 py-1 text-xs font-medium text-business-ink">
                      분류 완료
                    </span>
                  ) : (
                    <span className="rounded-full bg-surface-strong px-2.5 py-1 text-xs font-medium text-muted">
                      분류 전
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}

/**
 * "다음 결제일"이라고 쓰지 않는다. 해지를 예약한 구독도 같은 날짜를 갖는데,
 * 우리는 그 둘을 구분할 정보를 저장하지 않는다. 기간의 끝이라고만 적는다.
 */
function planNote(
  tier: Tier,
  currentPeriodEnd: string | null,
  hasPolarCustomer: boolean,
): string {
  if (tier === "pro" && currentPeriodEnd) {
    return `${currentPeriodEnd.slice(0, 10)}까지 이용할 수 있습니다.`;
  }

  if (hasPolarCustomer) {
    return "지난 결제 내역과 카드 정보는 구독 관리에서 확인할 수 있습니다.";
  }

  return "Pro로 업그레이드하면 전건 분류와 Q&A를 사용할 수 있습니다.";
}
