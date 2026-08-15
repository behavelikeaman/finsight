"use client";

/**
 * 월별 사업경비/개인지출 막대. 보조 역할이다 — 표 아래에 둔다.
 */
import { Bar, BarChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export interface MonthlyDatum {
  period: string;
  business: number;
  personal: number;
}

export function MonthlyChart({ data }: { data: MonthlyDatum[] }) {
  if (data.length === 0) return null;

  return (
    <div className="rounded-lg border border-hairline bg-canvas p-4">
      <p className="mb-3 text-xs font-medium text-muted">월별 사업경비 · 개인지출</p>
      <div className="h-64 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data}>
            <XAxis dataKey="period" tick={{ fontSize: 11 }} stroke="var(--color-muted-soft)" />
            <YAxis tick={{ fontSize: 11 }} stroke="var(--color-muted-soft)" />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Bar dataKey="business" name="사업경비" fill="var(--color-business)" radius={[4, 4, 0, 0]} />
            <Bar dataKey="personal" name="개인지출" fill="var(--color-personal)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
