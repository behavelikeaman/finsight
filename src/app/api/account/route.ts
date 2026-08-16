/**
 * DELETE /api/account — 내 데이터 전체 삭제.
 *
 * "계정 삭제"가 아니다. analyses(→ transactions는 cascade)·user_rules만
 * 지우고 로그아웃한다. usage_counters·profiles·auth.users는 건드리지 않는다
 * — 이유는 ADR-018과 CLAUDE.md를 보라. 지우면 무료 사용자가 삭제→재업로드로
 * 월 1회 제한을 무한히 우회하거나, 결제한 사용자가 free로 돌아간다.
 */
import { NextResponse } from "next/server";

import { createServerSupabase } from "@/lib/supabase/server";
import { UnauthorizedError, requireUser } from "@/lib/supabase/session";
import type { OkResponse } from "@/types/api";

export async function DELETE(): Promise<NextResponse> {
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

  const supabase = await createServerSupabase();

  // transactions는 analyses의 ON DELETE CASCADE로 함께 지워진다.
  await supabase.from("analyses").delete().eq("owner_id", userId);
  await supabase.from("user_rules").delete().eq("owner_id", userId);
  await supabase.auth.signOut();

  const response: OkResponse = { ok: true };
  return NextResponse.json(response);
}
