# Step 1: core-types

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` — 특히 "데이터 모델"과 "API 계약" 절
- `/docs/PRD.md` — 요금제와 잠금 정책
- `/tsconfig.json`, `/src/lib/env.ts` (step0 산출물)

## 작업

`src/types/` 아래에 도메인 타입과 **API 계약 타입 전체**를 정의한다.

이 step이 중요한 이유: 이후 모든 step은 **독립된 세션**에서 실행된다. step9(랜딩)는 step7(analyze-api)이 무엇을 반환하는지 알 방법이 없다. 여기서 정의한 타입이 step 간 유일한 계약이다. 하나라도 빠지면 이후 세션들이 서로 다른 형태를 지어낸다.

`src/types/`는 TDD 가드 면제 대상이라 테스트 없이 작성할 수 있다.

### `src/types/domain.ts`

```ts
export type SourceKind = 'csv' | 'xlsx'
export type Plan = 'free' | 'pro'

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

export type Category =
  | 'food' | 'cafe' | 'transport' | 'shopping' | 'subscription'
  | 'medical' | 'living' | 'culture' | 'travel' | 'etc'
```

`amountKrw`에 소수를 허용하지 마라. 이유: 통화를 부동소수점으로 다루면 합계에 오차가 쌓인다.

### `src/types/analysis.ts`

```ts
export interface MerchantTotal { merchant: string; amountKrw: number }

export interface PeriodSummary {
  locked: false
  period: string                              // 'YYYY-MM'
  totalKrw: number
  byCategory: Record<Category, number>
  topMerchants: MerchantTotal[]
  etcRatio: number                            // 0~1. 0.4 초과 시 UI가 안내한다
}

// 잠긴 기간. 금액과 인사이트 본문을 절대 포함하지 않는다.
export interface LockedPeriod { locked: true; period: string; teaser: string }

export type PeriodView = PeriodSummary | LockedPeriod
```

`locked`를 판별자로 쓴다. 잠금 여부를 별도 boolean 필드로 두지 마라. 이유: 판별 유니온이라야 타입 좁히기로 금액 접근이 컴파일 단계에서 막힌다.

### `src/types/api.ts`

§ARCHITECTURE.md의 API 계약 표를 그대로 타입으로 옮긴다.

```ts
export interface AnalyzeRequest {
  rows: NormalizedRow[]
  cardLabel?: string
  sourceKind: SourceKind
}

export type AnalyzeResponse =
  | { ok: true; analysisId: string; periods: PeriodView[] }
  | { ok: false; reason: 'duplicate'; existingId: string; period: string; locked: boolean }

export type InsightKind = 'basic' | 'deep'
export type InsightStatus = 'ready' | 'failed'

export interface InsightResponse {
  status: InsightStatus
  kind: InsightKind
  content?: InsightContent
  error?: string
}

export interface InsightContent {
  headline: string
  findings: { title: string; detail: string }[]
  suggestions: string[]
}

export interface BillingSyncResponse { plan: Plan; currentPeriodEnd: string | null }
export interface CheckoutRequest { plan: 'pro' }
export interface CheckoutResponse { url: string }
export interface OkResponse { ok: true }
```

모든 응답 유니온에 `ok` 또는 `status` 같은 **판별자**를 반드시 둔다. 이유: 판별자 없는 유니온은 소비하는 쪽에서 타입 좁히기가 지저분해지고 세션마다 다르게 처리한다.

### `src/types/db.ts`

`profiles` `analyses` `transactions` `insights` 4개 테이블의 행 타입. `docs/ARCHITECTURE.md`의 데이터 모델과 컬럼명·타입을 일치시킨다. `amount_krw`는 `number`(정수), 날짜는 ISO 문자열.

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
   - `docs/ARCHITECTURE.md`의 API 계약 표 7개 엔드포인트가 전부 타입으로 존재하는가?
   - `AnalyzeResponse`에 `ok` 판별자가 있는가?
   - `LockedPeriod`에 금액 필드가 없는가?
   - 런타임 코드(함수 구현)를 넣지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 1을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 생성한 파일 경로와 핵심 타입 이름을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 런타임 로직을 넣지 마라. 이유: `src/types/`는 타입 전용이며, 로직을 넣으면 TDD 가드를 우회하는 통로가 된다.
- `LockedPeriod`에 금액·인사이트 본문 필드를 넣지 마라. 이유: 타입에 존재하면 언젠가 서버가 채워 보낸다.
- `any`를 쓰지 마라. 이유: 이 파일들이 step 간 계약이라 `any` 하나가 이후 전 세션의 타입 검사를 무력화한다.
- API 계약을 임의로 바꾸지 마라. 이유: `docs/ARCHITECTURE.md`가 기준이며, 다르면 이후 step들이 맞지 않는 구현을 한다.
- 기존 테스트를 깨뜨리지 마라.
