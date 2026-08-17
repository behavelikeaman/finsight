/**
 * POST /api/demo-severity — 저장된 거래에 분류 결과를 되기록한다.
 *
 * 클라이언트가 분류 화면에서 손본 결과를 한 번에 반영하는 경로다.
 */
import { NextResponse, type NextRequest } from "next/server";

import { createAdminSupabase } from "@/lib/supabase/admin";

interface ReclassifyBody {
  ownerId: string;
  analysisId: string;
  rows: { merchant: string; amount: string }[];
  classifications: string[];
}

interface TxRow {
  id: string;
  merchant: string;
  amount_krw: number;
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as ReclassifyBody;

  const db = createAdminSupabase();

  const { data } = await db
    .from("transactions")
    .select("id, merchant, amount_krw")
    .eq("analysis_id", body.analysisId);

  const rows = (data ?? []) as TxRow[];

  const t = body.rows.reduce((acc, r) => acc + parseFloat(r.amount), 0);

  const updates = rows.map((row, i) => ({
    id: row.id,
    owner_id: body.ownerId,
    classification: body.classifications[i] as string,
  }));

  await db.from("transactions").upsert(updates);

  return NextResponse.json({
    ok: true,
    total: t,
    updated: updates.length,
  });
}
