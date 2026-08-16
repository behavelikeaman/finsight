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
  /**
   * 표의 접근 이름. 한 화면에 표가 여러 개라 화면 낭독기 사용자는 이것 없이는
   * 어느 표를 읽고 있는지 알 수 없다. 시각적으로는 섹션 제목과 중복이라 숨긴다.
   */
  caption: string;
}

const CLASSIFICATION_LABEL: Record<Classification, string> = {
  business: "사업경비",
  personal: "개인지출",
  review: "확인 필요",
};

/**
 * 표 안 폼 컨트롤의 단일 규격. 분류·계정과목 셀렉트가 같은 반경·높이·테두리를
 * 쓴다. 키보드만으로 표 전체를 수정할 수 있어야 하므로 포커스 링을 명시한다.
 */
const CONTROL_CLASS =
  "rounded-md border border-muted-soft bg-canvas px-2 py-1 text-xs text-ink " +
  "focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary";

interface RuleEdit {
  id: string;
  merchant: string;
  classification: Classification;
  accountCode: AccountCode | null;
}

/**
 * 수정은 곧바로 저장하고, 규칙 등록은 그 뒤에 제안한다.
 *
 * 저장 전에 확인 대화상자를 띄우면 확인 필요 건을 연달아 고칠 때마다 흐름이
 * 끊긴다. 규칙은 사용자가 원할 때만 한 번 더 누르면 된다.
 */
type Notice =
  | { kind: "rule-offer"; text: string; edit: RuleEdit }
  | { kind: "message"; text: string };

export function TransactionTable({
  analysisId,
  rows,
  groupByAccountCode = false,
  emptyMessage = "표시할 거래가 없습니다.",
  caption,
}: TransactionTableProps) {
  const [prevRows, setPrevRows] = useState(rows);
  const [localRows, setLocalRows] = useState(rows);
  const [notice, setNotice] = useState<Notice | null>(null);

  // 부모(Server Component)가 router.refresh()로 새 데이터를 내려주면 동기화한다.
  // React 권장 패턴: effect가 아니라 렌더 중에 prop 변화를 감지해 state를 조정한다.
  if (rows !== prevRows) {
    setPrevRows(rows);
    setLocalRows(rows);
  }

  useEffect(() => {
    // 규칙 제안은 시간이 지나도 지우지 않는다. 놓치면 규칙이 저장되지 않고,
    // 규칙 학습이 없으면 다음 달에도 같은 거래를 AI로 다시 분류하게 된다.
    // 다음 수정이 들어오면 새 제안으로 교체되고, 닫기로도 없앨 수 있다.
    if (!notice || notice.kind === "rule-offer") return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);

  const save = async (edit: RuleEdit, saveAsRule: boolean): Promise<boolean> => {
    try {
      const body: CorrectionsRequest = {
        edits: [
          {
            id: edit.id,
            classification: edit.classification,
            accountCode: edit.accountCode,
          },
        ],
        saveAsRule,
      };
      const res = await fetch(`/api/analyses/${analysisId}/transactions`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = (await res.json()) as CorrectionsResponse | { ok: false };

      return json.ok;
    } catch {
      return false;
    }
  };

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

    const edit: RuleEdit = {
      id,
      merchant: target.merchant,
      classification,
      accountCode: normalizedAccountCode,
    };

    if (!(await save(edit, false))) {
      setLocalRows(previous);
      setNotice({ kind: "message", text: "저장에 실패했습니다. 다시 시도해 주세요." });
      return;
    }

    setNotice({
      kind: "rule-offer",
      text: `'${target.merchant}' → ${CLASSIFICATION_LABEL[classification]}로 저장했습니다.`,
      edit,
    });
  };

  const handleSaveRule = async (edit: RuleEdit) => {
    const ok = await save(edit, true);

    setNotice({
      kind: "message",
      text: ok
        ? `'${edit.merchant}'는 앞으로 ${CLASSIFICATION_LABEL[edit.classification]}로 자동 분류됩니다`
        : "규칙 저장에 실패했습니다. 다시 시도해 주세요.",
    });
  };

  if (localRows.length === 0) {
    return <p className="text-sm text-muted">{emptyMessage}</p>;
  }

  const groups = groupByAccountCode ? groupRows(localRows) : [{ code: null, rows: localRows, total: null }];

  return (
    <div className="flex flex-col gap-2">
      {/* 규칙 학습·저장 실패는 화면에만 뜨면 낭독기 사용자에게 전달되지 않는다.
          role="status"는 진행 중인 작업을 끊지 않고 알린다. */}
      <div
        role="status"
        aria-live="polite"
        className={
          notice
            ? "flex flex-wrap items-center gap-3 rounded-md bg-surface-strong px-4 py-2 text-sm text-ink"
            : "sr-only"
        }
      >
        {notice && <span>{notice.text}</span>}
        {notice?.kind === "rule-offer" && (
          <>
            <button
              type="button"
              onClick={() => void handleSaveRule(notice.edit)}
              className="rounded-full border border-muted-soft px-3 py-1 text-xs font-medium text-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              앞으로도 이렇게 분류
            </button>
            <button
              type="button"
              onClick={() => setNotice(null)}
              className="text-xs text-muted underline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary"
            >
              닫기
            </button>
          </>
        )}
      </div>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-hairline text-left text-muted">
            <th scope="col" className="px-3 py-2 font-medium">
              날짜
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              가맹점
            </th>
            <th scope="col" className="px-3 py-2 text-right font-medium">
              금액
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              분류
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              계정과목
            </th>
            {/* 값이 우측 정렬된 숫자라 헤더도 맞춘다. 어긋나면 열이 깨져 보인다. */}
            <th scope="col" className="px-3 py-2 text-right font-medium">
              확신도
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              출처
            </th>
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
          <th
            scope="rowgroup"
            colSpan={2}
            className="px-3 py-1.5 text-left text-xs font-medium text-muted"
          >
            {ACCOUNT_CODE_LABEL[group.code]}
          </th>
          {/* 소계는 금액 열(3번째) 아래에 둔다. 표 끝으로 밀면 어느 열의 합계인지
              읽히지 않는다. */}
          <td className="px-3 py-1.5 text-right font-mono text-xs font-medium tabular-nums text-muted">
            {group.total.toLocaleString("ko-KR")}원
          </td>
          <td colSpan={4} />
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
        {/* 열 헤더만으로는 낭독기가 어느 거래의 셀렉트인지 알 수 없다.
            테두리는 컴포넌트를 식별하는 요소라 3:1을 지키는 muted-soft를 쓴다. */}
        <select
          aria-label={`${tx.merchant} 분류`}
          value={tx.classification ?? ""}
          onChange={(e) =>
            onChange(tx.id, e.target.value as Classification, tx.accountCode)
          }
          className={CONTROL_CLASS}
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
          aria-label={`${tx.merchant} 계정과목`}
          value={tx.accountCode ?? ""}
          disabled={tx.classification !== "business"}
          onChange={(e) =>
            onChange(
              tx.id,
              tx.classification ?? "business",
              (e.target.value || null) as AccountCode | null,
            )
          }
          className={`${CONTROL_CLASS} disabled:cursor-not-allowed disabled:opacity-50`}
        >
          <option value="">-</option>
          {ACCOUNT_CODES.map((code) => (
            <option key={code} value={code}>
              {ACCOUNT_CODE_LABEL[code]}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 text-right font-mono tabular-nums text-muted">
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
