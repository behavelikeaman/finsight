# Step 7: billing-and-deploy

Polar 구독 결제를 붙이고, 배포 인수인계 문서를 만든 뒤 **이 step은 `blocked`로 종료한다.**

두 덩어리다: **A. Polar 결제**, **B. 배포 설정과 문서**. A를 끝내고 AC가 통과한 뒤 B로 넘어가라.

`blocked`가 정상 종료인 이유: 남은 작업이 전부 **사람만 할 수 있는 것**이다. Supabase 프로젝트 생성, 대시보드 토글, OAuth 클라이언트 등록, Polar 상품 생성, 실제 키 발급. 에이전트가 키 없이 진행하면 잘못된 값으로 배포 설정을 채우거나, 실패를 `error`로 잘못 보고한다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — 보안 규칙, service role 사용 범위
- `/docs/ARCHITECTURE.md` — API 계약, `billing/sync`가 POST인 이유
- `/docs/ADR.md` — ADR-005(Polar), ADR-017(서버 판정)
- `/docs/PRD.md` — 요금제 표
- `/src/types/api.ts`, `/src/types/tier.ts` — `CheckoutRequest/Response`, `BillingSyncResponse`, `QUOTA`
- `/src/lib/supabase/admin.ts` — service role. 여기서만 쓴다
- `/src/lib/supabase/session.ts` — `requireUser`, `getEffectiveTier`
- `/src/lib/env.ts` — 환경변수는 호출 시점에 읽는다
- `/src/app/(app)/dashboard/` — Pro CTA와 Pro 안내가 붙을 자리
- `/supabase/migrations/` — 적용해야 할 파일 목록
- `/.env.example`
- `/phases/0-mvp/index.json` — 앞선 step들의 `summary`

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

---

# A. Polar 결제

`@polar-sh/sdk`(+ 필요 시 `@polar-sh/nextjs`)를 쓴다.

> **먼저 확인할 것 (ADR-005의 미해결 항목)**: Polar가 (1) 한국 사업자 정산을 지원하는지, (2) 국내 발급 카드 결제가 통과하는지를 Polar 문서로 확인하라. 둘 중 하나라도 막히면 구현을 진행하지 말고 **`blocked`로 종료하고 `blocked_reason`에 근거와 URL을 적어라.** 이유: 결제가 안 되면 이 기능이 무의미해지며, 대안(토스페이먼츠)은 ADR을 뒤집는 결정이라 사용자가 판단해야 한다.

**TDD 가드 주의**: `src/services/polar.ts`와 각 `route.ts`는 테스트 선행 대상이다. Polar SDK와 Supabase를 모킹하라. **실제 Polar API를 호출하는 테스트를 쓰지 마라.**

## A-1. `src/services/polar.ts`

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

## A-2. `POST /api/billing/checkout`

`requireUser()` → `createCheckout()` → `{ url }` 반환. `successUrl`은 `NEXT_PUBLIC_SITE_URL` 기준의 대시보드 경로에 체크아웃 식별자를 붙인다.

## A-3. `POST /api/billing/sync` — 웹훅 지연 우회

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

`profiles.tier` 갱신은 사용자 UPDATE가 막혀 있으므로 이 라우트도 admin 클라이언트가 필요하다. **여기서 쓰는 admin 접근은 `tier`·`current_period_end`·`polar_*` 컬럼 갱신으로만 한정하라.** 다른 테이블을 admin으로 건드리지 마라.

## A-4. `POST /api/webhooks/polar`

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

## A-5. 해지·만료

취소 이벤트가 오면 즉시 `free`로 내리지 말고 `current_period_end`까지 `pro`를 유지한다. `effective_tier` DB 함수가 만료를 판정하므로, `current_period_end`만 정확히 넣으면 자동으로 처리된다.

**쿼터는 초기화하지 마라.** `usage_counters`는 기간(`YYYY-MM`) 단위이므로 티어가 바뀌어도 그대로 둔다. 한도만 `QUOTA[tier]`로 달라진다.

## A-6. 대시보드 연결

대시보드의 Pro CTA와 Q&A 패널의 Pro 안내를 `POST /api/billing/checkout` → `url`로 이동하도록 연결한다. 결제 후 돌아오면 **`POST /api/billing/sync`를 먼저 호출한 뒤** 화면을 갱신한다.

## A-7. 테스트

- 서명이 틀린 웹훅 → 401이고 **DB 갱신 호출이 일어나지 않는지**
- 같은 이벤트를 두 번 처리해도 결과가 같은지 (멱등)
- 취소 이벤트 → `tier`가 즉시 `free`가 되지 **않고** `current_period_end`가 유지되는지
- `billing/sync`가 미인증에서 401인지
- `billing/checkout`이 `metadata.userId`를 넣는지
- admin 클라이언트가 `profiles`의 지정 컬럼 외에 쓰이지 않는지

**중간 확인**: `npx vitest run src/services/polar src/app/api/billing src/app/api/webhooks` 통과 후 B로.

---

# B. 배포 설정과 인수인계 문서

여기서는 **기능 코드를 추가하지 않는다.** 설정과 문서만 다룬다.

## B-1. `README.md`

프로젝트 소개와 로컬 실행 절차. 명령어는 `npm run dev`·`build`·`lint`·`test`.

**제품 경계를 README에도 적는다**: 이 서비스는 세무 조언을 제공하지 않으며, 분류 결과는 참고용이다.

## B-2. `DEPLOY.md` — 인수인계 문서

사용자가 순서대로 따라 할 수 있는 체크리스트로 쓴다. 각 항목에 **왜 필요한지**를 한 줄씩 붙여라.

```
1. Supabase 프로젝트 생성
2. supabase/migrations/*.sql 을 파일명 순서대로 적용
   → 적용 후 Table Editor에서 usage_counters 의 정책이 SELECT 하나뿐인지 확인
     (INSERT/UPDATE 정책이 보이면 쿼터가 우회 가능한 상태다)
3. Supabase 대시보드 토글 (셋 다 켜지 않으면 플로우가 통째로 죽는다)
   - Authentication > Sign In/Up > Anonymous Sign-Ins   활성화
     → 파일 드롭 시점 세션 생성에 필요
   - Authentication > Sign In/Up > Manual Linking       활성화
     → linkIdentity()로 익명 결과를 유지한 채 계정 연결하는 데 필요
   - Authentication > Sign In/Up > Google               OAuth 클라이언트 등록
     → 리다이렉트 URL에 <사이트>/auth/callback 를 추가
4. Anthropic 콘솔에서 API 키 발급
5. Polar
   - 상품(Pro) 생성 → POLAR_PRO_PRODUCT_ID
   - 웹훅 엔드포인트 등록: <사이트>/api/webhooks/polar → POLAR_WEBHOOK_SECRET
   - sandbox에서 먼저 검증한 뒤 POLAR_SERVER=production
6. 호스팅에 .env.example 의 모든 키를 환경변수로 등록
   - NEXT_PUBLIC_ 접두사가 붙은 것만 클라이언트에 노출된다
   - SUPABASE_SERVICE_ROLE_KEY·ANTHROPIC_API_KEY·POLAR_* 는 서버 전용
7. 배포 후 스모크 테스트 (아래)
```

## B-3. 스모크 테스트 체크리스트

`DEPLOY.md`에 포함한다. 배포 직후 사람이 직접 확인할 항목이다.

```
[ ] 랜딩 접속 — auth.users 에 행이 생기지 않는다 (방문만으로 계정이 생기면 안 된다)
[ ] CSV 드롭 → 이 시점에 익명 세션이 생긴다
[ ] 컬럼 매핑이 자동으로 채워진다
[ ] 집계 프리뷰의 총액이 명세서 합계와 일치한다   ← 합계 행 제거가 됐는지 확인
[ ] 표본 20건 분류 결과가 보인다
[ ] 두 번째 파일 드롭 → 표본이 다시 실행되지 않는다 (sample_used)
[ ] Google 연결 → 분석 결과가 그대로 남아 있다   ← uid 유지 확인. 가장 중요
[ ] 전체 분류 실행 → 확인 필요 섹션이 상단에 뜬다
[ ] 분류 수정 + 규칙 저장 → 다음 분석에서 해당 가맹점이 AI 없이 분류된다
[ ] free 티어에서 Q&A 패널이 렌더되지 않는다 (CSS로 숨겨진 게 아니라)
[ ] Pro 결제 → 리다이렉트 직후 바로 Pro가 반영된다 (billing/sync)
[ ] 다른 계정으로 로그인 → 남의 분석이 보이지 않는다   ← RLS 확인
[ ] "내 데이터 전체 삭제" → 데이터가 지워지고 로그아웃된다
```

## B-4. 배포 설정 파일

호스팅 설정 파일(예: `vercel.json`)이 필요하면 최소한으로 만든다. Node 런타임 지정이 필요한 라우트가 있는지 확인한다 — ExcelJS는 브라우저에서만 쓰므로 서버 런타임 제약은 없어야 한다.

빌드 시점에 환경변수가 없어도 빌드가 통과해야 한다(`src/lib/env.ts`가 호출 시점 접근이므로 이미 그렇다). 확인만 하라.

## B-5. index.json 갱신

`phases/0-mvp/index.json`의 step 7을 다음과 같이 기록한다:

```json
{ "step": 7, "name": "billing-and-deploy", "status": "blocked",
  "blocked_reason": "외부 서비스 수동 설정 필요 — DEPLOY.md 참조. Supabase 프로젝트 생성/마이그레이션 적용/Anonymous Sign-Ins·Manual Linking·Google OAuth 활성화, Anthropic 키 발급, Polar 상품·웹훅 등록, 호스팅 환경변수 등록." }
```

---

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/services/polar src/app/api/billing src/app/api/webhooks
```

배포 자체는 검증 대상이 아니다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "supabase/admin" src/` 결과가 `api/webhooks/polar/`와 `api/billing/sync/`에만 나오는가?
   - 서명 검증이 이벤트 처리보다 **앞에** 있는가?
   - `billing/sync`가 POST인가?
   - `POLAR_ACCESS_TOKEN`·`POLAR_WEBHOOK_SECRET`을 모듈 로드 시점에 읽지 않는가?
   - 웹훅 처리가 멱등인가? (카운터 증가·이벤트 누적이 없는가)
   - 취소 시 `current_period_end`를 지우지 않는가?
3. 문서 체크리스트:
   - `DEPLOY.md`에 Supabase 대시보드 토글 3개가 전부 있는가?
   - `.env.example`의 모든 키가 `DEPLOY.md`의 어딘가에서 설명되는가?
   - 스모크 테스트에 "Google 연결 후 결과 유지" 항목이 있는가?
   - 스모크 테스트에 RLS 확인 항목이 있는가?
   - `README.md`에 세무 조언을 하지 않는다는 경계가 적혀 있는가?
4. `phases/0-mvp/index.json`의 step 7을 `"blocked"`로 기록하고 **즉시 중단한다.**
   - 단, **Polar 한국 정산·국내 카드 확인에 실패**했다면 A를 구현하지 말고 그 사유와 근거 URL을 `blocked_reason`에 적어 즉시 중단한다.

## 금지사항

- 서명 검증 없이 웹훅을 처리하지 마라. 이유: 누구나 요청을 보내 자신을 Pro로 만들 수 있다.
- admin 클라이언트를 웹훅·`billing/sync` 밖에서 쓰지 마라. 이유: RLS가 무력화되어 모든 사용자 데이터가 노출된다.
- admin으로 `profiles`의 구독 관련 컬럼 외를 건드리지 마라. 이유: 사용자 데이터 경로는 RLS 아래에 있어야 한다.
- `billing/sync`를 GET으로 만들지 마라. 이유: 상태를 변경하므로 프리페치·프리렌더가 호출한다.
- 웹훅에서 카운터를 증가시키거나 이벤트를 누적하지 마라. 이유: 중복 수신 시 결과가 달라져 사고가 된다.
- 취소 즉시 `free`로 내리지 마라. 이유: 사용자가 이미 낸 기간의 권리를 잃는다. `current_period_end`가 판정한다.
- 티어 변경 시 `usage_counters`를 초기화하지 마라. 이유: 다운그레이드→업그레이드를 반복해 쿼터를 무한히 얻는 통로가 된다.
- 클라이언트가 보낸 티어·결제 성공 여부를 신뢰하지 마라. 이유: 결제 없이 Pro가 된다.
- 실제 Supabase·Polar·Anthropic에 접속하지 마라. 이유: 키가 없다. 접속을 시도하면 재시도 루프에 빠져 3회 실패 후 `error`로 잘못 보고된다.
- 키를 추측해 채우거나 더미 값을 `.env`에 쓰지 마라. 이유: 배포 시 조용히 실패하고 원인을 찾기 어려워진다.
- 이 step을 `completed`로 표시하지 마라. 이유: 실제로 남은 작업이 있으며, `completed`로 두면 사용자가 배포 준비가 끝난 줄 안다.
- B에서 기능 코드를 추가하지 마라. 이유: 이 구간은 설정과 문서만 다룬다.
- `.env.example`을 덮어쓰지 마라. 이유: 이미 검증된 내용이며 `DEPLOY.md`가 이를 참조한다.
- 기존 테스트를 깨뜨리지 마라.
