# Step 8: identity-account

## 읽어야 할 파일

- `/CLAUDE.md` — 인증 규칙
- `/docs/ARCHITECTURE.md` — "인증 — 두 개의 진입 경로"
- `/docs/ADR.md` — ADR-012, ADR-013
- `/src/lib/supabase/auth.ts`, `/src/lib/supabase/session.ts`, `/src/middleware.ts` (step6 산출물 — `decideAuthRoute`를 반드시 읽어라)
- `/src/types/api.ts` (step1 — `OkResponse`)

## 작업

Google 계정 연결 플로우와 데이터 삭제를 구현한다. UI는 step9·11에서 붙이고, 여기서는 **동작하는 함수와 라우트**를 만든다.

### 1. 두 경로 (`src/lib/supabase/identity.ts`)

step6의 `decideAuthRoute`가 고른 경로를 실제로 수행한다.

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

처리: `requireUser()` → 해당 사용자의 `analyses` 삭제(`transactions`·`insights`는 `ON DELETE CASCADE`로 따라간다) → `profiles` 초기화 또는 삭제 → `signOut()`.

**`auth.users`를 삭제하지 마라.** 이유: admin API가 필요한데 service role 사용을 웹훅 한 곳으로 제한했다. 계정 자체 삭제는 다음 phase다.

따라서 이 기능의 사용자 표기는 **"내 데이터 전체 삭제"** 다. 라우트 주석과 이후 UI 문구 모두 그렇게 쓴다.

> **UI에 "계정 삭제"라고 쓰지 마라.** 이유: 계정은 남는데 사용자가 사라졌다고 믿으면 그 자체가 신뢰 문제다. 금융 데이터에서는 특히 그렇다.

### 테스트

Supabase 클라이언트를 모킹한다. 실제 OAuth를 수행하지 마라.

- `decideAuthRoute`가 `'link'`일 때 `linkIdentity`가, `'signin'`일 때 `signInWithOAuth`가 호출되는지
- `linkIdentity` 실패 시 `signOut`이 **호출되지 않는지** (결과 보존)
- `identity_taken` 매핑
- 콜백이 외부 URL `next`를 거부하는지
- `DELETE /api/account`가 미인증에서 401이고, 정상 시 `analyses` 삭제와 `signOut`을 호출하는지
- `DELETE /api/account`가 `auth.admin.deleteUser`를 **호출하지 않는지**

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/supabase src/app/auth src/app/api/account
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "linkIdentity\|signInWithOAuth" src/` 가 `src/lib/supabase/identity.ts`에만 나오는가?
   - `grep -rn "admin.deleteUser" src/` 가 비어 있는가?
   - `grep -rn "계정 삭제" src/` 가 비어 있는가?
   - 콜백이 `next`를 같은 오리진으로 제한하는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 8을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 `linkGoogle`/`signInGoogle`/콜백/삭제 라우트 경로를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 익명 세션에 결과가 있는데 `signInWithOAuth()`를 부르지 마라. 이유: 새 계정이 생겨 uid가 버려지고 사용자가 분석을 잃는다.
- 연결 실패 시 로그아웃하거나 세션을 정리하지 마라. 이유: 사용자가 방금 만든 결과를 잃는다.
- 기존 Google 계정과의 병합을 구현하지 마라. 이유: MVP 범위 밖이며, 잘못 만들면 데이터가 섞인다.
- `auth.admin.deleteUser`를 쓰지 마라. 이유: service role 사용을 웹훅 한 곳으로 제한했다.
- UI 문구나 주석에 "계정 삭제"라고 쓰지 마라. 이유: 실제로는 데이터만 지워지므로 사용자를 오해시킨다.
- 콜백의 `next`를 검증 없이 리다이렉트하지 마라. 이유: 오픈 리다이렉트 취약점이 된다.
- 랜딩·대시보드 UI를 만들지 마라. 이유: step9·11의 범위다.
- 기존 테스트를 깨뜨리지 마라.
