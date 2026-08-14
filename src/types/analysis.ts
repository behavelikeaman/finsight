/**
 * 집계·분류 결과 타입.
 *
 * 여기 들어오는 금액은 전부 코드가 계산한 값이다. LLM은 거래별 분류 판단만
 * 하고 합계·평균을 계산하지 않는다.
 */
import type { AccountCode, Classification } from "./domain";

export interface MerchantTotal {
  merchant: string;
  amountKrw: number;
}

export interface PeriodTotal {
  /** 'YYYY-MM' */
  period: string;
  totalKrw: number;
}

/** POST /api/analyze 가 반환하는 집계. LLM이 관여하지 않는다. */
export interface AnalysisSummary {
  totalKrw: number;
  rowCount: number;
  /** 'YYYY-MM' 오름차순 */
  periods: PeriodTotal[];
  topMerchants: MerchantTotal[];
}

/** 분류가 끝난 거래 1건. */
export interface ClassifiedTransaction {
  id: string;
  /** 'YYYY-MM-DD' */
  occurredOn: string;
  merchant: string;
  amountKrw: number;
  /** null = 아직 분류 전 */
  classification: Classification | null;
  accountCode: AccountCode | null;
  /** 0~1. CONFIDENCE_THRESHOLD 미만이면 classification은 'review' */
  confidence: number | null;
  isUserEdited: boolean;
  /** 규칙이 결정했는가 (AI가 아니라) */
  fromRule: boolean;
}

/** 분류 결과를 화면 단위로 묶은 것. */
export interface ClassifiedView {
  /** 확신도 낮은 건. 항상 상단에 */
  review: ClassifiedTransaction[];
  business: ClassifiedTransaction[];
  personal: ClassifiedTransaction[];
  /** 표본 모드에서 남은 건 */
  unclassified: ClassifiedTransaction[];
  businessTotalKrw: number;
  personalTotalKrw: number;
}
