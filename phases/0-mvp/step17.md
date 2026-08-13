# Step 17: polar-billing

## 읽어야 할 파일

- `/CLAUDE.md` — 보안 규칙, service role 사용 범위
- `/docs/ARCHITECTURE.md` — API 계약, `billing/sync`가 POST인 이유
- `/docs/ADR.md` — ADR-005(Polar), ADR-017(서버 판정)
- `/docs/PRD.md` — 요금제 표
- `/src/types/api.ts`, `/src/types/tier.ts` (step1 — `CheckoutRequest/Response`, `BillingSyncResponse`, `QUOTA`)
- `/src/lib/supabase/admin.ts` (step6 — service role. 여기서만 쓴다)
- `/src/lib/supabase/session.ts` (step7 — `requireUser`, `getEffectiveTier`)
- `/src/app/(app)/dashboard/page.tsx` (step15 — Pro CTA가 붙을 자리)

## 작업

Polar 구독 결제를 붙인다. `@polar-sh/sdk`(+ 필요 시 `@polar-sh/nextjs`)를 쓴다.

> **먼저 확인할 것 (ADR-005의 미해결 항목)**: Polar가 (1) 한국 사업자 정산을 지원하는지, (2) 국내 발급 카드 결제가 통과하는지를 Polar 문서로 확인하라. 둘 중 하나라도 막히면 구현을 진행하지 말고 **`blocked`로 종료하고 `blocked_reason`에 근거를 적어라.** 이유: 결제가 안 되면 이 phase 전체가 무의미해지며, 대안(토스페이먼츠)은 ADR을 뒤집는 결정이라 사용자가 판단해야 한다.

### 1. `src/services/polar.ts`

```ts
export async function createCheckout(params: {
  userId: string; email?: string; successUrl: string
}): Promise<{ url: string }>

export async function fetchSubscription(subscriptionId: string): Promise<{
  status: string; currentPeriodEnd: string | null
}>

export async function fetchCustomerSubscription(customerId: string): Promise<{
  subscriptionId: string; status: string; currentPeriodEnd: string | null
} | null>
```

토큰·상품 ID는 `src/lib/env.ts`로 **호출 시점에** 읽는다. `POLAR_SERVER`로 sandbox/production을 가른다.

체크아웃 생성 시 `metadata`에 `userId`를 넣는다. 이유: 웹훅이 어느 사용자인지 알아야 한다.

**TDD 가드 주의**: 테스트 선행 대상이다. Polar SDK를 모킹하라. **실제 Polar API를 호출하는 테스트를 쓰지 마라.**

### 2. `POST /api/billing/checkout`

`requireUser()` → `createCheckout()` → `{ url }` 반환. `successUrl`은 `NEXT_PUBLIC_SITE_URL` 기준의 대시보드 경로에 체크아웃 식별자를 붙인다.

### 3. `POST /api/billing/sync` — 웹훅 지연 우회

결제 성공 리다이렉트 직후 클라이언트가 호출한다.

```
requireUser()
→ profiles.polar_customer_id / polar_subscription_id 조회
→ Polar에 직접 조회 (fetchSubscription / fetchCustomerSubscription)
→ 활성 구독이면 profiles.tier='pro', current_period_end 갱신
→ { tier, currentPeriodEnd } 반환
```

> **이 엔드포인트가 없으면 "결제했는데 안 열려요"가 그대로 터진다.** 웹훅은 수 초~수 분 지연될 수 있고, 사용자는 리다이렉트 직후 화면을 본다. 웹훅만 믿고 기다리지 마라.

**GET으로 만들지 마라.** 이유: 상태를 변경하므로 프리페치·프리렌더가 호출하면 예기치 않게 실행된다.

`profiles.tier` 갱신은 step6에서 사용자 UPDATE를 막아뒀으므로 이 라우트도 admin 클라이언트가 필요하다. **여기서 쓰는 admin 접근은 `tier`·`current_period_end`·`polar_*` 컬럼 갱신으로만 한정하라.** 다른 테이블을 admin으로 건드리지 마라.

### 4. `POST /api/webhooks/polar`

**서명 검증이 최우선이다.** `POLAR_WEBHOOK_SECRET`으로 검증하고, 실패하면 즉시 401을 반환하고 **아무 처리도 하지 마라.** 이유: 검증 없이 처리하면 누구나 자신을 Pro로 만들 수 있다.

처리할 이벤트: 구독 생성·갱신·취소·만료·결제 실패.

상태 반영은 **최신 상태를 그대로 쓰는 방식**으로 한다.
```
tier               = 구독이 활성이면 'pro', 아니면 'free'
current_period_end = 이벤트의 기간 종료 시각
polar_subscription_id / polar_customer_id 갱신
```

이렇게 하면 같은 이벤트를 여러 번 받아도 결과가 같다(멱등). 카운터를 증가시키거나 이벤트를 누적하는 처리를 넣지 마라 — 그 순간 중복 수신이 사고가 된다.

**여기가 service role의 주 사용처다.** 웹훅에는 사용자 세션이 없으므로 `src/lib/supabase/admin.ts`를 쓴다. 이 라우트와 `billing/sync` 외의 어떤 파일에서도 admin 클라이언트를 import하지 마라.

사용자 식별은 체크아웃 `metadata.userId` 또는 `polar_customer_id` 매칭으로 한다.

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다.

### 5. 해지·만료

취소 이벤트가 오면 즉시 `free`로 내리지 말고 `current_period_end`까지 `pro`를 유지한다. `effective_tier` DB 함수가 만료를 판정하므로, `current_period_end`만 정확히 넣으면 자동으로 처리된다.

**쿼터는 초기화하지 마라.** `usage_counters`는 기간(`YYYY-MM`) 단위이므로 티어가 바뀌어도 그대로 둔다. 한도만 `QUOTA[tier]`로 달라진다.

### 6. 대시보드 연결

step15의 Pro CTA와 step16의 Pro 안내를 `POST /api/billing/checkout` → `url`로 이동하도록 연결한다. 결제 후 돌아오면 **`POST /api/billing/sync`를 먼저 호출한 뒤** 화면을 갱신한다.

### 테스트

Polar SDK와 Supabase를 모킹한다. 실제 API를 호출하지 마라.

- 서명이 틀린 웹훅 → 401이고 **DB 갱신 호출이 일어나지 않는지**
- 같은 이벤트를 두 번 처리해도 결과가 같은지 (멱등)
- 취소 이벤트 → `tier`가 즉시 `free`가 되지 **않고** `current_period_end`가 유지되는지
- `billing/sync`가 미인증에서 401인지
- `billing/checkout`이 `metadata.userId`를 넣는지
- admin 클라이언트가 `profiles`의 지정 컬럼 외에 쓰이지 않는지

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/services/polar src/app/api/billing src/app/api/webhooks
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "supabase/admin" src/` 결과가 `api/webhooks/polar/`와 `api/billing/sync/`에만 나오는가?
   - 서명 검증이 이벤트 처리보다 **앞에** 있는가?
   - `billing/sync`가 POST인가?
   - `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`을 모듈 로드 시점에 읽지 않는가?
   - 웹훅 처리가 멱등인가? (카운터 증가·이벤트 누적이 없는가)
   - 취소 시 `current_period_end`를 지우지 않는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 17을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 라우트 3개, service role 사용처, 멱등 처리 방식을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - **Polar 한국 정산·국내 카드 확인 실패** → `"status": "blocked"` + `"blocked_reason"`에 확인한 내용과 근거 URL을 적고 즉시 중단

## 금지사항

- 서명 검증 없이 웹훅을 처리하지 마라. 이유: 누구나 요청을 보내 자신을 Pro로 만들 수 있다.
- admin 클라이언트를 웹훅·`billing/sync` 밖에서 쓰지 마라. 이유: RLS가 무력화되어 모든 사용자 데이터가 노출된다.
- admin으로 `profiles`의 구독 관련 컬럼 외를 건드리지 마라. 이유: 사용자 데이터 경로는 RLS 아래에 있어야 한다.
- `billing/sync`를 GET으로 만들지 마라. 이유: 상태를 변경하므로 프리페치·프리렌더가 호출한다.
- 웹훅에서 카운터를 증가시키거나 이벤트를 누적하지 마라. 이유: 중복 수신 시 결과가 달라져 사고가 된다.
- 취소 즉시 `free`로 내리지 마라. 이유: 사용자가 이미 낸 기간의 권리를 잃는다. `current_period_end`가 판정한다.
- 티어 변경 시 `usage_counters`를 초기화하지 마라. 이유: 다운그레이드→업그레이드를 반복해 쿼터를 무한히 얻는 통로가 된다.
- 클라이언트가 보낸 티어·결제 성공 여부를 신뢰하지 마라. 이유: 결제 없이 Pro가 된다.
- 실제 Polar API를 호출하는 테스트를 쓰지 마라. 이유: 키가 없어 blocked가 되고 이후 step이 멈춘다.
- 기존 테스트를 깨뜨리지 마라.
