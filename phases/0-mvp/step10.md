# Step 10: anthropic-service

## 읽어야 할 파일

- `/CLAUDE.md` — 제품 경계(세무조언 금지·확신도), 보안(마스킹 강제), 비용 규칙(프롬프트 캐싱)
- `/docs/ADR.md` — ADR-009, ADR-010, ADR-011, ADR-013, ADR-020
- `/docs/PRD.md` — 핵심 기능 3번
- `/src/types/domain.ts` (step1 — `Classification`, `AccountCode`)
- `/src/types/analysis.ts`, `/src/types/tier.ts` (step1 — `CONFIDENCE_THRESHOLD`)
- `/src/lib/redact.ts` (step5 — 외부 전송 단일 관문)

## 작업

`src/services/anthropic/`에 Claude API 래퍼를 구현한다. 라우트 핸들러(step11, step16)가 이 모듈만 호출하게 만든다.

모델은 `claude-opus-5`. `@anthropic-ai/sdk`를 쓴다.

### 1. `client.ts`

```ts
export function getClient(): Anthropic
// serverEnv('ANTHROPIC_API_KEY')를 호출 시점에 읽는다 (step0의 src/lib/env.ts)
// 모듈 로드 시점에 읽지 마라 — 키 없는 빌드가 깨진다
```

### 2. `prompt.ts` — 캐시 프리픽스 구성

**이 프로젝트 비용 구조의 핵심이다.**

```ts
export interface PromptBlocks {
  system: SystemBlock[]       // 지시문. cache_control 붙임
  ledger: ContentBlock        // 거래내역. cache_control 붙임
}

export function buildPromptBlocks(rows: RedactedRow[]): PromptBlocks
```

`RedactedRow`만 받는 것이 이 함수의 안전장치다(step1의 브랜디드 타입). `IdentifiedRow`를 넘기려 하면 컴파일이 실패한다 — **타입을 느슨하게 바꿔 통과시키지 마라.** 마스킹을 건너뛴 값이 국외로 나가는 것을 막는 유일한 구조적 장치다.

블록 순서와 캐시 지점:

```
[system]  분류 지시문 + 계정과목 정의 + 출력 스키마   ← cache_control: ephemeral
[user]    거래내역 전체 (번호가 매겨진 목록)          ← cache_control: ephemeral
[user]    실제 요청 (분류 지시 또는 Q&A 질문)         ← 캐시하지 않음
```

거래내역을 **프리픽스에 두고 캐시**하는 이유: step16의 Q&A는 같은 거래내역 위에서 질문만 바뀐다. 프리픽스를 캐시하지 않으면 질문마다 전체 내역이 재과금되어 유닛 이코노믹스가 무너진다.

거래내역 블록은 **결정론적으로** 만든다(정렬 고정, 포맷 고정). 이유: 블록 내용이 한 글자라도 달라지면 캐시가 미스된다.

### 3. `classify.ts` — 거래 분류

```ts
export interface ClassifyInput { rows: IdentifiedRow[] }
export interface ClassifyOutputItem {
  id: string                  // 입력 행의 id. 배열 index가 아니다
  classification: Classification
  accountCode: AccountCode | null
  confidence: number          // 0~1
}

export async function classifyTransactions(input: ClassifyInput): Promise<ClassifyOutputItem[]>
```

**결과를 배열 index로 반환하지 마라. `id`로 반환한다.** 이유: 호출부(step11)는 `applyRules`가 쪼갠 부분 배열을 넘기므로, index는 원본 거래를 가리키지 못한다. 모델에게는 번호를 매겨 보내되, 응답을 받은 뒤 그 번호를 **입력 배열의 `id`로 되돌려** 반환한다.

**입력은 `IdentifiedRow[]`이고, 이 함수가 내부에서 `redactRows()`를 호출해 `RedactedRow[]`로 만든 뒤 `buildPromptBlocks`에 넘긴다.** 마스킹을 거치지 않은 값이 나가는 코드 경로를 만들지 마라 — `buildPromptBlocks`의 시그니처가 이를 컴파일 단계에서 강제하지만, 호출했다는 사실도 테스트로 고정하라.

#### 출력 강제

tool use(structured output)로 스키마를 강제한다. 자유 텍스트를 파싱하지 마라 — 형식이 흔들리면 전건이 깨진다.

- `classification`은 `'business' | 'personal' | 'review'` 셋 중 하나
- `accountCode`는 `classification === 'business'`일 때만 값이 있고, 아니면 `null`
- `confidence`는 0~1 실수

#### 응답 검증

모델 응답을 **믿지 말고 검증한다.**

- 배열 길이가 입력과 다르면 에러
- `accountCode`가 `src/types/domain.ts`의 12개 값에 없으면 `'other'`로 강등
- `classification`이 셋 중 하나가 아니면 `'review'`, `confidence`는 0으로
- `confidence < CONFIDENCE_THRESHOLD`면 `classification`을 `'review'`로 강등

마지막 규칙이 중요한 이유: 확신이 낮은 판단을 단정으로 보여주면 사용자가 그대로 신고에 쓴다.

#### 프롬프트에 반드시 넣을 것

- 계정과목 12개의 **정의**. 이름만 주면 모델이 임의 해석한다
- 확신이 서지 않으면 `'review'`와 낮은 `confidence`를 내라는 지시. 억지로 단정하지 말 것
- 판단 근거가 가맹점명뿐임을 명시

#### 프롬프트에 절대 넣지 말 것

- **"경비 처리 가능/불가", "손금 산입", "한도 초과" 같은 세무 판단.** 분류와 계정과목 매핑까지만 한다
- 합계·평균·증감률 계산 요청. 금액 계산은 전부 코드가 한다
- 절세 조언이나 신고 방법 안내

### 4. `chat.ts` — Q&A (step16이 쓴다)

```ts
export async function askAboutLedger(rows: IdentifiedRow[], question: string): Promise<string>
```

여기서도 `redactRows()`를 통과시킨 뒤 `buildPromptBlocks`를 부른다.

`buildPromptBlocks`로 **step11과 동일한 프리픽스**를 만들고 질문만 덧붙인다. 프리픽스가 달라지면 캐시가 미스되어 비용이 10배가 된다.

여기서도 세무 조언은 금지다. 시스템 프롬프트에 "세법 판단·절세 조언은 하지 않는다. 사용자의 거래 데이터에 근거한 사실만 답한다"를 넣는다.

### 테스트

Anthropic SDK를 모킹한다. **실제 API를 호출하지 마라** — 키가 없어 blocked가 되고 이후 step이 전부 멈춘다.

- `redactRows`가 호출된 뒤에 SDK가 호출되는지 (호출 순서를 spy로 검증)
- SDK에 전달된 블록에 `cache_control`이 붙어 있는지
- 같은 입력에 같은 프리픽스 문자열이 나오는지 (결정론)
- 응답 길이 불일치 → 에러
- 반환된 `id`가 전부 입력 배열의 `id` 집합에 속하는지 (모델이 지어낸 번호가 섞이지 않는지)
- 부분 배열을 넘겨도 올바른 `id`가 돌아오는지 (index 기반이 아님을 고정)
- 알 수 없는 `accountCode` → `'other'`
- `confidence: 0.5`인 `business` → `'review'`로 강등
- `classification`이 `personal`인데 `accountCode`가 있으면 `null`로
- 시스템 프롬프트에 금지 문구(`경비 처리 가능`, `손금`, `절세`)가 **없는지**

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/services/anthropic
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "redactRows" src/services/anthropic/classify.ts` 가 나오는가?
   - `grep -rn "cache_control" src/services/anthropic/prompt.ts` 가 나오는가?
   - `grep -rniE "경비 처리|손금|절세|가산세|신고하세요" src/services/anthropic/` 가 비어 있는가?
   - 모델 ID가 `claude-opus-5`인가?
   - `CONFIDENCE_THRESHOLD`를 `src/types/tier.ts`에서 import 하는가?
   - `getClient`가 모듈 로드 시점에 `process.env`를 읽지 않는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 10을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 공개 함수, 캐시 프리픽스 구성, 응답 검증 규칙을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 마스킹을 거치지 않은 값을 SDK에 넘기지 마라. 이유: 가맹점명 필드에 성명·계좌번호가 섞여 들어오며, 그대로 국외로 나간다.
- 세무 판단·절세 조언을 프롬프트에 요구하지 마라. 이유: 틀리면 사용자가 가산세를 문다. 분류와 계정과목까지만 한다.
- 합계·평균·증감률을 LLM에게 계산시키지 마라. 이유: 금액 계산은 코드가 한다(step4). 두 개의 숫자가 생긴다.
- 자유 텍스트 응답을 파싱하지 마라. 이유: 형식이 흔들리면 전건이 깨진다. tool use로 스키마를 강제한다.
- 모델 응답을 검증 없이 저장하지 마라. 이유: 존재하지 않는 계정과목이 DB에 들어간다.
- 결과를 배열 index로 반환하지 마라. 이유: 호출부가 부분 배열을 넘기므로 index가 원본 거래를 가리키지 못하고, 엉뚱한 거래에 분류가 저장된다.
- `buildPromptBlocks`의 입력 타입을 `IdentifiedRow[]`로 완화하지 마라. 이유: 마스킹 누락을 컴파일 단계에서 막는 유일한 장치가 사라진다.
- 거래내역을 캐시 프리픽스 밖에 두지 마라. 이유: Q&A 질문마다 전체 내역이 재과금되어 유닛 이코노믹스가 무너진다.
- 실제 Anthropic API를 호출하는 테스트를 쓰지 마라. 이유: 키가 없어 blocked가 되고 이후 step이 전부 멈춘다.
- 쿼터를 검사하지 마라. 이유: 이 모듈은 래퍼이며, 관문은 호출부(step11·16)가 건다.
- 제공자 추상화 인터페이스를 만들지 마라. 이유: 구현체가 하나뿐인 추상화는 비용만 있다(ADR-020).
- 기존 테스트를 깨뜨리지 마라.
