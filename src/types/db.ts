/**
 * DB 행 타입. docs/ARCHITECTURE.md 의 데이터 모델과 컬럼명을 일치시킨다.
 *
 * 컬럼명은 DB와 같은 snake_case로 둔다. 금액은 정수(원), 날짜·시각은 ISO
 * 문자열이다. 카드번호는 어떤 컬럼에도 없다.
 */
import type {
  AccountCode,
  Classification,
  SourceKind,
  Tier,
} from "./domain";

/**
 * auth.users INSERT 트리거로 자동 생성된다(tier='free').
 * tier · current_period_end · sample_used · polar_* · subscription_status 는
 * 사용자가 쓸 수 없다.
 */
export interface ProfileRow {
  /** auth.users.id */
  id: string;
  tier: Tier;
  /** 익명 표본 분류를 uid당 1회로 제한하는 플래그 */
  sample_used: boolean;
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  /** ISO 8601 */
  current_period_end: string | null;
  /**
   * Polar status 원문(active·past_due·canceled 등). 안내 문구를 정하는 데만
   * 쓴다. 권리 판정은 effective_tier() 한 곳에서만 한다.
   */
  subscription_status: string | null;
  /**
   * 이메일 수신 동의. 기본 false(명시적 opt-in).
   *
   * 사용자가 직접 UPDATE할 수 없다 — 쓰기는 set_email_opt_in() RPC로만 한다.
   * 권리 판정(tier·쿼터·게이팅)에 절대 끌어들이지 마라.
   */
  email_opt_in: boolean;
}

export interface AnalysisRow {
  id: string;
  owner_id: string;
  card_label: string | null;
  /** sha256(정렬된 "occurred_on|merchant|amount_krw" 전체 행) */
  fingerprint: string;
  source_kind: SourceKind;
  row_count: number;
  /** ISO 8601. null = 아직 분류 전 */
  classified_at: string | null;
  /** ISO 8601 */
  created_at: string;
}

export interface TransactionRow {
  id: string;
  analysis_id: string;
  owner_id: string;
  /** 'YYYY-MM-DD' */
  occurred_on: string;
  merchant: string;
  /** 정수(원) */
  amount_krw: number;
  /** null = 아직 분류 전 */
  classification: Classification | null;
  account_code: AccountCode | null;
  /** 0~1 */
  confidence: number | null;
  is_user_edited: boolean;
  /** 규칙으로 분류된 건의 user_rules.id */
  rule_id: string | null;
}

export interface UserRuleRow {
  id: string;
  owner_id: string;
  merchant_pattern: string;
  classification: Classification;
  account_code: AccountCode | null;
  /** ISO 8601 */
  created_at: string;
}

/** 사용자에게는 SELECT만 허용한다. 갱신은 increment_usage() 로만. */
export interface UsageCounterRow {
  owner_id: string;
  /** 'YYYY-MM' */
  period: string;
  classify_used: number;
  chat_used: number;
}
