# Step 6: auth-session

## 읽어야 할 파일

- `/CLAUDE.md` — 인증 규칙
- `/docs/ARCHITECTURE.md` — "인증 — 두 개의 진입 경로" 절
- `/docs/ADR.md` — ADR-012
- `/src/lib/supabase/browser.ts`, `/src/lib/supabase/server.ts` (step5 산출물)
- `/src/types/domain.ts` (step1)

## 작업

인증 **인프라**를 만든다. 이 step이 여기 있는 이유: 다음 step(`analyze-api`)이 `auth.uid()`를 필요로 하고, 랜딩 업로드도 세션이 먼저 있어야 한다. 연결 플로우(Google)는 step8에서 한다.

### 1. `src/middleware.ts` — 세션 갱신

`@supabase/ssr`은 미들웨어에서 세션 쿠키를 갱신하는 것이 전제다. 이게 없으면 Server Component가 만료된 세션을 보게 된다.

```ts
export async function middleware(request: NextRequest): Promise<NextResponse>
export const config = { matcher: [/* 정적 자산·이미지·favicon 제외 */] }
```

- `createServerClient`로 쿠키를 읽고 `supabase.auth.getUser()`를 호출해 세션을 갱신한다
- 응답에 갱신된 쿠키를 반드시 다시 심는다
- **여기서 `signInAnonymously()`를 호출하지 마라.** 이유: 미들웨어는 모든 요청에 걸리므로 랜딩을 스쳐간 크롤러까지 계정을 만든다

**TDD 가드 주의**: `src/middleware.ts`는 테스트 선행 대상이다. `src/middleware.test.ts`를 먼저 작성하라. Supabase 클라이언트를 모킹하고, matcher가 정적 경로를 제외하는지와 쿠키가 응답에 실리는지를 검증한다.

### 2. `src/lib/supabase/auth.ts` — 경로 분기 판정

이 프로젝트의 인증 판정은 **전부 이 파일에서만** 한다. 다른 곳에 복제하지 마라.

```ts
export type AuthRoute = 'link' | 'signin'

/** 현재 세션이 익명이고 귀속되지 않은 결과를 들고 있으면 'link', 아니면 'signin' */
export function decideAuthRoute(params: {
  isAnonymous: boolean
  hasPendingAnalysis: boolean
}): AuthRoute

/** 파일 드롭 시점에 호출. 이미 세션이 있으면 아무것도 하지 않는다. */
export async function ensureSession(): Promise<{ userId: string; isAnonymous: boolean }>

/** 현재 사용자가 익명인지. user.is_anonymous 로 판정한다. */
export function isAnonymousUser(user: User | null): boolean
```

`decideAuthRoute`의 규칙:
- `isAnonymous && hasPendingAnalysis` → `'link'`
- 그 외 → `'signin'`

> 이 판정이 틀리면 사용자가 분석을 잃는다. 익명 세션에 결과가 있는데 `signInWithOAuth()`를 부르면 **새 계정이 만들어지고 uid가 버려진다.** 반드시 테스트로 고정하라.

`ensureSession`은 **파일 드롭 시점에만** 호출되도록 만든다. 이 함수 자체는 세션이 없을 때만 `signInAnonymously()`를 호출하고, 있으면 현재 세션을 반환한다.

### 3. `src/lib/supabase/session.ts` — 서버 측 헬퍼

```ts
/** 라우트 핸들러·Server Component에서 현재 사용자. 없으면 null */
export async function getCurrentUser(): Promise<User | null>

/** 없으면 401을 던지는 버전. 라우트 핸들러용 */
export async function requireUser(): Promise<User>

/** effective_plan DB 함수를 호출한다. 판정 로직을 여기서 다시 구현하지 마라. */
export async function getEffectivePlan(userId: string): Promise<Plan>
```

`getEffectivePlan`은 step5에서 만든 `public.effective_plan(uid)` 함수를 RPC로 호출한다. **`plan`과 `current_period_end`를 가져와 애플리케이션에서 비교하지 마라.** 이유: 판정이 두 곳에 존재하면 반드시 어긋난다.

### 테스트

Supabase 클라이언트를 모킹한다. 실제 서비스에 접속하지 마라.

- `decideAuthRoute` 네 조합 전부
- `ensureSession`이 기존 세션이 있을 때 `signInAnonymously`를 부르지 않는지
- `requireUser`가 미인증에서 던지는지
- `getEffectivePlan`이 RPC를 호출하는지 (직접 비교 로직이 없는지)

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/supabase src/middleware.test.ts
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "signInAnonymously" src/` 결과가 `src/lib/supabase/auth.ts`에만 나오는가? (미들웨어·layout·page에 있으면 위반)
   - `getEffectivePlan`이 RPC를 호출하고, `current_period_end`를 직접 비교하지 않는가?
   - 미들웨어가 응답에 갱신된 쿠키를 실어 보내는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 미들웨어·auth·session의 공개 함수를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 미들웨어나 layout/page에서 `signInAnonymously()`를 호출하지 마라. 이유: 랜딩을 스쳐간 방문자·크롤러까지 `auth.users` 행을 만든다. 파일 드롭 시점에만 만든다.
- `signInWithOAuth()`나 `linkIdentity()`를 여기서 구현하지 마라. 이유: step8의 범위다. 여기서는 **어느 쪽을 쓸지 판정하는 함수만** 만든다.
- 플랜 판정 로직(`plan === 'pro' && end > now()`)을 애플리케이션 코드로 다시 쓰지 마라. 이유: DB 함수와 어긋나는 순간 게이팅이 깨진다.
- 실제 Supabase에 접속하는 테스트를 쓰지 마라. 이유: 키가 없어 blocked가 되고 이후 step이 전부 멈춘다.
- UI를 만들지 마라. 이유: step9의 범위다.
- 기존 테스트를 깨뜨리지 마라.
