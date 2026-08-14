/**
 * 도메인 타입.
 *
 * 이후 모든 step이 공유하는 계약이므로, 런타임 로직을 넣지 않는다.
 */

export type SourceKind = "csv" | "xlsx";
export type Tier = "free" | "pro";

/** 파일에서 추출한 원시 표. 헤더와 문자열 행. */
export interface RawTable {
  headers: string[];
  rows: string[][];
}

/** 사용자가 확정한 컬럼 매핑. 값은 headers의 원소. */
export interface ColumnMapping {
  date: string | null;
  merchant: string | null;
  amount: string | null;
}

/**
 * 서버로 전송되는 유일한 거래 표현. 업로드 시점이라 아직 id가 없다.
 *
 * amountKrw는 정수(원)다. 통화에 부동소수점을 쓰면 합계에 오차가 쌓인다.
 */
export interface NormalizedRow {
  /** 'YYYY-MM-DD' */
  occurredOn: string;
  merchant: string;
  /** 정수(원). 음수는 환불/취소 */
  amountKrw: number;
}

/** 저장된 뒤의 거래. 분류 파이프라인은 전부 이 타입으로 흐른다. */
export interface IdentifiedRow extends NormalizedRow {
  id: string;
}

/**
 * 마스킹을 통과한 거래. 브랜디드 타입이라 캐스팅 없이는 만들 수 없다.
 * src/lib/redact.ts 만이 이 타입을 만든다 — 마스킹을 건너뛴 값이 외부로
 * 나가는 경로가 컴파일 단계에서 막힌다.
 */
declare const redactedBrand: unique symbol;
export type RedactedRow = IdentifiedRow & { readonly [redactedBrand]: true };

/** 분류 결과. 'review'는 확신도가 낮아 사람 확인이 필요한 건. */
export type Classification = "business" | "personal" | "review";

/**
 * 사업경비의 계정과목. classification === 'business'일 때만 의미가 있다.
 * 이 목록을 늘리지 마라 — 프롬프트·UI·DB 제약이 함께 묶여 있다.
 */
export type AccountCode =
  | "entertainment" // 접대비
  | "travel" // 여비교통비
  | "supplies" // 소모품비
  | "communication" // 통신비
  | "advertising" // 광고선전비
  | "fees" // 지급수수료
  | "welfare" // 복리후생비
  | "vehicle" // 차량유지비
  | "books" // 도서인쇄비
  | "education" // 교육훈련비
  | "rent" // 임차료
  | "other"; // 기타
