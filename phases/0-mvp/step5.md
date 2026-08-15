# Step 5: ai-pipeline

분석·분류 파이프라인 전체를 만든다. 네 덩어리이며 **A → B → C → D 순서로 진행한다.**

| 순서 | 범위 | 산출물 |
|---|---|---|
| A | 두 관문 (순수 함수 + RPC 래퍼) | `src/lib/rules.ts`, `src/lib/quota.ts` |
| B | Claude API 래퍼 | `src/services/anthropic/` |
| C | 집계 API (LLM 없음) | `src/app/api/analyze/route.ts` |
| D | 분류 API (A·B·C를 배선) | `src/app/api/analyses/[id]/classify/route.ts` |

**각 덩어리마다 해당 AC 커맨드가 통과한 뒤 다음으로 넘어가라.** 넷을 동시에 벌여놓지 마라 — D는 A·B에 의존하므로 실패 지점을 좁힐 수 없게 된다.

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다. C·D 모두 `route.test.ts`를 **먼저** 작성하라.

**실제 Anthropic·Supabase API를 호출하지 마라.** 전부 모킹한다. 키가 없어 blocked가 되고 이후 step이 전부 멈춘다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — CRITICAL 전체 (제품 경계·보안·비용·데이터 흐름)
- `/docs/ARCHITECTURE.md` — API 계약, 분석 파이프라인 1·2단계, "분류 모드" 절
- `/docs/ADR.md` — ADR-006, ADR-009~015, ADR-017, ADR-020
- `/docs/PRD.md` — 핵심 기능 3번
- `/src/types/api.ts` — `AnalyzeRequest/Response`, `ClassifyRequest/Response`
- `/src/types/domain.ts` — `IdentifiedRow`, `RedactedRow`(브랜디드), `Classification`, `AccountCode`
- `/src/types/analysis.ts`, `/src/types/tier.ts` — `MAX_ROWS`, `SAMPLE_SIZE`, `QUOTA`, `CONFIDENCE_THRESHOLD`
- `/src/types/db.ts` — `user_rules`, `usage_counters` 행 타입
- `/src/lib/analysis/index.ts` — `summarize`, `computeFingerprint`, `pickSample`
- `/src/lib/redact.ts` — 외부 전송 단일 관문
- `/src/lib/supabase/server.ts`, `/src/lib/supabase/session.ts` — `requireUser`, `getEffectiveTier`, `isAnonymousUser`
- `/supabase/migrations/0001_initial.sql` — `effective_tier`·`increment_usage`·`mark_sample_used` 함수
- `/src/lib/env.ts` — 환경변수는 호출 시점에 읽는다

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라. 특히 이 파이프라인이 `id`를 어떻게 옮기는지 확인하라.

---

# A. 두 관문 (`src/lib/rules.ts`, `src/lib/quota.ts`)

AI 호출 앞에 세울 관문이다. **여기서는 라우트를 건드리지 않는다.** 연결은 D에서 한다.

## A-1. `src/lib/rules.ts` — 규칙 선적용 (순수 함수)

```ts
export interface RuleMatch {
  row: IdentifiedRow          // id를 반드시 보존한다
  classification: Classification
  accountCode: AccountCode | null
  ruleId: string
}

export interface RuleApplyResult {
  matched: RuleMatch[]        // 규칙이 결정한 건. AI로 보내지 않는다
  unmatched: IdentifiedRow[]  // AI로 보낼 건
}

export function applyRules(rows: IdentifiedRow[], rules: UserRuleRow[]): RuleApplyResult

/** 사용자가 고친 거래에서 규칙 패턴을 뽑는다. */
export function derivePattern(merchant: string): string
```

**매칭 규칙**: `merchant_pattern`을 정규화(공백 제거, 소문자화)한 뒤 가맹점명에 **부분 문자열로 포함**되면 매칭. 정규식을 쓰지 마라 — 사용자가 입력한 문자열이 정규식으로 해석되면 오작동하고, `.*`가 들어오면 전건이 매칭된다.

패턴이 여러 개 걸리면 **가장 긴 패턴이 이긴다.** 이유: `스타벅스`와 `스타벅스 강남점`이 둘 다 있으면 구체적인 쪽이 사용자의 최근 의도다.

`derivePattern`은 가맹점명에서 지점·번호 꼬리를 떼어 재사용 가능한 패턴을 만든다(`스타벅스 강남점` → `스타벅스`). 다만 원본이 짧으면(4자 이하) 그대로 쓴다. 이유: 과하게 일반화한 패턴은 무관한 거래까지 잡는다.

`applyRules`는 **I/O가 없다.** 규칙 조회는 호출부(D)가 하고, 여기에는 배열로 넘긴다.

`matched`와 `unmatched` 양쪽 모두 원본의 `id`를 그대로 담는다. 배열을 쪼개는 순간 인덱스가 깨지므로, **`id`가 유일한 되짚기 수단이다.** 새 객체로 복사하며 `id`를 떨어뜨리지 마라.

> 이 관문이 원가 구조의 핵심이다. 규칙에 걸린 거래는 AI로 나가지 않으므로, 재방문 사용자일수록 호출 건수가 줄어든다.

## A-2. `src/lib/quota.ts` — 사용량 검사

```ts
export type QuotaKind = 'classify' | 'chat'

export type QuotaVerdict =
  | { allowed: true; left: number }
  | { allowed: false; reason: 'quota_exceeded' | 'tier_required' }

/** 현재 기간(YYYY-MM)의 사용량을 조회해 판정한다. 차감은 하지 않는다. */
export async function checkQuota(userId: string, kind: QuotaKind): Promise<QuotaVerdict>

/** 성공적으로 호출한 뒤 1 증가. 원자적으로 처리한다. */
export async function consumeQuota(userId: string, kind: QuotaKind): Promise<void>

/** 익명 표본 1회 제한. profiles.sample_used 를 본다. */
export async function checkSampleAllowance(userId: string): Promise<boolean>
export async function markSampleUsed(userId: string): Promise<void>
```

한도는 `src/types/tier.ts`의 `QUOTA`에서 읽는다. **숫자를 하드코딩하지 마라.** 이유: 랜딩의 요금제 표(step6)와 어긋나면 사용자가 결제하고도 막힌다.

`free` 티어의 `chatPerMonth`가 0이므로, `kind: 'chat'`이고 티어가 free면 `reason: 'tier_required'`를 반환한다(쿼터 소진이 아니라 등급 문제다). 이유: UI가 "이번 달 다 썼습니다"와 "Pro 기능입니다"를 다르게 안내해야 한다.

**검사와 차감을 분리하는 이유**: AI 호출이 실패했을 때 쿼터를 먹으면 안 된다. `checkQuota` → 호출 → 성공 시에만 `consumeQuota`.

### 쓰기는 전부 DB 함수로만 한다

이전 step에서 `usage_counters`에 사용자 INSERT·UPDATE·DELETE 정책을 만들지 않았고, `profiles.sample_used`도 `revoke update` 대상이다. 따라서 **여기서 테이블을 직접 쓰려고 하면 RLS에 막힌다.** 이건 버그가 아니라 설계다.

- `consumeQuota` → `increment_usage(kind)` RPC 호출. 인자는 `kind`뿐이다(uid·period는 함수가 `auth.uid()`와 서버 시각에서 읽는다)
- `markSampleUsed` → `mark_sample_used()` RPC 호출

세 함수 모두 `0001_initial.sql`에 이미 있다. **새 마이그레이션 파일을 만들지 마라.**

애플리케이션에서 읽고-더하고-쓰지 마라 — 동시 요청에서 카운트가 새어 나간다.

기간(`period`)은 서버 시각 기준 `YYYY-MM`이며 DB 함수가 정한다. 클라이언트가 보낸 값은 물론이고 애플리케이션이 계산한 값도 넘기지 마라.

## A-3. 테스트

- `applyRules`: 부분 문자열 매칭, 가장 긴 패턴 우선, 매칭된 건이 `unmatched`에 없는지, 빈 규칙 배열
- `applyRules`: `merchant_pattern`에 `.*`나 `[a-z]+`가 들어와도 정규식으로 해석되지 않는지
- `applyRules`: `matched`·`unmatched` 양쪽에 원본 `id`가 보존되는지
- `derivePattern`: 지점 꼬리 제거, 짧은 이름은 그대로
- `checkQuota`: free/pro 각각의 한도 경계, chat + free → `tier_required`
- `consumeQuota`: `increment_usage` RPC를 호출하는지 (테이블 직접 쓰기가 아닌지)
- `markSampleUsed`: `mark_sample_used` RPC를 호출하는지
- `checkSampleAllowance`: `sample_used`가 true면 false 반환

**중간 확인**: `npx vitest run src/lib/rules src/lib/quota` 통과 후 B로.

---

# B. Claude API 래퍼 (`src/services/anthropic/`)

라우트 핸들러(D, 그리고 step6의 chat API)가 이 모듈만 호출하게 만든다. 모델은 `claude-opus-5`, `@anthropic-ai/sdk`를 쓴다.

## B-1. `client.ts`

```ts
export function getClient(): Anthropic
// serverEnv('ANTHROPIC_API_KEY')를 호출 시점에 읽는다 (src/lib/env.ts)
// 모듈 로드 시점에 읽지 마라 — 키 없는 빌드가 깨진다
```

## B-2. `prompt.ts` — 캐시 프리픽스 구성

**이 프로젝트 비용 구조의 핵심이다.**

```ts
export interface PromptBlocks {
  system: SystemBlock[]       // 지시문. cache_control 붙임
  ledger: ContentBlock        // 거래내역. cache_control 붙임
}

export function buildPromptBlocks(rows: RedactedRow[]): PromptBlocks
```

`RedactedRow`만 받는 것이 이 함수의 안전장치다(브랜디드 타입). `IdentifiedRow`를 넘기려 하면 컴파일이 실패한다 — **타입을 느슨하게 바꿔 통과시키지 마라.** 마스킹을 건너뛴 값이 국외로 나가는 것을 막는 유일한 구조적 장치다.

블록 순서와 캐시 지점:

```
[system]  분류 지시문 + 계정과목 정의 + 출력 스키마   ← cache_control: ephemeral
[user]    거래내역 전체 (번호가 매겨진 목록)          ← cache_control: ephemeral
[user]    실제 요청 (분류 지시 또는 Q&A 질문)         ← 캐시하지 않음
```

거래내역을 **프리픽스에 두고 캐시**하는 이유: Q&A는 같은 거래내역 위에서 질문만 바뀐다. 프리픽스를 캐시하지 않으면 질문마다 전체 내역이 재과금되어 유닛 이코노믹스가 무너진다.

거래내역 블록은 **결정론적으로** 만든다(정렬 고정, 포맷 고정). 이유: 블록 내용이 한 글자라도 달라지면 캐시가 미스된다.

## B-3. `classify.ts` — 거래 분류

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

**결과를 배열 index로 반환하지 마라. `id`로 반환한다.** 이유: 호출부(D)는 `applyRules`가 쪼갠 부분 배열을 넘기므로, index는 원본 거래를 가리키지 못한다. 모델에게는 번호를 매겨 보내되, 응답을 받은 뒤 그 번호를 **입력 배열의 `id`로 되돌려** 반환한다.

**입력은 `IdentifiedRow[]`이고, 이 함수가 내부에서 `redactRows()`를 호출해 `RedactedRow[]`로 만든 뒤 `buildPromptBlocks`에 넘긴다.** 마스킹을 거치지 않은 값이 나가는 코드 경로를 만들지 마라 — `buildPromptBlocks`의 시그니처가 이를 컴파일 단계에서 강제하지만, 호출했다는 사실도 테스트로 고정하라.

### 출력 강제

tool use(structured output)로 스키마를 강제한다. 자유 텍스트를 파싱하지 마라 — 형식이 흔들리면 전건이 깨진다.

- `classification`은 `'business' | 'personal' | 'review'` 셋 중 하나
- `accountCode`는 `classification === 'business'`일 때만 값이 있고, 아니면 `null`
- `confidence`는 0~1 실수

### 응답 검증

모델 응답을 **믿지 말고 검증한다.**

- 배열 길이가 입력과 다르면 에러
- `accountCode`가 `src/types/domain.ts`의 12개 값에 없으면 `'other'`로 강등
- `classification`이 셋 중 하나가 아니면 `'review'`, `confidence`는 0으로
- `confidence < CONFIDENCE_THRESHOLD`면 `classification`을 `'review'`로 강등

마지막 규칙이 중요한 이유: 확신이 낮은 판단을 단정으로 보여주면 사용자가 그대로 신고에 쓴다.

### 프롬프트에 반드시 넣을 것

- 계정과목 12개의 **정의**. 이름만 주면 모델이 임의 해석한다
- 확신이 서지 않으면 `'review'`와 낮은 `confidence`를 내라는 지시. 억지로 단정하지 말 것
- 판단 근거가 가맹점명뿐임을 명시

### 프롬프트에 절대 넣지 말 것

- **"경비 처리 가능/불가", "손금 산입", "한도 초과" 같은 세무 판단.** 분류와 계정과목 매핑까지만 한다
- 합계·평균·증감률 계산 요청. 금액 계산은 전부 코드가 한다
- 절세 조언이나 신고 방법 안내

## B-4. `chat.ts` — Q&A

```ts
export async function askAboutLedger(rows: IdentifiedRow[], question: string): Promise<string>
```

여기서도 `redactRows()`를 통과시킨 뒤 `buildPromptBlocks`를 부른다.

`buildPromptBlocks`로 **`classify.ts`와 동일한 프리픽스**를 만들고 질문만 덧붙인다. 프리픽스가 달라지면 캐시가 미스되어 비용이 10배가 된다.

여기서도 세무 조언은 금지다. 시스템 프롬프트에 "세법 판단·절세 조언은 하지 않는다. 사용자의 거래 데이터에 근거한 사실만 답한다"를 넣는다.

이 함수를 쓰는 라우트는 step6에서 만든다. 여기서는 함수만 만든다.

## B-5. 테스트

Anthropic SDK를 모킹한다.

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

**중간 확인**: `npx vitest run src/services/anthropic` 통과 후 C로.

---

# C. 집계 API (`src/app/api/analyze/route.ts`)

`POST /api/analyze`. 파이프라인 1단계다. **이 엔드포인트는 LLM을 호출하지 않는다.**

## C-1. 처리 순서

```
1. requireUser()            — 미인증이면 401
2. 본문 파싱 + 검증          — rows 배열, 각 필드 타입, MAX_ROWS 상한
3. computeFingerprint(rows)
4. 중복 조회                 — (owner_id, fingerprint)로 기존 analyses 검색
   └ 있으면: 저장하지 않고 { ok:false, reason:'duplicate', existingId } 반환
5. summarize(rows)          — 서버가 직접 계산
6. 저장                      — analyses 1행 + transactions N행 (한 트랜잭션처럼)
                              classification·account_code·confidence 는 전부 null
7. { ok:true, analysisId, summary } 반환
```

**6번에서 `classification`을 채우지 마라.** 이 엔드포인트는 분류하지 않는다. 분류는 D가 한다.

## C-2. 검증 규칙

- `rows`가 배열이 아니거나 비어 있으면 400
- 행 수가 `MAX_ROWS`(10,000) 초과면 400. 조용히 자르지 마라
- 각 행: `occurredOn`이 `YYYY-MM-DD` 형태, `merchant`가 비어 있지 않은 문자열, `amountKrw`가 **정수**. 하나라도 아니면 400
- 본문 크기 상한도 확인한다

**클라이언트가 보낸 집계·총액을 받지 마라.** 요청은 `rows`·`cardLabel`·`sourceKind`뿐이다. 이유: 클라이언트 계산을 신뢰하면 화면에 뜬 금액이 서버 기록과 달라진다.

## C-3. `owner_id`와 저장

`transactions`와 `analyses`의 `owner_id`는 **서버가 `auth.uid()`에서 채운다.** 요청 본문에서 읽지 마라. 이유: 남의 `owner_id`로 삽입하려는 시도를 애초에 차단한다(RLS `WITH CHECK`가 2차 방어).

`analyses` 1행을 만들고 그 id로 `transactions`를 일괄 삽입한다. 삽입 도중 실패하면 `analyses` 행도 남기지 마라 — 고아 분석이 생긴다. Supabase RPC(`plpgsql` 함수)로 묶거나, 실패 시 명시적으로 `analyses`를 삭제한다.

## C-4. 테스트

Supabase 클라이언트와 `session.ts`를 모킹한다.

- 미인증 → 401
- 10,001행 → 400
- `amountKrw`가 소수 → 400
- `merchant`가 빈 문자열 → 400
- 정상 요청 → `ok:true`, `summary` 반환, `owner_id`가 세션 uid로 채워졌는지
- 저장된 `transactions`의 `classification`이 전부 `null`인지
- 중복 fingerprint → 저장 호출이 **일어나지 않고** `ok:false, reason:'duplicate'` 반환
- 요청 본문에 `owner_id`를 넣어도 무시되는지

**중간 확인**: `npx vitest run src/app/api/analyze` 통과 후 D로.

---

# D. 분류 API (`src/app/api/analyses/[id]/classify/route.ts`)

`POST /api/analyses/:id/classify`. A의 두 관문과 B의 서비스를 **여기서 배선한다.** 이 프로젝트에서 AI 비용이 발생하는 경로는 여기와 step6의 chat API 둘뿐이다.

에러 응답 형식은 C와 맞춘다.

## D-1. 처리 순서

```
1. requireUser()                          — 미인증이면 401
2. 소유 확인                                — analyses.owner_id === uid, 아니면 404
                                             (403이 아니라 404. 이유: 존재 여부를 노출하지 않는다)
3. mode 재판정                              ← 서버가 결정한다
   ├ isAnonymousUser && mode==='full'  → { ok:false, reason:'anonymous_full_denied' }
   └ 익명이면 mode는 'sample'로 강제
4. 관문 A — mode별 허용 검사
   ├ sample: checkSampleAllowance(uid)  false면 { ok:false, reason:'sample_used' }
   └ full:   checkQuota(uid,'classify') allowed:false면 { ok:false, reason:'quota_exceeded' }
5. 대상 거래 조회                            — classification IS NULL 인 건만
   └ IdentifiedRow[] 로 매핑 (id 를 반드시 실어라)
   └ sample이면 pickSample(rows, SAMPLE_SIZE)
6. 관문 B — applyRules(rows, userRules)
   └ matched 는 AI로 보내지 않고 바로 저장 (rule_id 기록)
7. classifyTransactions({ rows: unmatched })  ← 여기서만 AI 호출
8. 결과 저장                                — id 기준으로 UPDATE
                                              classification, account_code, confidence
9. 성공 시에만 consumeQuota / markSampleUsed  ← RPC 경유 (테이블 직접 쓰기 불가)
10. { ok:true, classified, fromRules, fromAi, quotaLeft }
```

## D-2. `id`로만 되짚는다

`applyRules`가 배열을 `matched`/`unmatched`로 쪼개므로 **배열 index는 원본 거래를 가리키지 못한다.** `classifyTransactions`가 반환하는 `ClassifyOutputItem.id`와 `RuleMatch.row.id`로만 UPDATE 대상을 정한다.

index로 되짚는 코드를 쓰지 마라. 조용히 엉뚱한 거래에 분류가 저장되고, 테스트에서 잘 드러나지 않는다.

## D-3. 반드시 지킬 순서

**관문 → 호출 → 차감.** 이 순서를 바꾸지 마라.

- 관문보다 AI 호출이 먼저 오면 쿼터가 무의미해진다
- 차감이 호출보다 먼저 오면 API가 실패했는데 사용자 쿼터가 깎인다

**`applyRules`가 `classifyTransactions`보다 먼저다.** 규칙에 걸린 거래는 AI로 나가지 않는다. 이게 재방문 사용자의 원가를 낮추는 구조다.

## D-4. 익명 판정

`mode`는 요청 본문에 들어오지만 **서버가 세션으로 재판정한다.** 클라이언트가 `'full'`을 보내도 익명이면 거부한다. 이유: 익명에 전건(회당 약 440원)을 열면 남용 표면이 생긴다.

익명 여부는 `isAnonymousUser(user)`로 판정한다. 요청 본문의 어떤 필드도 신뢰하지 마라.

## D-5. 이미 분류된 건 · 부분 실패

`classification IS NOT NULL`인 거래는 대상에서 제외한다. 이유: 재분류하면 사용자가 고친 값이 덮이고, AI 비용이 중복 발생한다. `is_user_edited = true`인 건은 **어떤 경우에도 덮어쓰지 마라.**

AI 호출이 실패하면 규칙으로 분류된 건(`matched`)은 **그대로 저장하고** 에러를 반환한다. 이유: 규칙 분류는 비용이 들지 않았고 정확하다. 함께 버릴 이유가 없다. 이 경우 `consumeQuota`는 호출하지 않는다.

`analyses.classified_at`을 갱신한다. `transactions` 갱신은 일괄 처리하되, `owner_id` 조건을 쿼리에 함께 건다(RLS가 2차 방어지만 명시적으로).

## D-6. 테스트

Supabase·Anthropic·`quota`·`rules`를 모킹한다.

- 미인증 → 401
- 남의 `analysisId` → 404
- 익명 + `mode:'full'` → `anonymous_full_denied`, **AI 호출이 일어나지 않음**
- 익명 + `mode:'sample'` + `sample_used=true` → `sample_used`, AI 호출 없음
- free + 쿼터 소진 + `mode:'full'` → `quota_exceeded`, AI 호출 없음
- 규칙이 전건 매칭 → `fromAi === 0`, **AI 호출이 일어나지 않음**
- 규칙 일부 매칭 → AI에 넘어간 배열이 `unmatched`와 일치하는지
- AI 호출 실패 → `matched`는 저장되고 `consumeQuota`는 호출되지 않음
- 성공 → `consumeQuota` 1회 호출
- `is_user_edited=true`인 건이 대상에서 빠지는지
- `mode:'sample'`일 때 AI에 넘어간 건이 `SAMPLE_SIZE` 이하인지
- **규칙이 일부만 매칭된 상태에서** AI 결과가 올바른 거래 id에 저장되는지 (index 되짚기라면 여기서 어긋난다)
- `consumeQuota`/`markSampleUsed`가 테이블 직접 쓰기가 아니라 RPC를 타는지

---

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/rules src/lib/quota src/services/anthropic src/app/api
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "new RegExp\|RegExp(" src/lib/rules.ts` 가 비어 있는가?
   - `grep -rn "classifyPerMonth: [0-9]\|chatPerMonth: [0-9]" src/lib/quota.ts` 가 비어 있는가? (`tier.ts`에서 import해야 한다)
   - `grep -rn "usage_counters\|sample_used" src/lib/quota.ts` — 테이블을 직접 쓰는 코드가 없는가? (RPC만 호출해야 한다)
   - `supabase/migrations/`에 새 파일을 만들지 않았는가?
   - `grep -rn "redactRows" src/services/anthropic/classify.ts` 가 나오는가?
   - `grep -rn "cache_control" src/services/anthropic/prompt.ts` 가 나오는가?
   - `grep -rniE "경비 처리|손금|절세|가산세|신고하세요" src/services/anthropic/ src/app/api/` 가 비어 있는가?
   - 모델 ID가 `claude-opus-5`인가? `getClient`가 모듈 로드 시점에 `process.env`를 읽지 않는가?
   - `grep -n "FormData\|new File(" src/app/api/analyze/route.ts` 가 비어 있는가?
   - `grep -rn "anthropic" src/app/api/analyze/` 가 비어 있는가? (집계 API는 LLM을 부르지 않는다)
   - `owner_id`를 요청 본문에서 읽지 않는가? 응답에 `ok` 판별자가 있는가?
   - `checkQuota`/`checkSampleAllowance` 호출이 `classifyTransactions` 호출보다 **앞에** 있는가?
   - `consumeQuota`/`markSampleUsed`가 성공 경로에만 있는가?
   - `applyRules`가 `classifyTransactions`보다 앞에 있는가?
   - `mode`를 재판정 없이 그대로 쓰는 곳이 없는가?
   - `grep -rn "admin" src/app/api/` — service role 클라이언트를 쓰지 않는가?
   - 분류 결과를 배열 index가 아니라 `id`로 저장하는가?
   - `MAX_ROWS`·`SAMPLE_SIZE`·`CONFIDENCE_THRESHOLD`를 `src/types/tier.ts`에서 import 하는가? (하드코딩 금지)
3. 결과에 따라 `phases/0-mvp/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 두 관문의 공개 함수와 RPC 이름, anthropic 서비스의 공개 함수와 캐시 프리픽스 구성, 두 엔드포인트 경로와 관문 순서를 한 줄로
   - 수정 3회 시도 후에도 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- `merchant_pattern`을 정규식으로 해석하지 마라. 이유: 사용자가 입력한 문자열이며, `.*`가 들어오면 전건이 매칭돼 AI 분류가 통째로 무력화된다.
- 쿼터 숫자를 하드코딩하지 마라. 이유: `src/types/tier.ts`가 단일 출처이며, 어긋나면 결제한 사용자가 막힌다.
- 검사와 차감을 한 함수로 합치지 마라. 이유: AI 호출이 실패했는데 쿼터가 깎이면 사용자가 손해를 본다.
- 읽고-더하고-쓰는 방식으로 카운트를 증가시키지 마라. 이유: 동시 요청에서 카운트가 새어 나간다.
- `usage_counters`나 `profiles.sample_used`를 애플리케이션에서 직접 쓰려고 하지 마라. 이유: 이전 step이 의도적으로 RLS·컬럼 권한으로 막았다. 막혔다고 정책을 푸는 마이그레이션을 추가하면 쿼터 관문이 통째로 무너진다. RPC를 호출하라.
- 새 마이그레이션 파일을 만들지 마라. 이유: 필요한 함수 3개는 `0001_initial.sql`에 이미 있다.
- 마스킹을 거치지 않은 값을 SDK에 넘기지 마라. 이유: 가맹점명 필드에 성명·계좌번호가 섞여 들어오며, 그대로 국외로 나간다.
- `buildPromptBlocks`의 입력 타입을 `IdentifiedRow[]`로 완화하지 마라. 이유: 마스킹 누락을 컴파일 단계에서 막는 유일한 장치가 사라진다.
- 세무 판단·절세 조언을 프롬프트에 요구하거나 응답에 넣지 마라. 이유: 틀리면 사용자가 가산세를 문다. 분류와 계정과목까지만 한다.
- 합계·평균·증감률을 LLM에게 계산시키지 마라. 이유: 금액 계산은 코드가 한다. 두 개의 숫자가 생긴다.
- 자유 텍스트 응답을 파싱하지 마라. 이유: 형식이 흔들리면 전건이 깨진다. tool use로 스키마를 강제한다.
- 모델 응답을 검증 없이 저장하지 마라. 이유: 존재하지 않는 계정과목이 DB에 들어간다.
- 결과를 배열 index로 되짚지 마라. 이유: `applyRules`가 배열을 쪼갠 뒤라 index가 원본 거래를 가리키지 못하고, 엉뚱한 거래에 분류가 저장된다.
- 거래내역을 캐시 프리픽스 밖에 두지 마라. 이유: Q&A 질문마다 전체 내역이 재과금되어 유닛 이코노믹스가 무너진다.
- 제공자 추상화 인터페이스를 만들지 마라. 이유: 구현체가 하나뿐인 추상화는 비용만 있다(ADR-020).
- 원본 파일을 받지 마라. `FormData`·`File`·`Blob`을 쓰지 마라. 이유: 카드번호와 원본이 서버에 도달한다.
- `/api/analyze`에서 LLM을 호출하지 마라. 이유: 익명 사용자도 이 엔드포인트를 쓴다. 분류는 쿼터 검사를 거쳐 D에서 실행한다.
- 클라이언트가 보낸 집계·총액·`mode`·티어·잔여 횟수를 신뢰하지 마라. 이유: 우회하면 LLM 비용이 직접 발생하고, 화면 금액과 서버 기록이 어긋난다.
- `owner_id`를 요청 본문에서 읽지 마라. 이유: 남의 데이터로 삽입할 통로가 된다.
- 상한 초과 시 조용히 잘라내지 마라. 중복일 때 저장하고 나서 알리지 마라. 이유: 사용자가 일부만 분석된 줄 모르고, 이중 계상이 시계열을 망친다.
- 쿼터 검사 전에 AI를 호출하지 마라. AI 호출 전에 쿼터를 차감하지 마라.
- 이미 분류된 건이나 `is_user_edited=true`인 건을 재분류하지 마라. 이유: 사용자가 고친 값이 덮이고 비용이 중복 발생한다.
- 남의 분석에 403을 반환하지 마라. 이유: 403은 "존재하지만 권한 없음"을 알려준다. 404를 쓴다.
- service role 클라이언트를 쓰지 마라. 이유: 이 경로는 사용자 세션으로 RLS 아래서 동작해야 한다.
- 게이팅 실패 응답에 분류 결과를 담지 마라. 이유: 서버가 값을 보내지 않는 것이 유일한 게이팅 수단이다.
- 실제 Anthropic·Supabase에 접속하는 테스트를 쓰지 마라. 이유: 키가 없어 blocked가 되고 이후 step이 전부 멈춘다.
- UI를 만들지 마라. 이유: step6의 범위다.
- 기존 테스트를 깨뜨리지 마라.
