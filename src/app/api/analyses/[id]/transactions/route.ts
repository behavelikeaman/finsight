/**
 * PATCH /api/analyses/:id/transactions — 사용자 수정 저장 + 선택적 규칙 학습.
 *
 * AI를 호출하지 않는다. 사용자가 고친 값을 그대로 저장할 뿐이다.
 * 여기서 저장한 규칙(user_rules)이 다음 분류 요청에서 applyRules의 입력이
 * 되어 AI 호출 건수를 줄인다(ADR-012).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { derivePattern } from "@/lib/rules";
import { createServerSupabase } from "@/lib/supabase/server";
import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type {
  CorrectionsRequest,
  CorrectionsResponse,
  TransactionEdit,
} from "@/types/api";
import type { AccountCode, Classification } from "@/types/domain";

const CLASSIFICATIONS: Classification[] = ["business", "personal", "review"];
const MAX_EDITS = 10_000;

class ValidationError extends Error {}

interface ExistingTx {
  id: string;
  merchant: string;
}

export async function PATCH(
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

  let body: CorrectionsRequest;
  try {
    body = await parseAndValidate(request);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ ok: false, reason: err.message }, { status: 400 });
    }
    throw err;
  }

  const { data: existing, error: existingError } = await supabase
    .from("transactions")
    .select("id, merchant")
    .eq("analysis_id", analysisId)
    .eq("owner_id", userId);

  if (existingError) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  const merchantById = new Map(
    ((existing ?? []) as ExistingTx[]).map((tx) => [tx.id, tx.merchant]),
  );

  // 다른 분석·다른 사용자의 거래로 가는 통로를 막는다. analysisId만 검사하고
  // edits[].id를 검사하지 않으면 남의 데이터를 고칠 수 있게 된다.
  for (const edit of body.edits) {
    if (!merchantById.has(edit.id)) {
      return NextResponse.json(
        { ok: false, reason: `edits[].id(${edit.id})가 이 분석에 속하지 않습니다.` },
        { status: 400 },
      );
    }
  }

  const updateFailed = await saveEdits(supabase, userId, body.edits);
  if (updateFailed) {
    return NextResponse.json({ ok: false }, { status: 500 });
  }

  let ruleIds: string[] = [];
  if (body.saveAsRule) {
    const result = await saveRules(supabase, userId, body.edits, merchantById);
    if (result === null) {
      return NextResponse.json({ ok: false }, { status: 500 });
    }
    ruleIds = result;
  }

  const response: CorrectionsResponse = { ok: true, ruleIds };
  return NextResponse.json(response);
}

async function saveEdits(
  supabase: SupabaseClient,
  userId: string,
  edits: TransactionEdit[],
): Promise<boolean> {
  const results = await Promise.all(
    edits.map((edit) =>
      supabase
        .from("transactions")
        .update({
          classification: edit.classification,
          account_code: edit.accountCode,
          is_user_edited: true,
          // 확신도는 AI 판단의 속성이다. 사람이 확정한 건에 남겨두면
          // bucketByClassification이 다시 "확인 필요"로 올린다.
          confidence: null,
        })
        .eq("id", edit.id)
        .eq("owner_id", userId),
    ),
  );

  return results.some((result) => (result as { error: unknown }).error);
}

/** derivePattern(merchant) 기준, 충돌 키 (owner_id, merchant_pattern)로 upsert한다. */
async function saveRules(
  supabase: SupabaseClient,
  userId: string,
  edits: TransactionEdit[],
  merchantById: Map<string, string>,
): Promise<string[] | null> {
  const byPattern = new Map<
    string,
    { classification: Classification; accountCode: AccountCode | null }
  >();

  for (const edit of edits) {
    const merchant = merchantById.get(edit.id);
    if (merchant === undefined) continue;

    const pattern = derivePattern(merchant);
    byPattern.set(pattern, {
      classification: edit.classification,
      accountCode: edit.accountCode,
    });
  }

  const payload = [...byPattern.entries()].map(([merchant_pattern, v]) => ({
    owner_id: userId,
    merchant_pattern: merchant_pattern,
    classification: v.classification,
    account_code: v.accountCode,
  }));

  const { data, error } = await supabase
    .from("user_rules")
    .upsert(payload, { onConflict: "owner_id,merchant_pattern" })
    .select("id");

  if (error) return null;

  return ((data ?? []) as { id: string }[]).map((row) => row.id);
}

async function parseAndValidate(
  request: NextRequest,
): Promise<CorrectionsRequest> {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    throw new ValidationError("본문이 올바른 JSON이 아닙니다.");
  }

  if (typeof json !== "object" || json === null) {
    throw new ValidationError("본문 형식이 올바르지 않습니다.");
  }
  const body = json as Record<string, unknown>;

  if (!Array.isArray(body.edits) || body.edits.length === 0) {
    throw new ValidationError("edits가 비어 있습니다.");
  }

  if (body.edits.length > MAX_EDITS) {
    throw new ValidationError(`edits 수 상한(${MAX_EDITS})을 초과했습니다.`);
  }

  const edits = body.edits.map((edit, index) => validateEdit(edit, index));

  return { edits, saveAsRule: body.saveAsRule === true };
}

function validateEdit(value: unknown, index: number): TransactionEdit {
  if (typeof value !== "object" || value === null) {
    throw new ValidationError(`edits[${index}]가 올바르지 않습니다.`);
  }
  const edit = value as Record<string, unknown>;

  if (typeof edit.id !== "string" || edit.id.trim().length === 0) {
    throw new ValidationError(`edits[${index}].id가 올바르지 않습니다.`);
  }

  if (!isClassification(edit.classification)) {
    throw new ValidationError(`edits[${index}].classification이 올바르지 않습니다.`);
  }

  const classification = edit.classification;
  const accountCode =
    classification === "business" && typeof edit.accountCode === "string"
      ? (edit.accountCode as AccountCode)
      : null;

  return { id: edit.id, classification, accountCode };
}

function isClassification(value: unknown): value is Classification {
  return CLASSIFICATIONS.includes(value as Classification);
}
