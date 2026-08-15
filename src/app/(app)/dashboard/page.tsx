import Link from "next/link";
import { redirect } from "next/navigation";

import { createServerSupabase } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/session";

import { BillingSync } from "@/components/billing/BillingSync";

// 사용자별 데이터라 정적 프리렌더 대상이 아니다. 키가 없는 빌드 환경에서
// cookies() 호출 전에 env 검사가 먼저 실행돼 프리렌더가 깨지는 것도 막는다.
export const dynamic = "force-dynamic";

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

  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-6 px-6 py-10">
      <h1 className="text-2xl font-normal text-ink">내 분석</h1>

      {checkoutId && <BillingSync checkoutId={checkoutId} />}

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
