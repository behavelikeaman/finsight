# Step 1: core-types

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/docs/PRD.md`
- `/src/` 전체 골격 (step 0에서 생성)
- `/tsconfig.json`

## 작업

`src/types/`에 프로젝트 전역 타입을 정의한다. 이 step은 **타입 정의만** 한다. 구현체나 함수는 만들지 않는다.

### `src/types/transaction.ts`

정규화된 거래 1건. 카드사 포맷 차이가 모두 흡수된 뒤의 형태다.

```ts
export interface Transaction {
  id: string;            // 클라이언트 생성 UUID (DB 저장 전에도 표 렌더링에 필요)
  date: string;          // ISO 8601 date (YYYY-MM-DD)
  merchant: string;      // 가맹점명
  amount: number;        // 원 단위 정수. 승인취소는 음수
  rawRow: string[];      // 원본 CSV 행. 파싱 검증·디버깅용
}
```

`amount`를 정수 원 단위로 두는 이유: 부동소수점 누적 오차가 금액 합계에 나타나면 안 된다. 파싱 단계에서 콤마·통화기호를 제거하고 정수로 변환한다.

### `src/types/classification.ts`

```ts
export type ClassificationLabel = "business" | "personal" | "uncertain";

export interface Classification {
  transactionId: string;
  label: ClassificationLabel;
  accountCode: string | null;   // 계정과목. label이 "business"일 때만 채운다
  confidence: number;           // 0..1
  reason: string;               // 한 문장. 사용자에게 노출된다
  source: "ai" | "rule";        // 규칙 선적용으로 분류된 건은 "rule"
}
```

`source`가 필요한 이유: 규칙으로 분류된 건은 AI를 거치지 않았으므로 확신도의 의미가 다르고, UI에서 구분 표시해야 한다.

### `src/types/column-mapping.ts`

카드사 CSV의 컬럼 위치를 우리 스키마로 잇는 매핑. 카드사 지문별로 저장·재사용된다 (ADR-003).

```ts
export interface ColumnMapping {
  fingerprint: string;     // 헤더 행 기반 해시. 조회 키
  issuerLabel: string;     // 사람이 읽는 라벨 (예: "신한카드 이용내역")
  headerRowIndex: number;  // 헤더가 몇 번째 행인지 (0-based)
  dateColumn: number;
  merchantColumn: number;
  amountColumn: number;
  encoding: "utf-8" | "cp949";
  dateFormat: string;      // 예: "YYYY.MM.DD", "YYYY-MM-DD"
}
```

### `src/types/user-rule.ts`

사용자가 분류를 수정했을 때 저장되는 규칙 (ADR-008).

```ts
export type RuleMatchType = "merchant_exact" | "merchant_contains";

export interface UserRule {
  id: string;
  userId: string;
  matchType: RuleMatchType;
  pattern: string;
  label: ClassificationLabel;
  accountCode: string | null;
  createdAt: string;
}
```

정규식 매칭 타입은 만들지 마라. 이유: 사용자가 작성한 정규식은 ReDoS 위험이 있고, MVP에서 필요하지 않다.

### `src/types/tier.ts`

```ts
export type Tier = "anonymous" | "free" | "paid";

export interface QuotaLimits {
  analysesPerMonth: number;
  chatMessagesPerMonth: number;
  maxTransactionsPerUpload: number;
}

export const TIER_LIMITS: Record<Tier, QuotaLimits>;
```

`TIER_LIMITS` 실제 값 (ADR-009, ADR-012):
- `anonymous`: 분석 1회(월 아닌 총 1회로 취급), 채팅 0, 업로드 100건
- `free`: 분석 1, 채팅 0, 업로드 2000건
- `paid`: 분석 10, 채팅 100, 업로드 2000건

### `src/types/index.ts`

위 모듈들을 re-export 한다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 기존 테스트 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 타입이 `src/types/`에 있는가? (ARCHITECTURE.md 디렉터리 구조)
   - ADR 기술 스택을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 함수나 클래스를 구현하지 마라. 이 step은 타입 정의만 다룬다. 이유: 구현이 섞이면 이후 step의 scope가 흐려진다.
- `any`를 쓰지 마라. 불가피하면 `unknown`을 쓰고 좁혀라.
- 금액을 `number`가 아닌 `string`이나 부동소수점 실수로 표현하지 마라. 이유: 합계 계산에서 오차가 발생한다.
- 정규식 기반 규칙 매칭 타입을 추가하지 마라. 이유: 사용자 입력 정규식은 ReDoS 위험이 있다.
- 기존 테스트를 깨뜨리지 마라
