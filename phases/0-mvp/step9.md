# Step 9: auth

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` (디렉터리 구조)
- `/docs/ADR.md`
- `/src/services/supabase/` 전체 (step 5)
- `/supabase/migrations/0001_initial.sql` (profiles 테이블)
- `/src/app/api/classify/route.ts` (step 8 — 세션 판별 방식을 맞춘다)

## 작업

Supabase Auth 기반 구글 로그인을 붙인다. 카카오는 이 phase 범위 밖이다 (검수 리드타임 때문에 나중에 추가).

### 미들웨어

`src/middleware.ts`에 `@supabase/ssr`의 세션 갱신 미들웨어를 구현한다.

보호 대상: `/dashboard/**`. 미인증 접근 시 `/login`으로 리다이렉트하되 `?next=` 파라미터에 원래 경로를 담는다.

**`/try`와 `/api/parse`, `/api/classify`는 보호하지 마라.** 이유: ADR-012의 익명 체험이 이 경로들을 통과한다. 미들웨어에서 막으면 체험 흐름이 통째로 죽는다.

`?next=` 값은 **내부 경로인지 검증**하라. `//evil.com`이나 절대 URL이 들어오면 무시하고 `/dashboard`로 보낸다. 이유: open redirect 취약점.

### 로그인 페이지

`src/app/login/page.tsx`. 구글 버튼 하나와 서비스 설명 한 줄만 있는 최소 화면.

`signInWithOAuth({ provider: "google", options: { redirectTo } })`를 쓴다.

### 콜백 라우트

`src/app/auth/callback/route.ts`. OAuth 코드를 세션으로 교환하고, `profiles` 행이 없으면 생성한 뒤(`tier: "free"`) `?next=` 또는 `/dashboard`로 리다이렉트한다.

profiles 생성은 `on conflict (id) do nothing`으로 멱등하게 만들어라. 이유: 콜백이 중복 호출되거나 새로고침될 수 있다.

DB 트리거로 처리하지 말고 콜백에서 명시적으로 만들어라 — 트리거는 마이그레이션 적용 순서에 의존해 디버깅이 어렵다.

### 로그아웃

`src/app/auth/signout/route.ts`. `POST`만 받는다. `GET`으로 로그아웃을 만들지 마라 — 링크 프리페치나 CSRF로 의도치 않게 세션이 끊긴다.

### 세션 헬퍼

`src/lib/session.ts`:

```ts
export async function getCurrentUser(): Promise<{ id: string; tier: Tier } | null>;
export async function requireUser(): Promise<{ id: string; tier: Tier }>;
```

`requireUser`는 미인증 시 리다이렉트한다. Server Component에서 쓴다.

step 8의 classify 라우트가 세션을 직접 읽고 있다면 이 헬퍼를 쓰도록 리팩터링하라. 단, **동작을 바꾸지 마라** — 익명 허용 경로는 그대로 익명을 허용해야 한다.

### 최소 대시보드 골격

`src/app/(app)/dashboard/page.tsx`에 "로그인됨: {email}"과 로그아웃 버튼만 있는 자리표시 페이지를 만든다. 실제 대시보드는 다음 phase에서 만든다.

### 테스트

`src/lib/__tests__/session.test.ts`, 미들웨어 리다이렉트 테스트.

필수 케이스:
- `?next=//evil.com`이 무시되고 `/dashboard`로 가는지 (open redirect 회귀)
- `/try`가 미인증으로 접근 가능한지 (익명 체험 회귀)
- `/dashboard`가 미인증 시 `/login`으로 가는지
- profiles 생성이 멱등한지

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 신규 테스트 포함 전부 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `/try`, `/api/parse`, `/api/classify`가 미들웨어에 막히지 않는가?
   - `?next=` 검증이 있는가?
   - 로그아웃이 POST 전용인가?
   - anon 키만 클라이언트에 노출되고 service role 키는 서버에만 있는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 9를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (Supabase 대시보드에서 구글 OAuth provider 설정, GCP 클라이언트 ID 발급) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `/try`, `/api/parse`, `/api/classify`를 인증 필수로 만들지 마라. 이유: ADR-012의 익명 체험이 죽는다.
- `?next=` 값을 검증 없이 리다이렉트에 쓰지 마라. 이유: open redirect 취약점.
- 로그아웃을 GET으로 만들지 마라.
- 카카오 로그인을 추가하지 마라. 이 phase 범위 밖이다.
- 실제 대시보드 UI를 만들지 마라. 자리표시 페이지만.
- DB 트리거로 profiles를 생성하지 마라. 콜백에서 명시적으로 처리한다.
- 기존 테스트를 깨뜨리지 마라
