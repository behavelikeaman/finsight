# Step 12: polar-billing

## 읽어야 할 파일

- `/CLAUDE.md` — 보안 규칙, service role 사용 범위
- `/docs/ARCHITECTURE.md` — API 계약, `billing/sync`가 POST인 이유
- `/docs/ADR.md` — ADR-003, ADR-008
- `/docs/PRD.md` — 요금제 표
- `/src/types/api.ts` (step1 — `CheckoutRequest/Response`, `BillingSyncResponse`)
- `/src/lib/supabase/admin.ts` (step5 — service role. 여기서만 쓴다)
- `/src/lib/supabase/session.ts` (step6 — `requireUser`, `getEffectivePlan`)
- `/src/app/(app)/dashboard/page.tsx` (step11 — Pro CTA가 붙을 자리)

## 작업

Polar 구독 결제를 붙인다. `@polar-sh/sdk`(+ 필요 시 `@polar-sh/nextjs`)를 쓴다.

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
→ 활성 구독이면 profiles.plan='pro', current_period_end 갱신
→ { plan, currentPeriodEnd } 반환
```

> **이 엔드포인트가 없으면 "결제했는데 안 열려요"가 그대로 터진다.** 웹훅은 수 초~수 분 지연될 수 있고, 사용자는 리다이렉트 직후 화면을 본다. 웹훅만 믿고 기다리지 마라.

**GET으로 만들지 마라.** 이유: 상태를 변경하므로 프리페치·프리렌더가 호출하면 예기치 않게 실행된다.

### 4. `POST /api/webhooks/polar`

**서명 검증이 최우선이다.** `POLAR_WEBHOOK_SECRET`으로 검증하고, 실패하면 즉시 401을 반환하고 **아무 처리도 하지 마라.** 이유: 검증 없이 처리하면 누구나 자신을 Pro로 만들 수 있다.

처리할 이벤트: 구독 생성·갱신·취소·만료·결제 실패.

상태 반영은 **최신 상태를 그대로 쓰는 방식**으로 한다.
```
plan               = 구독이 활성이면 'pro', 아니면 'free'
current_period_end = 이벤트의 기간 종료 시각
polar_subscription_id / polar_customer_id 갱신
```

이렇게 하면 같은 이벤트를 여러 번 받아도 결과가 같다(멱등). 카운터를 증가시키거나 이벤트를 누적하는 처리를 넣지 마라 — 그 순간 중복 수신이 사고가 된다.

**여기가 service role을 쓰는 유일한 곳이다.** 웹훅에는 사용자 세션이 없으므로 `src/lib/supabase/admin.ts`를 쓴다. 다른 어떤 파일에서도 admin 클라이언트를 import하지 마라.

사용자 식별은 체크아웃 `metadata.userId` 또는 `polar_customer_id` 매칭으로 한다.

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다.

### 5. 해지·만료

취소 이벤트가 오면 즉시 `free`로 내리지 말고 `current_period_end`까지 `pro`를 유지한다. `effective_plan` DB 함수가 만료를 판정하므로, `current_period_end`만 정확히 넣으면 자동으로 처리된다.

### 6. 대시보드 연결

step11의 Pro CTA를 `POST /api/billing/checkout` → `url`로 이동하도록 연결한다. 결제 후 돌아오면 **`POST /api/billing/sync`를 먼저 호출한 뒤** 화면을 갱신한다.

### 테스트

- 서명이 틀린 웹훅 → 401이고 DB 갱신이 **일어나지 않는지**
- 같은 이벤트를 두 번 보내면 결과가 동일한지(멱등)
- 취소 이벤트가 `plan`을 즉시 `free`로 바꾸지 않고 `current_period_end`를 세팅하는지
- `sync`가 미인증에서 401인지
- `sync`가 Polar 응답으로 `profiles`를 갱신하는지
- `checkout`이 `metadata.userId`를 넣는지

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/services src/app/api/billing src/app/api/webhooks
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "admin" src/app/api/ --include=*.ts` 가 웹훅 라우트에서만 나오는가?
   - 서명 검증 실패 시 DB 접근 전에 반환하는가?
   - `billing/sync`가 POST인가?
   - 취소 시 즉시 `free`로 내리지 않는가?
   - 실제 Polar API를 호출하는 테스트가 없는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 12를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 세 라우트 경로와 멱등 처리 방식을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 서명 검증 없이 웹훅을 처리하지 마라. 이유: 누구나 자신을 Pro로 만들 수 있다.
- 웹훅에서 카운터 증가·이벤트 누적 같은 비멱등 처리를 하지 마라. 이유: 중복 수신이 사고가 된다. 최신 상태를 덮어쓰는 방식만 쓴다.
- `billing/sync`를 GET으로 만들지 마라. 이유: 상태를 변경하므로 프리페치가 호출한다.
- 결제 반영을 웹훅에만 의존하지 마라. 이유: 지연 동안 사용자가 Free로 보여 "결제했는데 안 열려요"가 발생한다.
- 웹훅 라우트 밖에서 service role 클라이언트를 쓰지 마라. 이유: RLS가 무력화된다.
- 취소 즉시 `plan='free'`로 내리지 마라. 이유: 사용자가 결제한 기간을 잃는다.
- 실제 Polar API를 호출하는 테스트를 쓰지 마라. 이유: 키가 없어 blocked가 되고 이후 step이 멈춘다.
- 기존 테스트를 깨뜨리지 마라.
