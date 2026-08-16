# Step 3: core-lib

`src/lib/`의 순수 함수 레이어 셋을 한 번에 만든다: **컬럼 매핑 · 분석 엔진 · 마스킹**.
세 모듈 모두 I/O가 없고 브라우저·서버 양쪽에서 동일하게 실행된다.

작업 순서는 `A → B → C`다. **A가 끝나고 `npx vitest run src/lib/mapping`이 통과한 뒤에 B로 넘어가라.** 셋을 동시에 벌여놓고 마지막에 한꺼번에 검증하지 마라 — 실패 지점을 좁힐 수 없다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — 데이터 무결성·보안 규칙
- `/docs/ARCHITECTURE.md` — 분석 파이프라인, 데이터 모델의 fingerprint 정의
- `/docs/ADR.md` — ADR-006(브라우저 전처리), ADR-009(민감정보 제거 후 국외 전송), ADR-011(확신도)
- `/src/types/domain.ts` — `RawTable`, `ColumnMapping`, `NormalizedRow`, `IdentifiedRow`, `RedactedRow`(브랜디드 타입 정의를 반드시 확인하라), `Classification`, `AccountCode`
- `/src/types/analysis.ts` — `AnalysisSummary`, `ClassifiedTransaction`, `ClassifiedView`
- `/src/types/tier.ts` — `CONFIDENCE_THRESHOLD`, `SAMPLE_SIZE`
- `/src/lib/ingest/index.ts` 와 `/src/lib/ingest/__fixtures__/` — 이전 step 산출물. 입력이 되는 `RawTable`의 실제 형태와 픽스처 빌더를 확인하라

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

---

# A. 컬럼 매핑 (`src/lib/mapping/`)

**`RawTable` → `NormalizedRow[]`** 변환이다.

### 공개 인터페이스 (`src/lib/mapping/index.ts`)

```ts
export function guessMapping(headers: string[]): ColumnMapping

export interface MappingIssue { kind: 'missing' | 'unparsable'; field: 'date'|'merchant'|'amount'; detail: string }
export function validateMapping(table: RawTable, mapping: ColumnMapping): MappingIssue[]

export interface NormalizeResult { rows: NormalizedRow[]; skipped: number }
export function normalizeRows(table: RawTable, mapping: ColumnMapping): NormalizeResult
```

### A-1. 헤더 추측 (`heuristics.ts`)

한국 카드사 별칭 사전 + 범용 영문 헤더를 함께 본다. 대소문자·공백·괄호를 제거해 정규화한 뒤 비교한다.

- **날짜**: 이용일, 이용일자, 거래일, 거래일자, 승인일, 승인일자, 매출일자, date, transaction date, 결제일
- **가맹점**: 가맹점, 가맹점명, 이용하신곳, 이용가맹점, 상호, 내용, 적요, merchant, description
- **금액**: 이용금액, 승인금액, 결제금액, 청구금액, 거래금액, 금액, amount, 원화금액, 국내이용금액

우선순위 규칙:
- 금액 후보가 여러 개면 **원화/청구 계열을 우선**한다. 이유: 해외 결제 명세서는 외화 금액 컬럼이 함께 있는데 그걸 고르면 값이 틀린다.
- 별칭에 걸리는 헤더가 없으면 값 패턴으로 추론한다(날짜형 값이 많은 컬럼 → 날짜, 숫자형 → 금액).

**카드번호 컬럼은 어떤 필드에도 매핑하지 않는다.** 카드번호, 카드번호뒷자리, card no 등은 후보에서 제외한다. 이유: 저장하지 않기로 한 데이터가 매핑 후보에 뜨면 사용자가 실수로 고를 수 있다.

### A-2. 값 정규화 (`normalize.ts`)

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

### A-3. 검증 (`validateMapping`)

- 세 필드 중 하나라도 `null`이면 `kind:'missing'` 이슈
- 상위 20행을 샘플링해 파싱 실패율이 50%를 넘는 필드는 `kind:'unparsable'` 이슈. 이유: 사용자가 금액에 카드번호를 매핑하는 실수를 잡아야 한다

### A-4. 정규화 (`normalizeRows`)

행 단위로 파싱한다. 세 값 중 하나라도 파싱에 실패한 행은 **건너뛰고 `skipped`에 센다.** 전체를 실패시키지 마라. 이유: 명세서 한 줄이 이상하다고 분석 전체를 버리면 사용자는 아무것도 얻지 못한다.

할부·해외 결제에 전용 코드를 쓰지 마라. 원화 청구액 컬럼을 쓰면 그대로 맞다.

`normalizeRows`가 반환하는 `NormalizedRow`에는 **날짜·가맹점·금액 세 필드만** 있어야 한다. 원본 행의 다른 값(카드번호, 승인번호, 할부개월)을 실어 보내지 마라. 이유: 이 배열이 그대로 서버로 가고, 서버에 도달한 값은 언젠가 저장된다.

### A-5. 테스트

이전 step의 픽스처를 재사용해 실제 `RawTable`로 검증한다. 별칭 사전 적중, 원화 우선 선택, 카드번호 제외, 금액·날짜 포맷 전종, 파싱 실패 행 skip, 검증 이슈 검출을 각각 테스트한다.

**중간 확인**: `npx vitest run src/lib/mapping` 이 통과하면 B로 넘어간다.

---

# B. 분석 엔진 (`src/lib/analysis/`)

집계·중복판정·확신도 버킷팅. **이 프로젝트의 모든 금액 계산은 여기서만 일어난다.**

**여기서 경비 분류를 하지 않는다.** 사업경비/개인지출 판단은 AI가 한다(step5의 범위). 이 모듈은 숫자를 다루는 층이다.

### 공개 인터페이스 (`src/lib/analysis/index.ts`)

```ts
export function summarize(rows: NormalizedRow[]): AnalysisSummary
export function computeFingerprint(rows: NormalizedRow[]): string
export function bucketByClassification(txs: ClassifiedTransaction[]): ClassifiedView
export function pickSample(rows: IdentifiedRow[], size: number): IdentifiedRow[]
```

**입력 타입이 함수마다 다른 것은 의도된 것이다.** `summarize`·`computeFingerprint`는 업로드 시점(id 없음)에 돌고, `pickSample`은 저장 후 분류 파이프라인(id 있음)에서 돈다. `bucketByClassification`은 분류가 끝난 화면용이다. 편의를 위해 하나로 합치지 마라 — id 없는 값이 분류 경로로 흘러들면 결과를 어느 행에 쓸지 알 수 없게 된다.

### B-1. 집계 (`summarize.ts`)

- `totalKrw` — 전체 합. **정수 연산만.** 음수(환불) 행도 그대로 더한다
- `periods` — `occurredOn`의 앞 7자리로 `YYYY-MM` 그룹핑, 오름차순
- `topMerchants` — 가맹점명별 합계 내림차순 상위 10건
- `rowCount` — 행 수

가맹점명은 집계 전에 정규화한다: 앞뒤 공백 제거, 연속 공백 1칸으로, 말미의 지점 표기(`강남점`, `1호점`)는 **제거하지 않는다.** 이유: 지점이 다르면 성격이 다를 수 있고(본사 근처 카페 vs 여행지 카페), 병합하면 되돌릴 수 없다.

부동소수점을 거치지 마라. `reduce`로 정수를 누적한다.

### B-2. fingerprint (`fingerprint.ts`)

```
정렬 키: `${occurredOn}|${merchant}|${amountKrw}` 문자열의 사전순
fingerprint = sha256(정렬된 전체 행을 개행으로 이은 문자열)
```

**정렬 후 해싱하는 이유**: 같은 명세서를 다른 순서로 내려받아도 같은 지문이 나와야 중복이 잡힌다.

`crypto.subtle.digest`를 쓴다(브라우저·Node 양쪽에서 동작). Node의 `crypto` 모듈을 import 하지 마라 — 이 코드는 브라우저에서도 돈다.

### B-3. 확신도 버킷 (`bucket.ts`)

- `confidence`가 `CONFIDENCE_THRESHOLD`(0.7) 미만이면 **`classification` 값과 무관하게 `review` 버킷**에 넣는다
- `classification`이 `null`인 건은 `unclassified` 버킷 (표본 모드에서 분류되지 않고 남은 건)
- `isUserEdited`가 `true`면 사용자가 이미 확정한 것이므로 `confidence`와 무관하게 `review`에 넣지 않는다
- `businessTotalKrw` / `personalTotalKrw`는 각 버킷의 정수 합. **`review`와 `unclassified`는 어느 쪽에도 더하지 않는다**

마지막 규칙이 중요한 이유: 확인이 안 끝난 금액을 경비 합계에 넣으면 사용자가 그 숫자를 신고에 쓴다. 미확정은 미확정으로 보여야 한다.

### B-4. 표본 선택 (`pickSample`)

익명 프리뷰에서 AI로 보낼 거래를 고른다. **금액 절대값 내림차순 상위 `size`건.**

이유: 20건으로 "AI가 제대로 가르는가"를 판단시켜야 하는데, 무작위로 고르면 편의점 결제만 나올 수 있다. 금액이 큰 건이 판단 가치가 높다.

동점이면 `occurredOn`, 그다음 `id` 내림차순으로 안정 정렬한다. 이유: 같은 입력에 같은 표본이 나와야 테스트가 고정되고, 재실행 시 다른 건이 뽑히지 않는다.

반환값은 입력 객체를 그대로 담는다(`id` 포함). 새 객체로 복사하며 `id`를 떨어뜨리지 마라 — 호출부(step5)가 이 `id`로 분류 결과를 저장한다.

### B-5. 테스트

- 음수(환불) 행이 섞인 합계
- 정수 유지 — 소수점이 개입하지 않는지
- 같은 행을 순서만 바꿔 넣었을 때 fingerprint가 동일한가
- 한 행만 금액이 달라도 fingerprint가 달라지는가
- `confidence: 0.6`인 `business` 건이 `review`로 가는가
- `isUserEdited: true`이고 `confidence: 0.5`인 건이 `review`로 가지 **않는가**
- `review`·`unclassified` 금액이 `businessTotalKrw`에 포함되지 **않는가**
- `pickSample`이 금액 상위순이며 같은 입력에 같은 출력인가
- `pickSample` 결과의 각 원소에 `id`가 보존되는가

**중간 확인**: `npx vitest run src/lib/analysis` 가 통과하면 C로 넘어간다.

---

# C. 마스킹 관문 (`src/lib/redact.ts`)

**외부 API로 나가는 모든 데이터가 반드시 통과해야 하는 단일 관문**이다.

### 이 관문이 필요한 이유

컬럼 매핑(A)이 카드번호 컬럼을 후보에서 제외하므로, 정상 경로에서는 카드번호가 여기까지 오지 않는다. 그럼에도 이 모듈을 두는 이유는 **가맹점명 필드 자체에 민감정보가 섞여 들어오기 때문**이다. 실제 명세서에는 `홍길동님 계좌이체`, `국민 123-45-678901 이체` 같은 적요가 가맹점명 자리에 들어온다.

즉 이건 중복 방어가 아니라 **다른 종류의 방어**다.

### 공개 인터페이스

```ts
export interface RedactionResult<T> {
  data: T
  removedCount: number   // 제거된 민감정보 개수. 로깅·감사용
}

export function redactMerchant(raw: string): string
export function redactRows(rows: IdentifiedRow[]): RedactionResult<RedactedRow[]>
```

**이 파일이 `RedactedRow`를 만드는 유일한 곳이다.** 타입 정의가 브랜디드 타입이므로, 여기서 한 번만 캐스팅하고 그 캐스팅을 다른 파일에 복제하지 마라. 이유: `services/anthropic`이 `RedactedRow[]`만 받으므로, 이 관문을 건너뛴 값이 외부로 나가는 경로가 컴파일 단계에서 막힌다. 캐스팅이 여러 곳에 생기면 그 보장이 사라진다.

`id`는 마스킹 대상이 아니다. 그대로 보존한다 — 호출부가 이 `id`로 분류 결과를 되짚는다.

### C-1. 제거 대상

가맹점명 문자열에서 아래 패턴을 마스킹한다. **삭제가 아니라 고정 토큰으로 치환한다.**

| 대상 | 패턴 예 | 치환 |
|---|---|---|
| 카드번호 | `1234-5678-9012-3456`, `1234********3456`, 연속 13~16자리 숫자 | `[CARD]` |
| 계좌번호 | `123-45-678901`, `110-234-567890` (하이픈 포함 8자리 이상 숫자열) | `[ACCT]` |
| 주민등록번호 | `901010-1234567` | `[RRN]` |
| 성명 | `홍길동님`, `홍길동 님` — 한글 2~4자 + `님` | `[NAME]` |
| 전화번호 | `010-1234-5678` | `[PHONE]` |

**삭제하지 않고 토큰으로 치환하는 이유**: 그냥 지우면 `이체`만 남아 문맥이 사라지고 분류 품질이 떨어진다. `[NAME] 이체`는 "개인 간 송금"이라는 판단 근거가 된다.

### C-2. 지켜야 할 것

- `occurredOn`과 `amountKrw`는 **건드리지 마라.** 분류에 필수이고 민감정보가 아니다
- 입력을 변형하지 마라(불변). 새 배열·새 객체를 반환한다
- `removedCount`는 치환이 일어난 **횟수**를 센다. 한 행에서 두 개를 치환했으면 2
- 한글 가맹점명(`스타벅스 강남점`)이 손상되지 않아야 한다. 과잉 마스킹은 분류 품질을 직접 깎는다

### C-3. 과잉 마스킹 주의

`4자리 이상 숫자열`을 전부 마스킹하면 `이마트24`, `GS25`, `배스킨라빈스31` 같은 정상 상호가 깨진다. 숫자 패턴은 **자릿수·구분자 형태를 함께 확인**해서 좁게 잡아라. 테스트로 고정한다.

### C-4. 테스트

- 카드번호 4종(하이픈/공백/별표/무구분) 전부 `[CARD]`로
- `홍길동님 계좌이체` → `[NAME] 계좌이체`
- `스타벅스 강남점` → **변경 없음**
- `이마트24`, `GS25`, `배스킨라빈스31` → **변경 없음**
- `국민 123-45-678901 이체` → `[ACCT]` 치환
- 한 행에 두 패턴 → `removedCount === 2`
- 입력 배열이 변형되지 않았는지 (원본 객체 참조 비교)
- `amountKrw`·`occurredOn`·`id`가 그대로인지

---

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/mapping src/lib/analysis src/lib/redact
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "parseFloat" src/lib/` 결과가 비어 있는가?
   - `grep -rn "parseFloat\|Math.round\|toFixed" src/lib/analysis/` — 금액 경로에 부동소수점이 없는가?
   - `grep -rn "from 'crypto'\|require('crypto')" src/lib/analysis/` 가 비어 있는가?
   - `grep -rn "as RedactedRow\|as unknown as" src/` 가 `src/lib/redact.ts` 밖에서 나오지 않는가?
   - 금액 후보가 여럿일 때 원화 계열을 고르는 테스트가 있는가?
   - 카드번호 헤더가 매핑 후보에서 제외되는 테스트가 있는가?
   - 정상 상호(`이마트24`, `GS25`)가 보존되는 테스트가 있는가?
   - `CONFIDENCE_THRESHOLD`를 `src/types/tier.ts`에서 import 하는가? (하드코딩 금지)
   - 세 모듈 전부 I/O·네트워크·DB 접근이 없는 순수 함수인가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 세 모듈의 공개 함수와 fingerprint 정의·마스킹 토큰 목록을 한 줄로
   - 수정 3회 시도 후에도 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- `parseFloat`이나 부동소수점 연산을 쓰지 마라. 이유: 통화 합계에 오차가 쌓이고, 이 제품에서 금액 오차는 치명적이다.
- 카드번호 컬럼을 매핑 후보에 넣지 마라. 이유: 저장하지 않기로 한 데이터이며, 후보에 뜨면 사용자가 실수로 고른다.
- 파싱 실패 행 하나 때문에 전체를 실패시키지 마라. 이유: 사용자가 아무 결과도 못 얻는다.
- 할부·해외결제 전용 분기를 만들지 마라. 이유: 원화 청구액 컬럼을 쓰면 자동으로 맞고, 분기는 MVP 범위 밖이다.
- 사업경비/개인지출을 판단하는 로직을 만들지 마라. 이유: 분류는 AI가 한다(step5). 여기서 규칙으로 흉내 내면 두 개의 진실이 생긴다.
- Node `crypto` 모듈을 import 하지 마라. 이유: 이 코드는 브라우저에서도 실행된다. `crypto.subtle`을 쓴다.
- `review`·`unclassified` 금액을 경비 합계에 더하지 마라. 이유: 사용자가 미확정 금액을 신고에 쓰게 된다.
- 가맹점명의 지점 표기를 제거해 병합하지 마라. 이유: 되돌릴 수 없고, 지점별로 성격이 다를 수 있다.
- 민감정보를 삭제하지 마라. 이유: 문맥이 사라져 분류 품질이 떨어진다. 고정 토큰으로 치환한다.
- 숫자열을 넓게 잡아 마스킹하지 마라. 이유: `이마트24`·`GS25` 같은 정상 상호가 깨져 분류가 나빠진다.
- `RedactedRow` 캐스팅을 `src/lib/redact.ts` 밖에 두지 마라. 이유: 다른 곳에서 캐스팅할 수 있으면 타입이 주는 보장이 사라지고, 마스킹을 건너뛴 값이 외부로 나간다.
- 입력 객체를 변형하지 마라. 이유: 호출부가 원본을 화면에 그대로 쓰고 있어, 변형하면 사용자 화면의 가맹점명이 `[NAME]`으로 바뀐다.
- DB·네트워크·Anthropic을 호출하지 마라. 이유: 순수 함수여야 브라우저·서버 양쪽에서 같은 코드가 돈다. 호출은 step5의 범위다.
- 기존 테스트를 깨뜨리지 마라.
