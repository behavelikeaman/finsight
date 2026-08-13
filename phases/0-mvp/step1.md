# Step 1: core-types

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` — 특히 "데이터 모델"과 "API 계약" 절
- `/docs/PRD.md` — 요금제와 쿼터 정책
- `/tsconfig.json`, `/src/lib/env.ts` (step0 산출물)

## 작업

`src/types/` 아래에 도메인 타입과 **API 계약 타입 전체**를 정의한다.

이 step이 중요한 이유: 이후 모든 step은 **독립된 세션**에서 실행된다. step13(랜딩)은 step8(analyze-api)이 무엇을 반환하는지 알 방법이 없다. 여기서 정의한 타입이 step 간 유일한 계약이다. 하나라도 빠지면 이후 세션들이 서로 다른 형태를 지어낸다.

`src/types/`는 TDD 가드 면제 대상이라 테스트 없이 작성할 수 있다.

### `src/types/domain.ts`

```ts
export type SourceKind = 'csv' | 'xlsx'
export type Tier = 'free' | 'pro'

// 파일에서 추출한 원시 표. 헤더와 문자열 행.
export interface RawTable { headers: string[]; rows: string[][] }

// 사용자가 확정한 컬럼 매핑. 값은 headers의 원소.
export interface ColumnMapping { date: string | null; merchant: string | null; amount: string | null }

// 서버로 전송되는 유일한 거래 표현.
export interface NormalizedRow {
  occurredOn: string   // 'YYYY-MM-DD'
  merchant: string
  amountKrw: number    // 정수(원). 음수는 환불/취소
}

// 분류 결과. 'review'는 확신도가 낮아 사람 확인이 필요한 건.
export type Classification = 'business' | 'personal' | 'review'

// 사업경비의 계정과목. 이 목록을 늘리지 마라 — 프롬프트·UI·DB가 함께 묶여 있다.
export type AccountCode =
  | 'entertainment'    // 접대비
  | 'travel'           // 여비교통비
  | 'supplies'         // 소모품비
  | 'communication'    // 통신비
  | 'advertising'      // 광고선전비
  | 'fees'             // 지급수수료
  | 'welfare'          // 복리후생비
  | 'vehicle'          // 차량유지비
  | 'books'            // 도서인쇄비
  | 'education'        // 교육훈련비
  | 'rent'             // 임차료
  | 'other'            // 기타
```

`amountKrw`에 소수를 허용하지 마라. 이유: 통화를 부동소수점으로 다루면 합계에 오차가 쌓인다.

`AccountCode`는 `classification === 'business'`일 때만 의미가 있다. 개인지출·확인필요 건에는 `null`이다.

### `src/types/analysis.ts`

```ts
export interface MerchantTotal { merchant: string; amountKrw: number }

// step8이 반환하는 집계. LLM이 관여하지 않은, 코드가 계산한 값만 들어간다.
export interface AnalysisSummary {
  totalKrw: number
  rowCount: number
  periods: PeriodTotal[]        // 'YYYY-MM' 오름차순
  topMerchants: MerchantTotal[]
}

export interface PeriodTotal { period: string; totalKrw: number }

// 분류가 끝난 거래 1건.
export interface ClassifiedTransaction {
  id: string
  occurredOn: string
  merchant: string
  amountKrw: number
  classification: Classification | null   // null = 아직 분류 전
  accountCode: AccountCode | null
  confidence: number | null               // 0~1
  isUserEdited: boolean
  fromRule: boolean                       // 규칙이 결정했는가 (AI가 아니라)
}

// 분류 결과를 화면 단위로 묶은 것.
export interface ClassifiedView {
  review: ClassifiedTransaction[]         // confidence 낮은 건. 항상 상단에
  business: ClassifiedTransaction[]
  personal: ClassifiedTransaction[]
  unclassified: ClassifiedTransaction[]   // 표본 모드에서 남은 건
  businessTotalKrw: number
  personalTotalKrw: number
}
```

`confidence`가 `CONFIDENCE_THRESHOLD`(별도 상수, 0.7) 미만이면 `classification`을 `'review'`로 둔다. 임계값을 여러 파일에 복제하지 마라 — `src/types/tier.ts`에 함께 상수로 둔다.

### `src/types/tier.ts`

요금제 숫자의 **단일 출처**다. PRD의 요금제 표와 일치시킨다.

```ts
export const CONFIDENCE_THRESHOLD = 0.7
export const MAX_ROWS = 10_000
export const SAMPLE_SIZE = 20

export const QUOTA: Record<Tier, { classifyPerMonth: number; chatPerMonth: number }> = {
  free: { classifyPerMonth: 1,  chatPerMonth: 0   },
  pro:  { classifyPerMonth: 10, chatPerMonth: 100 },
}
```

이 숫자를 다른 파일에 하드코딩하지 마라. 이유: 랜딩의 요금제 표(step13)와 서버 쿼터 검사(step9)가 어긋나면 사용자가 결제하고도 막힌다.

### `src/types/api.ts`

`docs/ARCHITECTURE.md`의 API 계약 표를 그대로 타입으로 옮긴다.

```ts
export interface AnalyzeRequest {
  rows: NormalizedRow[]
  cardLabel?: string
  sourceKind: SourceKind
}

export type AnalyzeResponse =
  | { ok: true; analysisId: string; summary: AnalysisSummary }
  | { ok: false; reason: 'duplicate'; existingId: string }

export type ClassifyMode = 'sample' | 'full'
export interface ClassifyRequest { mode: ClassifyMode }

export type ClassifyResponse =
  | { ok: true; classified: number; fromRules: number; fromAi: number; quotaLeft: number }
  | { ok: false; reason: 'quota_exceeded' | 'sample_used' | 'anonymous_full_denied' }

export interface TransactionEdit {
  id: string
  classification: Classification
  accountCode: AccountCode | null
}
export interface CorrectionsRequest { edits: TransactionEdit[]; saveAsRule: boolean }
export interface CorrectionsResponse { ok: true; ruleIds: string[] }

export interface ChatRequest { question: string }
export type ChatResponse =
  | { ok: true; answer: string; quotaLeft: number }
  | { ok: false; reason: 'quota_exceeded' | 'tier_required' }

export interface BillingSyncResponse { tier: Tier; currentPeriodEnd: string | null }
export interface CheckoutRequest { plan: 'pro' }
export interface CheckoutResponse { url: string }
export interface OkResponse { ok: true }
```

모든 응답 유니온에 `ok` 같은 **판별자**를 반드시 둔다. 이유: 판별자 없는 유니온은 소비하는 쪽에서 타입 좁히기가 지저분해지고 세션마다 다르게 처리한다.

게이팅 실패 응답(`ok: false`)에 분류 결과나 답변 본문 필드를 넣지 마라. 이유: 타입에 존재하면 언젠가 서버가 채워 보낸다.

### `src/types/db.ts`

`profiles` `analyses` `transactions` `user_rules` `usage_counters` 5개 테이블의 행 타입. `docs/ARCHITECTURE.md`의 데이터 모델과 컬럼명·타입을 일치시킨다. `amount_krw`는 `number`(정수), 날짜는 ISO 문자열.

### `src/types/index.ts`

위 모듈들을 re-export 한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx tsc --noEmit
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `docs/ARCHITECTURE.md`의 API 계약 표 9개 엔드포인트가 전부 타입으로 존재하는가?
   - `AnalyzeResponse`·`ClassifyResponse`·`ChatResponse`에 `ok` 판별자가 있는가?
   - 게이팅 실패 응답에 본문 필드가 없는가?
   - 요금제 숫자가 `src/types/tier.ts` 한 곳에만 있는가?
   - 런타임 코드(함수 구현)를 넣지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 생성한 파일 경로와 핵심 타입 이름을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 런타임 로직을 넣지 마라. 이유: `src/types/`는 타입 전용이며, 로직을 넣으면 TDD 가드를 우회하는 통로가 된다. (`tier.ts`의 상수는 예외 — 값이지 로직이 아니다)
- 게이팅 실패 응답에 분류 결과·답변 필드를 넣지 마라. 이유: 타입에 존재하면 언젠가 서버가 채워 보낸다.
- `AccountCode` 목록을 늘리거나 줄이지 마라. 이유: 프롬프트(step10)·UI(step15)·DB 제약(step6)이 이 목록에 묶인다.
- `any`를 쓰지 마라. 이유: 이 파일들이 step 간 계약이라 `any` 하나가 이후 전 세션의 타입 검사를 무력화한다.
- API 계약을 임의로 바꾸지 마라. 이유: `docs/ARCHITECTURE.md`가 기준이며, 다르면 이후 step들이 맞지 않는 구현을 한다.
- 기존 테스트를 깨뜨리지 마라.
