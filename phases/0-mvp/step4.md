# Step 4: analysis-engine

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` — 데이터 모델의 잠금 판정과 fingerprint 정의
- `/docs/PRD.md` — 요금제와 잠금 정책
- `/src/types/domain.ts`, `/src/types/analysis.ts` (step1)
- `/src/lib/mapping/index.ts` (step3 — 입력이 되는 `NormalizedRow`의 실제 형태)

## 작업

`src/lib/analysis/`에 분류·집계·중복판정·잠금판정을 구현한다. **전부 I/O 없는 순수 함수다.** 이 프로젝트의 모든 금액 계산은 여기서만 일어난다.

### 공개 인터페이스 (`src/lib/analysis/index.ts`)

```ts
export function categorize(merchant: string): Category
export function aggregateByPeriod(rows: NormalizedRow[]): PeriodSummary[]
export function computeFingerprint(rows: NormalizedRow[]): string
export function applyLocks(periods: PeriodSummary[], plan: Plan): PeriodView[]
```

### 1. 카테고리 분류 (`categorize.ts`)

가맹점명 키워드 규칙으로 `Category`를 정한다. 한국 가맹점명 기준의 키워드 목록을 카테고리별로 둔다.

- `food` 배달의민족, 쿠팡이츠, 요기요, 식당, 김밥, 치킨, 피자
- `cafe` 스타벅스, 투썸, 이디야, 메가커피, 커피, 카페
- `transport` 택시, 카카오T, 지하철, 버스, 주유, GS칼텍스, SK에너지, 하이패스
- `subscription` 넷플릭스, 유튜브, 스포티파이, 왓챠, 애플, 구글, 쿠팡와우, ChatGPT, OpenAI
- `shopping` 쿠팡, 11번가, G마켓, 무신사, 올리브영, 다이소
- `medical` 병원, 의원, 약국, 치과, 한의원
- `living` 통신, SKT, KT, LG유플러스, 전기, 도시가스, 관리비
- `culture` CGV, 메가박스, 롯데시네마, 서점, 教보문고
- `travel` 항공, 호텔, 야놀자, 여기어때, 아고다
- 어디에도 안 걸리면 `etc`

대소문자·공백을 정규화해 비교한다. 규칙은 데이터로 분리해 테스트에서 확인 가능하게 둔다.

### 2. 월별 집계 (`aggregate.ts`)

`occurredOn`의 `YYYY-MM`으로 묶는다. **한 파일에 여러 달이 섞여 있어도 각각 분리된다.**

각 `PeriodSummary`:
- `totalKrw` — 해당 월 합계. 음수(환불)는 그대로 차감된다
- `byCategory` — 카테고리별 합계. 모든 `Category` 키를 포함하고 없으면 0
- `topMerchants` — 금액 내림차순 상위 5개
- `etcRatio` — `etc` 카테고리 금액 / 총액의 절대값 기준 비율. 0~1

정수 연산만 쓴다. `parseFloat`·부동소수점 누적을 쓰지 마라.

### 3. fingerprint (`fingerprint.ts`)

```
fingerprint = sha256( 정렬된 "occurredOn|merchant|amountKrw" 줄들을 개행으로 연결 )
```

정렬은 문자열 기준으로 결정적이어야 한다. 같은 입력이면 항상 같은 값, 한 행이라도 다르면 다른 값.

브라우저·서버 양쪽에서 도는 코드이므로 Node `crypto` 모듈을 쓰지 말고 **Web Crypto(`crypto.subtle.digest`)** 를 쓴다. 따라서 이 함수는 `Promise<string>`을 반환해도 된다 — 시그니처를 그렇게 잡아라.

한계를 주석으로 남긴다: 거래가 한 건 추가된 재발행 명세서는 다른 fingerprint가 되어 중복으로 잡히지 않는다. MVP에서 감수하는 사항이다.

### 4. 잠금 판정 (`locks.ts`)

```ts
export function applyLocks(periods: PeriodSummary[], plan: Plan): PeriodView[]
```

- `plan === 'pro'` → 전부 그대로 통과
- `plan === 'free'` → 가장 최신 `period`와 그 직전 1개월까지만 통과. 그보다 오래된 기간은 `LockedPeriod`로 **치환**한다

`LockedPeriod`는 `{ locked: true, period, teaser }`만 담는다. `teaser`는 금액이 들어가지 않은 문구여야 한다(예: `"지출이 늘었습니다"`). **금액·카테고리·가맹점을 절대 넣지 마라.** 이유: 이 객체가 그대로 네트워크로 나가므로, 값이 들어 있으면 잠금이 무의미해진다.

### 테스트

- 2개월치가 섞인 입력이 두 `PeriodSummary`로 분리되는지
- 환불(음수)이 합계에서 차감되는지
- `byCategory` 합이 `totalKrw`와 일치하는지
- 같은 입력의 fingerprint가 동일하고, 한 행만 바꾸면 달라지는지
- `free`에서 오래된 기간이 `LockedPeriod`가 되고 **금액 필드가 없는지**
- `pro`에서는 잠기지 않는지

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
   - `grep -rn "parseFloat" src/lib/analysis/` 결과가 비어 있는가?
   - `LockedPeriod`를 만드는 코드가 금액을 담지 않는가?
   - Node `crypto`를 import하지 않았는가? (브라우저에서 깨진다)
   - I/O·네트워크·DB 접근이 없는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 공개 함수 4개와 잠금 규칙을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- `LockedPeriod`에 금액·카테고리·가맹점·인사이트를 넣지 마라. 이유: 그대로 네트워크로 나가므로 잠금이 무력화된다.
- Node `crypto` 모듈을 쓰지 마라. 이유: 이 코드는 브라우저에서도 실행된다. Web Crypto를 쓴다.
- 부동소수점으로 금액을 누적하지 마라. 이유: 합계에 오차가 쌓인다.
- DB 조회나 fetch를 넣지 마라. 이유: 순수 함수여야 픽스처만으로 테스트가 완결된다.
- 집계 결과를 저장하는 코드를 쓰지 마라. 이유: 저장은 step7의 범위다.
- 기존 테스트를 깨뜨리지 마라.
