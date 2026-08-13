# Step 12: identity-account

## 읽어야 할 파일

- `/CLAUDE.md` — 인증 규칙
- `/docs/ARCHITECTURE.md` — "인증 — 두 개의 진입 경로"
- `/docs/ADR.md` — ADR-016, ADR-018
- `/src/lib/supabase/auth.ts`, `/src/lib/supabase/session.ts`, `/src/middleware.ts` (step7 산출물 — `decideAuthRoute`를 반드시 읽어라)
- `/src/types/api.ts` (step1 — `OkResponse`)

## 작업

Google 계정 연결 플로우와 데이터 삭제를 구현한다. UI는 step13·15에서 붙이고, 여기서는 **동작하는 함수와 라우트**를 만든다.

### 1. 두 경로 (`src/lib/supabase/identity.ts`)

step7의 `decideAuthRoute`가 고른 경로를 실제로 수행한다.

```ts
/** 익명 세션의 결과를 유지한 채 Google을 연결한다. uid가 그대로 남는다. */
export async function linkGoogle(redirectTo: string): Promise<{ error?: LinkError }>

/** 기존 계정으로 진입한다. 재방문자 경로. */
export async function signInGoogle(redirectTo: string): Promise<void>

export type LinkError = 'already_linked' | 'identity_taken' | 'unknown'
```

- `linkGoogle` → `supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } })`
- `signInGoogle` → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`

> **익명 세션에 결과가 있을 때 `signInWithOAuth()`를 부르면 새 계정이 만들어져 uid가 버려지고 사용자가 분석을 잃는다.** 호출 전에 반드시 `decideAuthRoute`로 분기하라. 두 함수를 직접 호출하는 코드는 이 파일 밖에 두지 마라.

### 2. 실패 처리

`linkIdentity`가 실패해도 **현재 익명 세션과 그 결과는 그대로 남아야 한다.** 세션을 정리하거나 로그아웃시키지 마라.

이미 다른 계정에 연결된 Google이면 `identity_taken`을 반환하고, UI는 이렇게 안내한다:

> "이미 사용 중인 Google 계정입니다. 로그인 후 이 파일을 다시 올려 주세요."

기존 계정과의 **병합은 구현하지 않는다.** MVP 범위 밖이다.

### 3. OAuth 콜백 (`src/app/auth/callback/route.ts`)

`code`를 세션으로 교환하고 원래 위치로 돌려보낸다.

```ts
// GET /auth/callback?code=...&next=/dashboard
// exchangeCodeForSession(code) → redirect(next ?? '/dashboard')
// 실패 시 에러 쿼리를 달아 프리뷰로 돌려보낸다. 결과를 잃지 않게.
```

`next` 파라미터는 **같은 오리진의 경로만** 허용한다. 외부 URL을 그대로 리다이렉트하지 마라. 이유: 오픈 리다이렉트 취약점이 된다.

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다.

### 4. 데이터 삭제 (`src/app/api/account/route.ts`)

```ts
// DELETE /api/account → OkResponse
```

처리: `requireUser()` → 해당 사용자의 `analyses` 삭제(`transactions`는 `ON DELETE CASCADE`로 따라간다) → `user_rules`·`usage_counters` 삭제 → `profiles`의 `sample_used`를 포함한 앱 상태 초기화 → `signOut()`.

`profiles`의 `tier`·`polar_subscription_id`·`current_period_end`는 **건드리지 마라.** 이유: 구독은 Polar 쪽에 살아 있다. 여기서 지우면 결제한 사용자가 재로그인 시 free가 되고, 웹훅이 다시 올 때까지 복구되지 않는다.

**`auth.users`를 삭제하지 마라.** 이유: admin API가 필요한데 service role 사용을 웹훅 한 곳으로 제한했다. 계정 자체 삭제는 다음 phase다.

따라서 이 기능의 사용자 표기는 **"내 데이터 전체 삭제"** 다. 라우트 주석과 이후 UI 문구 모두 그렇게 쓴다.

> **UI에 "계정 삭제"라고 쓰지 마라.** 이유: 계정은 남는데 사용자가 사라졌다고 믿으면 그 자체가 신뢰 문제다. 금융 데이터에서는 특히 그렇다.

### 5. 분석 삭제 (`src/app/api/analyses/[id]/route.ts`)

```ts
// DELETE /api/analyses/:id → OkResponse
```

소유 확인 후 삭제. 남의 분석에는 404(403이 아니다).

### 테스트

Supabase 클라이언트를 모킹한다. 실제 OAuth를 수행하지 마라.

- `decideAuthRoute`가 `'link'`일 때 `linkIdentity`가, `'signin'`일 때 `signInWithOAuth`가 호출되는지
- `linkIdentity` 실패 시 `signOut`이 **호출되지 않는지** (결과 보존)
- `identity_taken` 매핑
- 콜백이 외부 URL `next`를 거부하는지
- `DELETE /api/account`가 미인증에서 401이고, 정상 시 `analyses` 삭제와 `signOut`을 호출하는지
- `DELETE /api/account`가 `profiles.tier`를 변경하지 **않는지**
- `DELETE /api/analyses/:id`가 남의 분석에 404를 반환하는지

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/supabase/identity src/app/auth src/app/api/account
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "linkIdentity\|signInWithOAuth" src/` 결과가 `src/lib/supabase/identity.ts`에만 나오는가?
   - `grep -rn "admin\|service_role" src/app/api/account/` 가 비어 있는가?
   - `grep -rniE "계정 삭제|계정을 삭제" src/` 가 비어 있는가?
   - 콜백이 `next`의 오리진을 검사하는가?
   - `auth.users` 삭제 호출이 없는가? (`grep -rn "admin.auth.deleteUser" src/`)
3. 결과에 따라 `phases/0-mvp/index.json`의 step 12를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 identity 함수 2개, 콜백 경로, 삭제 라우트 2개를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- `decideAuthRoute` 없이 `signInWithOAuth()`를 호출하지 마라. 이유: 익명 세션에 결과가 있으면 uid가 버려져 사용자가 분석을 잃는다.
- `linkIdentity` 실패 시 로그아웃시키지 마라. 이유: 사용자가 방금 올린 분석 결과까지 함께 사라진다.
- 기존 Google 계정과의 병합을 구현하지 마라. 이유: MVP 범위 밖이며, 잘못 구현하면 남의 데이터가 섞인다.
- `next`에 외부 URL을 허용하지 마라. 이유: 오픈 리다이렉트 취약점이 된다.
- `auth.users`를 삭제하지 마라. 이유: admin API가 필요한데 service role 사용을 웹훅 한 곳으로 제한했다.
- `DELETE /api/account`에서 `profiles.tier`·구독 필드를 지우지 마라. 이유: Polar에 구독이 살아 있는데 앱에서만 free가 되어 결제한 사용자가 막힌다.
- UI 문구나 주석에 "계정 삭제"라고 쓰지 마라. 이유: 계정은 남으며, 사용자가 사라졌다고 믿으면 신뢰 문제가 된다.
- UI를 만들지 마라. 이유: step13·15의 범위다.
- 실제 OAuth를 수행하는 테스트를 쓰지 마라. 이유: blocked가 되어 이후 step이 전부 멈춘다.
- 기존 테스트를 깨뜨리지 마라.
