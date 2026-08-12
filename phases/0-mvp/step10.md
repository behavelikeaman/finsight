# Step 10: insight-api

## 읽어야 할 파일

- `/CLAUDE.md` — 데이터 무결성 규칙
- `/docs/ARCHITECTURE.md` — 분석 파이프라인 2단계, 인사이트 kind 규칙
- `/docs/ADR.md` — ADR-004, ADR-005, ADR-010
- `/src/types/api.ts` (step1 — `InsightResponse`, `InsightContent`, `InsightKind`)
- `/src/types/analysis.ts` (step1 — `PeriodSummary`)
- `/src/lib/supabase/session.ts` (step6 — `requireUser`, `getEffectivePlan`)
- `/src/app/api/analyze/route.ts` (step7 — 저장 형태와 응답 관례를 맞춰라)

## 작업

Claude 래퍼와 인사이트 생성 라우트를 만든다. 파이프라인 2단계다.

### 1. `src/services/claude.ts`

```ts
export interface InsightInput {
  kind: InsightKind
  periods: PeriodSummary[]     // 이미 집계된 요약본만
}

export async function generateInsight(input: InsightInput): Promise<InsightContent>
```

모델은 `claude-sonnet-5`. API 키는 `src/lib/env.ts`를 통해 **호출 시점에** 읽는다.

**입력은 집계 요약본뿐이다.** `transactions` 원문을 프롬프트에 넣지 마라. 이유: (1) 개인 금융 원문의 외부 전송을 최소화하기로 했고, (2) 토큰 비용이 거래 건수에 비례해버리며, (3) LLM이 금액을 다시 계산하려 들면 틀린다.

프롬프트에 못박을 것:
- 금액을 **계산하지 말고** 주어진 숫자만 인용하라
- 한국어로 답하라
- 지정한 JSON 구조로만 답하라

`InsightContent` 구조(`headline`, `findings[]`, `suggestions[]`)로 구조화 출력을 받는다. 응답 파싱에 실패하면 명확한 에러를 던진다. 파싱 실패를 조용히 무시하고 빈 결과를 반환하지 마라.

**kind별 차이**
- `basic` — 이번 달 한정. 총액·상위 카테고리 요약과 짧은 제안
- `deep` — 기간 비교, 구독 누수 탐지, 이상 결제, 지출 증가 원인, 절감 제안

`etcRatio`가 0.4를 넘으면 분류 정확도가 낮다는 사실을 `findings`에 포함하도록 프롬프트에 지시한다.

**TDD 가드 주의**: `services/claude.ts`는 테스트 선행 대상이다. Anthropic SDK를 모킹하라. **실제 API를 호출하는 테스트를 쓰지 마라** — 키가 없어 blocked가 되고 이후 step이 전부 멈춘다.

### 2. `src/app/api/analyses/[id]/insight/route.ts`

```ts
// POST /api/analyses/:id/insight → InsightResponse
```

처리 순서:
```
1. requireUser()                     — 미인증 401
2. 분석 소유 확인                     — 없거나 남의 것이면 404 (403 아님)
3. getEffectivePlan(userId)
   └ kind = plan === 'pro' ? 'deep' : 'basic'      ← 서버가 정한다
4. 기존 insights(analysis_id, kind) 조회
   ├ status='ready'  → 그대로 반환 (재생성하지 않는다)
   └ status='failed' → 재시도한다
5. transactions 조회 → aggregateByPeriod로 집계 재계산
6. generateInsight({ kind, periods })
   ├ 성공 → insights upsert(status='ready', content) → 반환
   └ 실패 → insights upsert(status='failed', error_message) → { status:'failed' } 반환
```

**kind를 클라이언트가 고르게 하지 마라.** 요청 본문에 kind를 받지 마라. 이유: Free 사용자가 `deep`을 요청하면 Pro 기능이 새어나간다.

Pro로 전환하면 `deep`이 **새로 생성**된다. 기존 `basic` 행을 지우지 마라(`UNIQUE(analysis_id, kind)`이므로 둘이 공존한다).

**실패해도 집계는 살아남아야 한다.** LLM 오류로 500을 던지지 마라. `{ status:'failed', kind, error }`를 200으로 반환해 화면이 집계를 계속 보여주고 재시도 버튼을 띄울 수 있게 한다.

없는 분석에 404를 쓰는 이유: 403은 "그 id가 존재한다"는 정보를 노출한다.

### 테스트

- 미인증 → 401
- 남의 분석 → 404
- free → `basic`, pro → `deep`이 선택되는지
- 요청 본문에 `kind: 'deep'`을 넣어도 free면 `basic`이 나오는지
- 기존 `ready`가 있으면 `generateInsight`가 **호출되지 않는지**
- 기존 `failed`면 재시도하는지
- `generateInsight`가 던져도 응답이 200 `status:'failed'`인지
- 프롬프트 입력에 원문 거래가 들어가지 않는지

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/services src/app/api/analyses
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `generateInsight`의 입력 타입에 원문 거래 배열이 없는가?
   - kind를 요청 본문에서 읽지 않는가?
   - LLM 실패가 500이 아니라 200 + `status:'failed'`인가?
   - 실제 Anthropic API를 호출하는 테스트가 없는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 10을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 서비스 함수·라우트 경로·kind 결정 규칙을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 원문 거래를 프롬프트에 넣지 마라. 이유: 개인정보 노출, 토큰 비용 폭증, LLM 금액 오산.
- LLM에게 금액을 계산시키지 마라. 이유: 가계부 제품에서 합계 오류는 치명적이다.
- kind를 클라이언트가 지정하게 하지 마라. 이유: Free 사용자가 `deep`을 요청하면 Pro 기능이 새어나간다.
- LLM 실패 시 500을 던지지 마라. 이유: 집계까지 함께 사라져 사용자가 아무것도 못 본다.
- 실제 Anthropic API를 호출하는 테스트를 쓰지 마라. 이유: 키가 없어 blocked가 되고 이후 step이 멈춘다.
- 기존 `basic` 인사이트를 지우지 마라. 이유: `deep`과 공존하며, 지우면 다운그레이드 시 빈 화면이 된다.
- UI를 만들지 마라. 이유: step11의 범위다.
- 기존 테스트를 깨뜨리지 마라.
