"use client";

/**
 * 고밀도 분류 표. 낙관적 업데이트 후 PATCH하고, 실패하면 되돌린다.
 * 버킷 분류 로직은 여기서 다시 만들지 않는다 — 호출부가 bucketByClassification
 * 결과를 넘긴다.
 */
import { useEffect, useState } from "react";

import type { CorrectionsRequest, CorrectionsResponse } from "@/types/api";
import type { AccountCode, Classification } from "@/types/domain";
import type { ClassifiedTransaction } from "@/types/analysis";

import { ACCOUNT_CODES, ACCOUNT_CODE_LABEL } from "./accountCodeLabels";

interface TransactionTableProps {
  analysisId: string;
  rows: ClassifiedTransaction[];
  /** 사업경비 표에서만 켠다 — 계정과목별로 묶어 소계를 보여준다. */
  groupByAccountCode?: boolean;
  emptyMessage?: string;
}

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  business: "사업경비",
  personal: "개인지출",
  review: "확인 필요",
};

export function TransactionTable({
  analysisId,
  rows,
  groupByAccountCode = false,
  emptyMessage = "표시할 거래가 없습니다.",
}: TransactionTableProps) {
  const [prevRows, setPrevRows] = useState(rows);
  const [localRows, setLocalRows] = useState(rows);
  const [toast, setToast] = useState<string | null>(null);

  // 부모(Server Component)가 router.refresh()로 새 데이터를 내려주면 동기화한다.
  // React 권장 패턴: effect가 아니라 렌더 중에 prop 변화를 감지해 state를 조정한다.
  if (rows !== prevRows) {
    setPrevRows(rows);
    setLocalRows(rows);
  }

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(timer);
  }, [toast]);

  const handleChange = async (
    id: string,
    classification: Classification,
    accountCode: AccountCode | null,
  ) => {
    const target = localRows.find((r) => r.id === id);
    if (!target) return;

    const normalizedAccountCode = classification === "business" ? accountCode : null;
    const previous = localRows;

    setLocalRows((rs) =>
      rs.map((r) =>
        r.id === id
          ? {
              ...r,
              classification,
              accountCode: normalizedAccountCode,
              isUserEdited: true,
              confidence: null,
            }
          : r,
      ),
    );

    const saveAsRule = window.confirm(
      `'${target.merchant}'는 앞으로도 이렇게 분류할까요?`,
    );

    try {
      const body: CorrectionsRequest = {
        edits: [{ id, classification, accountCode: normalizedAccountCode }],
        saveAsRule,
      };
      const res = await fetch(`/api/analyses/${analysisId}/transactions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as CorrectionsResponse | { ok: false };

      if (!json.ok) throw new Error("저장 실패");

      if (saveAsRule) {
        setToast(
          `'${target.merchant}' → ${CLASSIFICATION_LABEL[classification]}으로 앞으로 자동 분류됩니다`,
        );
      }
    } catch {
      setLocalRows(previous);
      setToast("저장에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  if (localRows.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  const groups = groupByAccountCode ? groupRows(localRows) : [{ code: null, rows: localRows, total: null }];

  return (
    <div className="flex flex-col gap-2">
      {toast && (
        <p className="rounded-md bg-surface-strong px-4 py-2 text-sm text-ink">{toast}</p>
      )}
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-hairline text-left text-muted">
            <th className="px-3 py-2 font-medium">날짜</th>
            <th className="px-3 py-2 font-medium">가맹점</th>
            <th className="px-3 py-2 text-right font-medium">금액</th>
            <th className="px-3 py-2 font-medium">분류</th>
            <th className="px-3 py-2 font-medium">계정과목</th>
            <th className="px-3 py-2 font-medium">확신도</th>
            <th className="px-3 py-2 font-medium">출처</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((group) => (
            <RowGroup
              key={group.code ?? "all"}
              group={group}
              onChange={(id, classification, accountCode) =>
                void handleChange(id, classification, accountCode)
              }
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface Group {
  code: AccountCode | null;
  rows: ClassifiedTransaction[];
  total: number | null;
}

function RowGroup({
  group,
  onChange,
}: {
  group: Group;
  onChange: (
    id: string,
    classification: Classification,
    accountCode: AccountCode | null,
  ) => void;
}) {
  return (
    <>
      {group.code !== null && group.total !== null && (
        <tr className="bg-surface-soft">
          <td colSpan={6} className="px-3 py-1.5 text-xs font-medium text-muted">
            {ACCOUNT_CODE_LABEL[group.code]}
          </td>
          <td className="px-3 py-1.5 text-right font-mono text-xs font-medium tabular-nums text-muted">
            {group.total.toLocaleString("ko-KR")}원
          </td>
        </tr>
      )}
      {group.rows.map((tx) => (
        <TxRow key={tx.id} tx={tx} onChange={onChange} />
      ))}
    </>
  );
}

function TxRow({
  tx,
  onChange,
}: {
  tx: ClassifiedTransaction;
  onChange: (
    id: string,
    classification: Classification,
    accountCode: AccountCode | null,
  ) => void;
}) {
  const needsReview = tx.classification === "review" || tx.classification === null;
  const rowBg = needsReview ? "review-row bg-review-soft" : "";

  return (
    <tr className={`border-b border-hairline-soft ${rowBg}`}>
      <td className="px-3 py-2 text-body">{tx.occurredOn}</td>
      <td className="px-3 py-2 text-ink">{tx.merchant}</td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-ink">
        {tx.amountKrw.toLocaleString("ko-KR")}원
      </td>
      <td className="px-3 py-2">
        <select
          value={tx.classification ?? ""}
          onChange={(e) =>
            onChange(tx.id, e.target.value as Classification, tx.accountCode)
          }
          className="rounded-md border border-hairline bg-canvas px-2 py-1 text-xs text-ink"
        >
          <option value="" disabled>
            미분류
          </option>
          <option value="business">사업경비</option>
          <option value="personal">개인지출</option>
          <option value="review">확인 필요</option>
        </select>
      </td>
      <td className="px-3 py-2">
        <select
          value={tx.accountCode ?? ""}
          disabled={tx.classification !== "business"}
          onChange={(e) =>
            onChange(
              tx.id,
              tx.classification ?? "business",
              (e.target.value || null) as AccountCode | null,
            )
          }
          className="rounded-md border border-hairline bg-canvas px-2 py-1 text-xs text-ink disabled:cursor-not-allowed disabled:opacity-50"
        >
          <option value="">-</option>
          {ACCOUNT_CODES.map((code) => (
            <option key={code} value={code}>
              {ACCOUNT_CODE_LABEL[code]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 font-mono tabular-nums text-muted">
        {tx.confidence === null ? "-" : `${Math.round(tx.confidence * 100)}%`}
      </td>
      <td className="px-3 py-2 text-xs text-muted">{sourceLabel(tx)}</td>
    </tr>
  );
}

function sourceLabel(tx: ClassifiedTransaction): string {
  if (tx.isUserEdited) return "사용자 수정";
  if (tx.fromRule) return "규칙";
  if (tx.classification === null) return "미분류";
  return "AI";
}

function groupRows(rows: ClassifiedTransaction[]): Group[] {
  const order: string[] = [];
  const byCode = new Map<string, ClassifiedTransaction[]>();

  for (const row of rows) {
    const key = row.accountCode ?? "__none__";
    if (!byCode.has(key)) {
      byCode.set(key, []);
      order.push(key);
    }
    byCode.get(key)?.push(row);
  }

  return order.map((key) => {
    const groupRowsForKey = byCode.get(key) ?? [];
    return {
      code: key === "__none__" ? null : (key as AccountCode),
      rows: groupRowsForKey,
      total: groupRowsForKey.reduce((sum, r) => sum + r.amountKrw, 0),
    };
  });
}
