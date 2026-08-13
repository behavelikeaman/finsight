# Step 4: analysis-engine

## 읽어야 할 파일

- `/CLAUDE.md` — 데이터 무결성 규칙
- `/docs/ARCHITECTURE.md` — 데이터 모델의 fingerprint 정의
- `/docs/ADR.md` — ADR-006(브라우저 전처리), ADR-011(확신도)
- `/src/types/domain.ts`, `/src/types/analysis.ts`, `/src/types/tier.ts` (step1)
- `/src/lib/mapping/index.ts` (step3 — 입력이 되는 `NormalizedRow`의 실제 형태)

## 작업

`src/lib/analysis/`에 집계·중복판정·확신도 버킷팅을 구현한다. **전부 I/O 없는 순수 함수다.** 이 프로젝트의 모든 금액 계산은 여기서만 일어난다.

**여기서 경비 분류를 하지 않는다.** 사업경비/개인지출 판단은 AI가 한다(step10·11). 이 step은 숫자를 다루는 층이다.

### 공개 인터페이스 (`src/lib/analysis/index.ts`)

```ts
export function summarize(rows: NormalizedRow[]): AnalysisSummary
export function computeFingerprint(rows: NormalizedRow[]): string
export function bucketByClassification(txs: ClassifiedTransaction[]): ClassifiedView
export function pickSample(rows: IdentifiedRow[], size: number): IdentifiedRow[]
```

**입력 타입이 함수마다 다른 것은 의도된 것이다.** `summarize`·`computeFingerprint`는 업로드 시점(id 없음)에 돌고, `pickSample`은 저장 후 분류 파이프라인(id 있음)에서 돈다. `bucketByClassification`은 분류가 끝난 화면용이다. 편의를 위해 하나로 합치지 마라 — id 없는 값이 분류 경로로 흘러들면 결과를 어느 행에 쓸지 알 수 없게 된다.

### 1. 집계 (`summarize.ts`)

- `totalKrw` — 전체 합. **정수 연산만.** 음수(환불) 행도 그대로 더한다
- `periods` — `occurredOn`의 앞 7자리로 `YYYY-MM` 그룹핑, 오름차순
- `topMerchants` — 가맹점명별 합계 내림차순 상위 10건
- `rowCount` — 행 수

가맹점명은 집계 전에 정규화한다: 앞뒤 공백 제거, 연속 공백 1칸으로, 말미의 지점 표기(`강남점`, `1호점`)는 **제거하지 않는다.** 이유: 지점이 다르면 성격이 다를 수 있고(본사 근처 카페 vs 여행지 카페), 병합하면 되돌릴 수 없다.

부동소수점을 거치지 마라. `reduce`로 정수를 누적한다.

### 2. fingerprint (`fingerprint.ts`)

```
정렬 키: `${occurredOn}|${merchant}|${amountKrw}` 문자열의 사전순
fingerprint = sha256(정렬된 전체 행을 개행으로 이은 문자열)
```

**정렬 후 해싱하는 이유**: 같은 명세서를 다른 순서로 내려받아도 같은 지문이 나와야 중복이 잡힌다.

`crypto.subtle.digest`를 쓴다(브라우저·Node 양쪽에서 동작). Node의 `crypto` 모듈을 import 하지 마라 — 이 코드는 브라우저에서도 돈다.

### 3. 확신도 버킷 (`bucket.ts`)

`bucketByClassification`은 분류된 거래를 화면 단위로 나눈다.

- `confidence`가 `CONFIDENCE_THRESHOLD`(0.7) 미만이면 **`classification` 값과 무관하게 `review` 버킷**에 넣는다
- `classification`이 `null`인 건은 `unclassified` 버킷 (표본 모드에서 분류되지 않고 남은 건)
- `isUserEdited`가 `true`면 사용자가 이미 확정한 것이므로 `confidence`와 무관하게 `review`에 넣지 않는다
- `businessTotalKrw` / `personalTotalKrw`는 각 버킷의 정수 합. **`review`와 `unclassified`는 어느 쪽에도 더하지 않는다**

마지막 규칙이 중요한 이유: 확인이 안 끝난 금액을 경비 합계에 넣으면 사용자가 그 숫자를 신고에 쓴다. 미확정은 미확정으로 보여야 한다.

### 4. 표본 선택 (`pickSample`)

익명 프리뷰에서 AI로 보낼 거래를 고른다. **금액 절대값 내림차순 상위 `size`건.**

이유: 20건으로 "AI가 제대로 가르는가"를 판단시켜야 하는데, 무작위로 고르면 편의점 결제만 나올 수 있다. 금액이 큰 건이 판단 가치가 높다.

동점이면 `occurredOn`, 그다음 `id` 내림차순으로 안정 정렬한다. 이유: 같은 입력에 같은 표본이 나와야 테스트가 고정되고, 재실행 시 다른 건이 뽑히지 않는다.

반환값은 입력 객체를 그대로 담는다(`id` 포함). 새 객체로 복사하며 `id`를 떨어뜨리지 마라 — 호출부(step11)가 이 `id`로 분류 결과를 저장한다.

### 테스트

- 음수(환불) 행이 섞인 합계
- 정수 유지 — 소수점이 개입하지 않는지
- 같은 행을 순서만 바꿔 넣었을 때 fingerprint가 동일한가
- 한 행만 금액이 달라도 fingerprint가 달라지는가
- `confidence: 0.6`인 `business` 건이 `review`로 가는가
- `isUserEdited: true`이고 `confidence: 0.5`인 건이 `review`로 가지 **않는가**
- `review`·`unclassified` 금액이 `businessTotalKrw`에 포함되지 **않는가**
- `pickSample`이 금액 상위순이며 같은 입력에 같은 출력인가
- `pickSample` 결과의 각 원소에 `id`가 보존되는가

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/analysis
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "parseFloat\|Math.round\|toFixed" src/lib/analysis/` — 금액 경로에 부동소수점이 없는가?
   - `grep -rn "from 'crypto'\|require('crypto')" src/lib/analysis/` 가 비어 있는가?
   - Anthropic·Supabase 호출이 없는 순수 함수인가?
   - `CONFIDENCE_THRESHOLD`를 `src/types/tier.ts`에서 import 하는가? (하드코딩 금지)
3. 결과에 따라 `phases/0-mvp/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 공개 함수 4개와 fingerprint 정의를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 사업경비/개인지출을 판단하는 로직을 만들지 마라. 이유: 분류는 AI가 한다(step10·11). 여기서 규칙으로 흉내 내면 두 개의 진실이 생긴다.
- 부동소수점 연산을 쓰지 마라. 이유: 통화 합계에 오차가 쌓이고, 이 제품에서 금액 오차는 치명적이다.
- Node `crypto` 모듈을 import 하지 마라. 이유: 이 코드는 브라우저에서도 실행된다. `crypto.subtle`을 쓴다.
- `review`·`unclassified` 금액을 경비 합계에 더하지 마라. 이유: 사용자가 미확정 금액을 신고에 쓰게 된다.
- 가맹점명의 지점 표기를 제거해 병합하지 마라. 이유: 되돌릴 수 없고, 지점별로 성격이 다를 수 있다.
- DB·네트워크에 접근하지 마라. 이유: 순수 함수여야 브라우저·서버 양쪽에서 같은 코드가 돈다.
- 기존 테스트를 깨뜨리지 마라.
