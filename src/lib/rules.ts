/**
 * 사용자 규칙 선적용 관문 (ADR-012).
 *
 * 여기 걸린 거래는 AI로 나가지 않는다. I/O가 없는 순수 함수라 브라우저·서버
 * 양쪽에서 같은 코드가 돈다. 규칙 조회는 호출부(classify 라우트)가 하고,
 * 여기에는 배열로 넘긴다.
 */
import type { AccountCode, Classification, IdentifiedRow } from "@/types/domain";
import type { UserRuleRow } from "@/types/db";

export interface RuleMatch {
  row: IdentifiedRow;
  classification: Classification;
  accountCode: AccountCode | null;
  ruleId: string;
}

export interface RuleApplyResult {
  matched: RuleMatch[];
  unmatched: IdentifiedRow[];
}

interface Candidate {
  rule: UserRuleRow;
  pattern: string;
}

/**
 * merchant_pattern을 정규식이 아니라 부분 문자열로 매칭한다. 사용자가 입력한
 * 문자열을 정규식으로 해석하면 '.*' 하나로 전건이 매칭돼 이 관문이 무력화된다.
 *
 * 패턴이 여러 개 걸리면 가장 긴 패턴이 이긴다 — 구체적인 규칙이 사용자의
 * 최근 의도다.
 */
export function applyRules(
  rows: IdentifiedRow[],
  rules: UserRuleRow[],
): RuleApplyResult {
  const candidates: Candidate[] = rules
    .map((rule) => ({ rule, pattern: normalize(rule.merchant_pattern) }))
    .filter((candidate) => candidate.pattern.length > 0);

  const matched: RuleMatch[] = [];
  const unmatched: IdentifiedRow[] = [];

  for (const row of rows) {
    const merchant = normalize(row.merchant);
    const best = pickLongestMatch(candidates, merchant);

    if (best === null) {
      unmatched.push(row);
      continue;
    }

    matched.push({
      row,
      classification: best.rule.classification,
      accountCode: best.rule.account_code,
      ruleId: best.rule.id,
    });
  }

  return { matched, unmatched };
}

function pickLongestMatch(
  candidates: Candidate[],
  merchant: string,
): Candidate | null {
  let best: Candidate | null = null;

  for (const candidate of candidates) {
    if (!merchant.includes(candidate.pattern)) continue;
    if (best === null || candidate.pattern.length > best.pattern.length) {
      best = candidate;
    }
  }

  return best;
}

/**
 * 사용자가 고친 거래에서 재사용 가능한 규칙 패턴을 뽑는다.
 * 지점·번호 꼬리를 뗀다('스타벅스 강남점' → '스타벅스'). 원본이 짧으면(4자
 * 이하) 그대로 쓴다 — 과하게 일반화한 패턴은 무관한 거래까지 잡는다.
 */
export function derivePattern(merchant: string): string {
  const trimmed = merchant.trim().replace(/\s+/g, " ");
  if (trimmed.length <= 4) return trimmed;

  const tokens = trimmed.split(" ");
  if (tokens.length <= 1) return trimmed;

  const last = tokens[tokens.length - 1] ?? "";
  if (!isBranchTail(last)) return trimmed;

  const head = tokens.slice(0, -1).join(" ");
  return head.length > 0 ? head : trimmed;
}

/**
 * 주어진 상호가 규칙 목록에서 몇 건에 걸리는지 센다.
 * 규칙 관리 화면에서 "이 규칙이 실제로 쓰이고 있는지" 보여줄 때 쓴다.
 */
export function countMatchingRules(
  rules: { pattern: string }[],
  merchant: string,
): number {
  const target = merchant.trim().toLowerCase();
  return rules.filter((rule) => target.includes(rule.pattern.toLowerCase()))
    .length;
}

function isBranchTail(token: string): boolean {
  return /점$/.test(token) || /^\d+$/.test(token);
}

function normalize(value: string): string {
  return value.replace(/\s+/g, "").toLowerCase();
}
