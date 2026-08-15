/**
 * POST /api/analyses/:id/classify — 파이프라인 2단계(분류).
 *
 * 이 프로젝트에서 AI 비용이 발생하는 두 경로 중 하나(나머지는 step6의 chat).
 * 관문(A) → 규칙 선적용(A) → AI 호출(B) → 저장 → 차감(A) 순서를 반드시
 * 지킨다. 순서가 바뀌면 쿼터가 무의미해지거나, 실패한 호출인데 쿼터가 깎인다.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { pickSample } from "@/lib/analysis";
import { checkQuota, checkSampleAllowance, consumeQuota, markSampleUsed } from "@/lib/quota";
import { applyRules } from "@/lib/rules";
import { isAnonymousUser } from "@/lib/supabase/auth";
import { createServerSupabase } from "@/lib/supabase/server";
import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type { ClassifyMode, ClassifyRequest, ClassifyResponse } from "@/types/api";
import type { AccountCode, Classification, IdentifiedRow } from "@/types/domain";
import type { UserRuleRow } from "@/types/db";
import { SAMPLE_SIZE } from "@/types/tier";

import type { ClassifyOutputItem } from "@/services/anthropic/classify";
import { classifyTransactions } from "@/services/anthropic/classify";

interface PendingRow {
  id: string;
  occurred_on: string;
  merchant: string;
  amount_krw: number;
}

interface SaveItem {
  id: string;
  classification: Classification;
  accountCode: AccountCode | null;
  confidence: number;
  ruleId: string | null;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let userId: string;
  let anonymous: boolean;

  try {
    const user = await requireUser();
    userId = user.id;
    anonymous = isAnonymousUser(user);
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ ok: false }, { status: 401 });
    }
    throw err;
  }

  const { id: analysisId } = await context.params;
  const supabase = await createServerSupabase();

  const { data: analysis } = await supabase
    .from("analyses")
    .select("id, owner_id")
    .eq("id", analysisId)
    .eq("owner_id", userId)
    .maybeSingle();

  if (!analysis) {
    // 403이 아니라 404 — 존재 여부를 노출하지 않는다.
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  const requestedMode = await readMode(request);

  // mode는 서버가 재판정한다. 익명 세션이 'full'을 요청해도 거부한다.
  if (anonymous && requestedMode === "full") {
    return jsonResponse({ ok: false, reason: "anonymous_full_denied" });
  }
  const mode: ClassifyMode = anonymous ? "sample" : requestedMode;

  let quotaLeftAfter = 0;

  if (mode === "sample") {
    const allowed = await checkSampleAllowance(userId);
    if (!allowed) {
      return jsonResponse({ ok: false, reason: "sample_used" });
    }
  } else {
    const verdict = await checkQuota(userId, "classify");
    if (!verdict.allowed) {
      // classify의 QUOTA.classifyPerMonth는 두 티어 모두 0이 아니므로
      // 'tier_required'는 실제로 나오지 않는다. 방어적으로 매핑한다.
      return jsonResponse({ ok: false, reason: "quota_exceeded" });
    }
    quotaLeftAfter = verdict.left - 1;
  }

  const { data: pending, error: pendingError } = await supabase
    .from("transactions")
    .select("id, occurred_on, merchant, amount_krw")
    .eq("analysis_id", analysisId)
    .eq("owner_id", userId)
    // classification IS NULL인 건만 대상으로 한다. 이미 분류됐거나
    // is_user_edited=true인 건은 항상 classification이 채워져 있어 여기서
    // 자연히 제외된다 — 재분류하면 사용자가 고친 값이 덮인다.
    .is("classification", null);

  if (pendingError) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let candidateRows: IdentifiedRow[] = ((pending ?? []) as PendingRow[]).map(
    (row) => ({
      id: row.id,
      occurredOn: row.occurred_on,
      merchant: row.merchant,
      amountKrw: row.amount_krw,
    }),
  );

  if (mode === "sample") {
    candidateRows = pickSample(candidateRows, SAMPLE_SIZE);
  }

  const { data: rules } = await supabase
    .from("user_rules")
    .select("*")
    .eq("owner_id", userId);

  // 규칙 선적용이 AI 호출보다 먼저다. 여기 걸린 거래는 AI로 나가지 않는다.
  const { matched, unmatched } = applyRules(
    candidateRows,
    (rules ?? []) as UserRuleRow[],
  );

  const matchedSaveFailed = await saveClassifications(
    supabase,
    userId,
    matched.map((m) => ({
      id: m.row.id,
      classification: m.classification,
      accountCode: m.accountCode,
      // 규칙은 사용자 본인이 정한 결정론적 판정이라 확신도를 최대로 둔다.
      confidence: 1,
      ruleId: m.ruleId,
    })),
  );

  if (matchedSaveFailed) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let aiResults: ClassifyOutputItem[] = [];

  if (unmatched.length > 0) {
    try {
      aiResults = await classifyTransactions({ rows: unmatched });
    } catch {
      // 규칙으로 분류된 건은 이미 저장했다 — 비용이 들지 않았고 정확하므로
      // AI 실패와 함께 버릴 이유가 없다. 쿼터는 차감하지 않는다.
      return NextResponse.json({ ok: false }, { status: 502 });
    }

    const aiSaveFailed = await saveClassifications(
      supabase,
      userId,
      aiResults.map((r) => ({
        id: r.id,
        classification: r.classification,
        accountCode: r.accountCode,
        confidence: r.confidence,
        ruleId: null,
      })),
    );

    if (aiSaveFailed) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }
  }

  await supabase
    .from("analyses")
    .update({ classified_at: new Date().toISOString() })
    .eq("id", analysisId)
    .eq("owner_id", userId);

  // 관문 → 호출 → 차감. 성공 경로에서만 차감한다.
  if (mode === "sample") {
    await markSampleUsed(userId);
  } else {
    await consumeQuota(userId, "classify");
  }

  return jsonResponse({
    ok: true,
    classified: matched.length + aiResults.length,
    fromRules: matched.length,
    fromAi: aiResults.length,
    quotaLeft: mode === "sample" ? 0 : quotaLeftAfter,
  });
}

async function readMode(request: NextRequest): Promise<ClassifyMode> {
  try {
    const body = (await request.json()) as Partial<ClassifyRequest>;
    return body.mode === "full" ? "full" : "sample";
  } catch {
    return "sample";
  }
}

/** id 기준으로만 되짚어 갱신한다. owner_id 조건은 RLS의 2차 방어에 더해 명시적으로 건다. */
async function saveClassifications(
  supabase: SupabaseClient,
  userId: string,
  items: SaveItem[],
): Promise<boolean> {
  if (items.length === 0) return false;

  const results = await Promise.all(
    items.map((item) =>
      supabase
        .from("transactions")
        .update({
          classification: item.classification,
          account_code: item.accountCode,
          confidence: item.confidence,
          rule_id: item.ruleId,
        })
        .eq("id", item.id)
        .eq("owner_id", userId),
    ),
  );

  return results.some((result) => (result as { error: unknown }).error);
}

function jsonResponse(body: ClassifyResponse): NextResponse {
  return NextResponse.json(body);
}
