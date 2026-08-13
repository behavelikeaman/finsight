# Step 3: column-mapping

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md`
- `/src/types/domain.ts` (step1 — `RawTable`, `ColumnMapping`, `NormalizedRow`)
- `/src/lib/ingest/index.ts` 와 `/src/lib/ingest/__fixtures__/` (step2 산출물 — 입력이 되는 `RawTable`의 실제 형태를 확인하라)

## 작업

`src/lib/mapping/`에 **`RawTable` → `NormalizedRow[]`** 변환을 구현한다. 순수 함수이며 브라우저·서버 양쪽에서 동일하게 실행된다.

### 공개 인터페이스 (`src/lib/mapping/index.ts`)

```ts
export function guessMapping(headers: string[]): ColumnMapping

export interface MappingIssue { kind: 'missing' | 'unparsable'; field: 'date'|'merchant'|'amount'; detail: string }
export function validateMapping(table: RawTable, mapping: ColumnMapping): MappingIssue[]

export interface NormalizeResult { rows: NormalizedRow[]; skipped: number }
export function normalizeRows(table: RawTable, mapping: ColumnMapping): NormalizeResult
```

### 1. 헤더 추측 (`heuristics.ts`)

한국 카드사 별칭 사전 + 범용 영문 헤더를 함께 본다. 대소문자·공백·괄호를 제거해 정규화한 뒤 비교한다.

- **날짜**: 이용일, 이용일자, 거래일, 거래일자, 승인일, 승인일자, 매출일자, date, transaction date, 결제일
- **가맹점**: 가맹점, 가맹점명, 이용하신곳, 이용가맹점, 상호, 내용, 적요, merchant, description
- **금액**: 이용금액, 승인금액, 결제금액, 청구금액, 거래금액, 금액, amount, 원화금액, 국내이용금액

우선순위 규칙:
- 금액 후보가 여러 개면 **원화/청구 계열을 우선**한다. 이유: 해외 결제 명세서는 외화 금액 컬럼이 함께 있는데 그걸 고르면 값이 틀린다.
- 별칭에 걸리는 헤더가 없으면 값 패턴으로 추론한다(날짜형 값이 많은 컬럼 → 날짜, 숫자형 → 금액).

**카드번호 컬럼은 어떤 필드에도 매핑하지 않는다.** 카드번호, 카드번호뒷자리, card no 등은 후보에서 제외한다. 이유: 저장하지 않기로 한 데이터가 매핑 후보에 뜨면 사용자가 실수로 고를 수 있다.

### 2. 값 정규화 (`normalize.ts`)

```ts
export function parseAmountKrw(raw: string): number | null
export function parseDate(raw: string, fallbackYear?: number): string | null   // 'YYYY-MM-DD'
```

**금액** — 다음을 전부 정수(원)로 변환한다:
`1,234` · `₩1,234` · `1234원` · `-1,234` · `(1,234)`(괄호는 음수) · `1,234.00`(소수부 0이면 버림)

`parseFloat`을 쓰지 마라. 이유: 통화를 부동소수점으로 다루면 합계에 오차가 쌓인다. 문자열에서 숫자만 추출해 정수로 만든다. 소수부가 0이 아니면 반올림하되, 원 단위 정수를 반환한다.

**날짜** — 다음 포맷을 처리한다:
`2026.08.10` · `2026-08-10` · `2026/08/10` · `20260810` · `08/10`(연도 없음) · `2026년 8월 10일`

연도가 없으면 `fallbackYear`(파일 내 최빈 연도)를 쓴다.

### 3. 검증 (`validateMapping`)

- 세 필드 중 하나라도 `null`이면 `kind:'missing'` 이슈
- 상위 20행을 샘플링해 파싱 실패율이 50%를 넘는 필드는 `kind:'unparsable'` 이슈. 이유: 사용자가 금액에 카드번호를 매핑하는 실수를 잡아야 한다

### 4. 정규화 (`normalizeRows`)

행 단위로 파싱한다. 세 값 중 하나라도 파싱에 실패한 행은 **건너뛰고 `skipped`에 센다.** 전체를 실패시키지 마라. 이유: 명세서 한 줄이 이상하다고 분석 전체를 버리면 사용자는 아무것도 얻지 못한다.

할부·해외 결제에 전용 코드를 쓰지 마라. 원화 청구액 컬럼을 쓰면 그대로 맞다.

### 테스트

step2의 픽스처를 재사용해 실제 `RawTable`로 검증한다. 별칭 사전 적중, 원화 우선 선택, 카드번호 제외, 금액·날짜 포맷 전종, 파싱 실패 행 skip, 검증 이슈 검출을 각각 테스트한다.

`normalizeRows`가 반환하는 `NormalizedRow`에는 **날짜·가맹점·금액 세 필드만** 있어야 한다. 원본 행의 다른 값(카드번호, 승인번호, 할부개월)을 실어 보내지 마라. 이유: 이 배열이 그대로 서버로 가고, 서버에 도달한 값은 언젠가 저장된다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/mapping
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "parseFloat" src/lib/mapping/` 결과가 비어 있는가?
   - 금액 후보가 여럿일 때 원화 계열을 고르는 테스트가 있는가?
   - 카드번호 헤더가 매핑 후보에서 제외되는 테스트가 있는가?
   - I/O나 외부 호출이 없는 순수 함수인가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 공개 함수와 별칭 사전 위치를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- `parseFloat`이나 부동소수점 연산을 쓰지 마라. 이유: 통화 계산에 오차가 쌓인다.
- 카드번호 컬럼을 매핑 후보에 넣지 마라. 이유: 저장하지 않기로 한 데이터이며, 후보에 뜨면 사용자가 실수로 고른다.
- 파싱 실패 행 하나 때문에 전체를 실패시키지 마라. 이유: 사용자가 아무 결과도 못 얻는다.
- 할부·해외결제 전용 분기를 만들지 마라. 이유: 원화 청구액 컬럼을 쓰면 자동으로 맞고, 분기는 MVP 범위 밖이다.
- 집계나 경비 분류를 여기서 하지 마라. 이유: 집계는 step4, 분류는 step10·11의 범위다.
- 기존 테스트를 깨뜨리지 마라.
