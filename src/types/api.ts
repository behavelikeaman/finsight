/**
 * API 계약. docs/ARCHITECTURE.md 의 계약 표를 그대로 옮긴 것이다.
 *
 * 모든 응답 유니온에는 `ok` 판별자를 둔다. 판별자가 없으면 소비하는 쪽에서
 * 타입 좁히기가 지저분해지고 세션마다 다르게 처리한다.
 *
 * 게이팅 실패 응답(ok: false)에는 분류 결과·답변 본문 필드를 두지 않는다.
 * 타입에 존재하면 언젠가 서버가 채워 보낸다.
 */
import type { AnalysisSummary } from "./analysis";
import type {
  AccountCode,
  Classification,
  NormalizedRow,
  SourceKind,
  Tier,
} from "./domain";

/** POST /api/analyze */
export interface AnalyzeRequest {
  rows: NormalizedRow[];
  cardLabel?: string;
  sourceKind: SourceKind;
}

export type AnalyzeResponse =
  | { ok: true; analysisId: string; summary: AnalysisSummary }
  | { ok: false; reason: "duplicate"; existingId: string };

/** POST /api/analyses/:id/classify */
export type ClassifyMode = "sample" | "full";

export interface ClassifyRequest {
  mode: ClassifyMode;
}

export type ClassifyResponse =
  | {
      ok: true;
      classified: number;
      fromRules: number;
      fromAi: number;
      quotaLeft: number;
    }
  | {
      ok: false;
      reason: "quota_exceeded" | "sample_used" | "anonymous_full_denied";
    };

/** PATCH /api/analyses/:id/transactions */
export interface TransactionEdit {
  id: string;
  classification: Classification;
  accountCode: AccountCode | null;
}

export interface CorrectionsRequest {
  edits: TransactionEdit[];
  saveAsRule: boolean;
}

export interface CorrectionsResponse {
  ok: true;
  ruleIds: string[];
}

/** POST /api/analyses/:id/chat */
export interface ChatRequest {
  question: string;
}

export type ChatResponse =
  | { ok: true; answer: string; quotaLeft: number }
  | { ok: false; reason: "quota_exceeded" | "tier_required" };

/** POST /api/billing/sync */
export interface BillingSyncResponse {
  tier: Tier;
  /** ISO 8601. 무료 티어면 null */
  currentPeriodEnd: string | null;
}

/** POST /api/billing/checkout */
export interface CheckoutRequest {
  plan: "pro";
}

export interface CheckoutResponse {
  url: string;
}

/**
 * POST /api/billing/portal
 * 1회용 토큰이 박힌 Polar 고객 포털 URL. 저장하거나 로그에 남기지 마라.
 */
export interface PortalResponse {
  url: string;
}

/** DELETE /api/analyses/:id · DELETE /api/account */
export interface OkResponse {
  ok: true;
}
