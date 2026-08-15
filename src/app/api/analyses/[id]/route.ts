/**
 * DELETE /api/analyses/:id — 분석 삭제.
 *
 * transactions는 ON DELETE CASCADE로 함께 지워진다. 남의 분석에는 403이
 * 아니라 404를 반환한다 — 존재 여부를 노출하지 않는다.
 */
import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type { OkResponse } from "@/types/api";

export async function DELETE(
  request: Request,
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

  await supabase
    .from("analyses")
    .delete()
    .eq("id", analysisId)
    .eq("owner_id", userId);

  const response: OkResponse = { ok: true };
  return NextResponse.json(response);
}
