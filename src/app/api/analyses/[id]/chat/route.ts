/**
 * POST /api/analyses/:id/chat — 파이프라인 3단계(Q&A). Pro 전용.
 *
 * classify 라우트와 이 프로젝트에서 AI 비용이 발생하는 두 경로 중 하나다.
 * 같은 분석에 이어서 묻는 질문들이 system·ledger 프리픽스를 재사용하므로,
 * 거래 조회 순서를 고정해야 한다 — 순서가 흔들리면 질문마다 캐시가 미스되어
 * 입력비가 약 10배가 된다.
 */
import { NextResponse, type NextRequest } from "next/server";

import { checkQuota, consumeQuota } from "@/lib/quota";
import { createServerSupabase } from "@/lib/supabase/server";
import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type { ChatRequest, ChatResponse } from "@/types/api";
import type { IdentifiedRow } from "@/types/domain";

import { askAboutLedger } from "@/services/anthropic/chat";

const MAX_QUESTION_LENGTH = 2000;

interface TxRow {
  id: string;
  occurred_on: string;
  merchant: string;
  amount_krw: number;
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
): Promise<NextResponse> {
  let userId: string;

  try {
    const user = await requireUser();
    userId = user.id;
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
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // 쿼터 검사가 Anthropic 호출보다 먼저다. tier_required와 quota_exceeded를
  // 구분해 반환한다 — "결제하세요"와 "다음 달에 오세요"는 다른 안내다.
  const verdict = await checkQuota(userId, "chat");
  if (!verdict.allowed) {
    return jsonResponse({ ok: false, reason: verdict.reason });
  }

  const question = await readQuestion(request);
  if (question === null) {
    return NextResponse.json({ ok: false }, { status: 400 });
  }

  const { data: txData, error: txError } = await supabase
    .from("transactions")
    .select("id, occurred_on, merchant, amount_krw")
    .eq("analysis_id", analysisId)
    .eq("owner_id", userId)
    // DB가 반환 순서를 보장하지 않는다. 순서가 호출마다 달라지면 프롬프트
    // 캐시 프리픽스가 매번 미스된다.
    .order("occurred_on", { ascending: true })
    .order("id", { ascending: true });

  if (txError) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const rows: IdentifiedRow[] = ((txData ?? []) as TxRow[]).map((row) => ({
    id: row.id,
    occurredOn: row.occurred_on,
    merchant: row.merchant,
    amountKrw: row.amount_krw,
  }));

  let answer: string;
  try {
    answer = await askAboutLedger(rows, question);
  } catch {
    // 실패한 호출은 쿼터를 차감하지 않는다.
    return NextResponse.json({ ok: false }, { status: 502 });
  }

  // 성공 경로에서만 차감한다.
  await consumeQuota(userId, "chat");

  return jsonResponse({ ok: true, answer, quotaLeft: verdict.left - 1 });
}

async function readQuestion(request: NextRequest): Promise<string | null> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return null;
  }

  if (typeof json !== "object" || json === null) return null;
  const body = json as Partial<ChatRequest>;

  if (typeof body.question !== "string") return null;
  const question = body.question.trim();

  if (question.length === 0 || question.length > MAX_QUESTION_LENGTH) {
    return null;
  }

  return question;
}

function jsonResponse(body: ChatResponse): NextResponse {
  return NextResponse.json(body);
}
