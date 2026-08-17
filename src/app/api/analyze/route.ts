/**
 * POST /api/analyze — 파이프라인 1단계(집계). LLM을 호출하지 않는다.
 *
 * 원본 파일이 아니라 브라우저가 정규화한 거래 배열만 JSON으로 받는다(ADR-006).
 * 클라이언트가 보낸 집계·owner_id는 신뢰하지 않는다 — 서버가 auth.uid()로
 * owner_id를 채우고 summarize()로 직접 재집계한다.
 */
import { NextResponse, type NextRequest } from "next/server";

import { computeFingerprint, summarize } from "@/lib/analysis";
import { createServerSupabase } from "@/lib/supabase/server";
import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type { AnalyzeRequest, AnalyzeResponse } from "@/types/api";
import type { NormalizedRow, SourceKind } from "@/types/domain";
import { MAX_ROWS } from "@/types/tier";

/** 10,000행짜리 정규화 배열의 실측 크기에 여유를 둔 상한. 환경별로 조정 가능하다. */
const MAX_BODY_BYTES = Number(
  process.env.ANALYZE_MAX_BODY_BYTES ?? 5 * 1024 * 1024,
);
const OCCURRED_ON_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const SOURCE_KINDS: SourceKind[] = ["csv", "xlsx"];

class ValidationError extends Error {}

export async function POST(request: NextRequest): Promise<NextResponse> {
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

  let body: AnalyzeRequest;
  try {
    body = await parseAndValidate(request);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json(
        { ok: false, reason: err.message },
        { status: 400 },
      );
    }
    throw err;
  }

  const fingerprint = await computeFingerprint(body.rows);
  const supabase = await createServerSupabase();

  const { data: existing } = await supabase
    .from("analyses")
    .select("id")
    .eq("owner_id", userId)
    .eq("fingerprint", fingerprint)
    .maybeSingle();

  if (existing) {
    const response: AnalyzeResponse = {
      ok: false,
      reason: "duplicate",
      existingId: (existing as { id: string }).id,
    };
    return NextResponse.json(response);
  }

  const summary = summarize(body.rows);

  const { data: analysis, error: analysisError } = await supabase
    .from("analyses")
    .insert({
      owner_id: userId,
      card_label: body.cardLabel ?? null,
      fingerprint,
      source_kind: body.sourceKind,
      row_count: body.rows.length,
    })
    .select("id")
    .single();

  if (analysisError || !analysis) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const analysisId = (analysis as { id: string }).id;

  const { error: txError } = await supabase.from("transactions").insert(
    body.rows.map((row) => ({
      analysis_id: analysisId,
      owner_id: userId,
      occurred_on: row.occurredOn,
      merchant: row.merchant,
      amount_krw: row.amountKrw,
      classification: null,
      account_code: null,
      confidence: null,
    })),
  );

  if (txError) {
    // 부분 저장을 남기지 않는다. 고아 analyses 행이 생기지 않도록 되돌린다.
    await supabase.from("analyses").delete().eq("id", analysisId);
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const response: AnalyzeResponse = { ok: true, analysisId, summary };
  return NextResponse.json(response);
}

async function parseAndValidate(
  request: NextRequest,
): Promise<AnalyzeRequest> {
  const raw = await request.text();
  if (new TextEncoder().encode(raw).length > MAX_BODY_BYTES) {
    throw new ValidationError("본문이 상한을 초과했습니다.");
  }

  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    throw new ValidationError("본문이 올바른 JSON이 아닙니다.");
  }

  if (typeof json !== "object" || json === null) {
    throw new ValidationError("본문 형식이 올바르지 않습니다.");
  }
  const body = json as Record<string, unknown>;

  if (!Array.isArray(body.rows) || body.rows.length === 0) {
    throw new ValidationError("rows가 비어 있습니다.");
  }

  if (body.rows.length > MAX_ROWS) {
    throw new ValidationError(`행 수 상한(${MAX_ROWS})을 초과했습니다.`);
  }

  if (
    typeof body.sourceKind !== "string" ||
    !SOURCE_KINDS.includes(body.sourceKind as SourceKind)
  ) {
    throw new ValidationError("sourceKind가 올바르지 않습니다.");
  }

  const rows: NormalizedRow[] = body.rows.map((row, index) =>
    validateRow(row, index),
  );

  return {
    rows,
    cardLabel: typeof body.cardLabel === "string" ? body.cardLabel : undefined,
    sourceKind: body.sourceKind as SourceKind,
  };
}

function validateRow(value: unknown, index: number): NormalizedRow {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`rows[${index}]가 올바르지 않습니다.`);
  }
  const row = value as Record<string, unknown>;

  if (
    typeof row.occurredOn !== "string" ||
    !OCCURRED_ON_PATTERN.test(row.occurredOn)
  ) {
    throw new ValidationError(`rows[${index}].occurredOn 형식이 올바르지 않습니다.`);
  }

  if (typeof row.merchant !== "string" || row.merchant.trim().length === 0) {
    throw new ValidationError(`rows[${index}].merchant가 비어 있습니다.`);
  }

  if (typeof row.amountKrw !== "number" || !Number.isInteger(row.amountKrw)) {
    throw new ValidationError(`rows[${index}].amountKrw가 정수가 아닙니다.`);
  }

  return {
    occurredOn: row.occurredOn,
    merchant: row.merchant,
    amountKrw: row.amountKrw,
  };
}
