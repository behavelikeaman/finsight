# Step 9: rules-and-quota

## 읽어야 할 파일

- `/CLAUDE.md` — 비용 규칙 절
- `/docs/ADR.md` — ADR-012(규칙 학습), ADR-013(쿼터), ADR-015(표본), ADR-017(서버 판정)
- `/src/types/domain.ts`, `/src/types/analysis.ts`, `/src/types/tier.ts` (step1 — `QUOTA`, `SAMPLE_SIZE`)
- `/src/types/db.ts` (step1 — `user_rules`, `usage_counters` 행 타입)
- `/src/lib/supabase/session.ts` (step7 — `getEffectiveTier`)
- `/supabase/migrations/0001_initial.sql` (step6)

## 작업

AI 호출 앞에 세울 **두 개의 관문**을 만든다. 이 step에서는 분류 API를 건드리지 않는다 — 관문만 만들고, 연결은 step11에서 한다.

### 1. `src/lib/rules.ts` — 규칙 선적용 (순수 함수)

```ts
export interface RuleMatch {
  row: NormalizedRow
  classification: Classification
  accountCode: AccountCode | null
  ruleId: string
}

export interface RuleApplyResult {
  matched: RuleMatch[]     // 규칙이 결정한 건. AI로 보내지 않는다
  unmatched: NormalizedRow[]  // AI로 보낼 건
}

export function applyRules(rows: NormalizedRow[], rules: UserRuleRow[]): RuleApplyResult

/** 사용자가 고친 거래에서 규칙 패턴을 뽑는다. */
export function derivePattern(merchant: string): string
```

**매칭 규칙**: `merchant_pattern`을 정규화(공백 제거, 소문자화)한 뒤 가맹점명에 **부분 문자열로 포함**되면 매칭. 정규식을 쓰지 마라 — 사용자가 입력한 문자열이 정규식으로 해석되면 오작동하고, `.*`가 들어오면 전건이 매칭된다.

패턴이 여러 개 걸리면 **가장 긴 패턴이 이긴다.** 이유: `스타벅스`와 `스타벅스 강남점`이 둘 다 있으면 구체적인 쪽이 사용자의 최근 의도다.

`derivePattern`은 가맹점명에서 지점·번호 꼬리를 떼어 재사용 가능한 패턴을 만든다(`스타벅스 강남점` → `스타벅스`). 다만 원본이 짧으면(4자 이하) 그대로 쓴다. 이유: 과하게 일반화한 패턴은 무관한 거래까지 잡는다.

`applyRules`는 **I/O가 없다.** 규칙 조회는 호출부(step11)가 하고, 여기에는 배열로 넘긴다.

> 이 관문이 원가 구조의 핵심이다. 규칙에 걸린 거래는 AI로 나가지 않으므로, 재방문 사용자일수록 호출 건수가 줄어든다.

### 2. `src/lib/quota.ts` — 사용량 검사

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

한도는 `src/types/tier.ts`의 `QUOTA`에서 읽는다. **숫자를 하드코딩하지 마라.** 이유: 랜딩의 요금제 표(step13)와 어긋나면 사용자가 결제하고도 막힌다.

`free` 티어의 `chatPerMonth`가 0이므로, `kind: 'chat'`이고 티어가 free면 `reason: 'tier_required'`를 반환한다(쿼터 소진이 아니라 등급 문제다). 이유: UI가 "이번 달 다 썼습니다"와 "Pro 기능입니다"를 다르게 안내해야 한다.

**검사와 차감을 분리하는 이유**: AI 호출이 실패했을 때 쿼터를 먹으면 안 된다. `checkQuota` → 호출 → 성공 시에만 `consumeQuota`.

`consumeQuota`는 `usage_counters`에 upsert하며 **원자적으로 증가**시켜야 한다. Postgres 함수(`increment_usage(uid, period, kind)`)를 `supabase/migrations/0002_usage.sql`에 추가하고 RPC로 부른다. 애플리케이션에서 읽고-더하고-쓰지 마라 — 동시 요청에서 카운트가 새어 나간다.

기간(`period`)은 서버 시각 기준 `YYYY-MM`이다. 클라이언트가 보낸 값을 쓰지 마라.

### 테스트

- `applyRules`: 부분 문자열 매칭, 가장 긴 패턴 우선, 매칭된 건이 `unmatched`에 없는지, 빈 규칙 배열
- `applyRules`: `merchant_pattern`에 `.*`나 `[a-z]+`가 들어와도 정규식으로 해석되지 않는지
- `derivePattern`: 지점 꼬리 제거, 짧은 이름은 그대로
- `checkQuota`: free/pro 각각의 한도 경계, chat + free → `tier_required`
- `consumeQuota`: RPC를 호출하는지 (읽고-쓰기 패턴이 아닌지)
- `checkSampleAllowance`: `sample_used`가 true면 false 반환

Supabase는 모킹한다. 실제 DB에 접속하지 마라.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/rules src/lib/quota
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "new RegExp\|RegExp(" src/lib/rules.ts` 가 비어 있는가?
   - `grep -rn "classifyPerMonth: [0-9]\|chatPerMonth: [0-9]" src/lib/quota.ts` 가 비어 있는가? (`tier.ts`에서 import해야 한다)
   - `applyRules`가 I/O 없는 순수 함수인가?
   - `consumeQuota`가 RPC를 호출하는가?
   - Anthropic 호출이 없는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 9를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 두 모듈의 공개 함수와 추가한 마이그레이션 파일명을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- `merchant_pattern`을 정규식으로 해석하지 마라. 이유: 사용자가 입력한 문자열이며, `.*`가 들어오면 전건이 매칭돼 AI 분류가 통째로 무력화된다.
- 쿼터 숫자를 하드코딩하지 마라. 이유: `src/types/tier.ts`가 단일 출처이며, 어긋나면 결제한 사용자가 막힌다.
- 검사와 차감을 한 함수로 합치지 마라. 이유: AI 호출이 실패했는데 쿼터가 깎이면 사용자가 손해를 본다.
- 읽고-더하고-쓰는 방식으로 카운트를 증가시키지 마라. 이유: 동시 요청에서 카운트가 새어 나가 무료 사용자가 여러 번 호출한다.
- 클라이언트가 보낸 기간·티어·잔여 횟수를 신뢰하지 마라. 이유: 우회하면 LLM 비용이 직접 발생한다.
- Anthropic을 호출하지 마라. 이유: 이 step은 관문만 만든다. 연결은 step11이다.
- 라우트 핸들러를 만들지 마라. 이유: step11의 범위다.
- 기존 테스트를 깨뜨리지 마라.
