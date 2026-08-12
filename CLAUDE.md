# 프로젝트: FinSight

카드 명세서·거래 CSV/엑셀을 AI로 분석해주는 핀테크 SaaS.
기획은 `docs/PRD.md`, 구조는 `docs/ARCHITECTURE.md`, 결정 배경은 `docs/ADR.md`를 참조할 것.

## 기술 스택
- Next.js 16 (App Router) / React 19 — `next lint`는 없다. ESLint flat config(`eslint.config.mjs`) 사용
- TypeScript strict mode
- Tailwind CSS v4 — **CSS-first `@theme`**. `tailwind.config.js`를 만들지 마라
- Supabase (Auth + Postgres + RLS), `@supabase/ssr` — `auth-helpers`는 쓰지 마라
- Polar (구독 결제), `@polar-sh/sdk` + `@polar-sh/nextjs`
- Anthropic Claude API (`@anthropic-ai/sdk`), 모델 `claude-sonnet-5`
- 엑셀 파싱은 **ExcelJS**. `xlsx`(SheetJS) 패키지를 쓰지 마라. 이유: npm 배포가 0.18.5에서 멈춰 보안 수정본이 레지스트리에 없다
- 차트는 Recharts, 테스트는 Vitest(**node 환경 단일**)

## 아키텍처 규칙

### 데이터 무결성
- CRITICAL: 금액 계산은 전부 코드가 한다. 합계·평균·증감률을 LLM에게 계산시키지 마라. LLM에는 **이미 집계된 요약본**만 전달하고 해석·제안만 받는다
- CRITICAL: 금액은 정수(원 단위, `bigint`)로 다룬다. 통화에 부동소수점을 쓰지 마라. `parseFloat` 금지
- CRITICAL: 거래 원문을 LLM에 보내지 마라

### 보안
- CRITICAL: 사용자 데이터 테이블에는 예외 없이 RLS를 건다. SELECT뿐 아니라 **INSERT·UPDATE에 `WITH CHECK (owner_id = auth.uid())`** 를 반드시 건다
- CRITICAL: `owner_id`는 클라이언트가 보낸 값이 아니라 **서버가 `auth.uid()`에서 채운다**
- CRITICAL: service role 키는 **Polar 웹훅의 plan 갱신 한 곳에서만** 쓴다. 그 외 어디서도 쓰지 마라. RLS가 무력화된다
- CRITICAL: Pro 플랜 게이팅은 서버에서 판정한다. 클라이언트가 보낸 `plan` 값을 신뢰하지 마라
- CRITICAL: 잠긴 데이터는 **서버가 값을 보내지 않는 방식**으로 가린다. CSS 블러로 가리지 마라 — 개발자도구로 걷힌다
- 시크릿은 서버 전용 환경변수로만 읽는다. `NEXT_PUBLIC_` 접두사를 붙이지 마라
- 환경변수는 모듈 로드 시점이 아니라 **호출 시점**에 읽는다(`src/lib/env.ts`). 로드 시점에 읽으면 키 없는 환경에서 빌드가 깨진다
- 카드번호는 어떤 컬럼에도 저장하지 마라

### 데이터 흐름
- CRITICAL: 모든 서버 로직은 `src/app/api/` 라우트 핸들러 또는 Server Component에서 처리한다. 클라이언트 컴포넌트에서 외부 API(Claude, Polar)나 service role 클라이언트를 직접 호출하지 마라
- CRITICAL: **원본 파일을 서버로 보내지 마라.** 브라우저가 파싱한 정규화 거래 배열만 JSON으로 전송한다. 라우트 핸들러에서 `FormData`로 파일을 받지 마라
- 서버는 클라이언트가 계산한 집계를 신뢰하지 않는다. 배열을 검증한 뒤 **직접 재집계**한다
- 업로드 상한은 **10,000행 + 본문 크기 상한**. 클라이언트와 서버 양쪽에서 검사한다
- 읽기(목록·상세)는 Server Component에서 직접 조회한다. 그것만을 위한 API 라우트를 만들지 마라

### 인증
- CRITICAL: 익명 세션은 **파일 드롭 시점**에 만든다. 랜딩 방문만으로 `signInAnonymously()`를 호출하지 마라 — 구경꾼·크롤러까지 계정을 만든다
- CRITICAL: 익명 세션에 귀속되지 않은 결과가 있으면 `linkIdentity()`, 없으면 `signInWithOAuth()`. 결과가 있는데 `signInWithOAuth()`를 부르면 **uid가 버려져 사용자가 분석을 잃는다**
- 계정 자체는 삭제하지 않는다(앱 데이터 삭제 + 로그아웃만). 따라서 UI에 **"계정 삭제"라고 쓰지 마라.** "내 데이터 전체 삭제"로 표기한다

### 코드 배치
- 컴포넌트 `src/components/`, 타입 `src/types/`, 외부 API 래퍼 `src/services/`
- `src/lib/{ingest,mapping,analysis}/`는 I/O 없는 **순수 함수**로 작성한다. 브라우저·서버 양쪽에서 같은 코드가 돈다
- 색상은 Tailwind 테마 토큰으로만 쓴다. hex 값을 컴포넌트에 하드코딩하지 마라
- 라이트모드 고정. 다크모드 분기를 만들지 마라

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- TDD 가드 훅이 테스트 없는 구현 파일 작성을 차단한다. **`app/api/**/route.ts`와 `src/middleware.ts`도 테스트 선행 대상**이다(`types/`·`components/`·`page.tsx`는 면제)
- Stop 훅이 세션 종료 시 `npm run lint && npm run build && npm run test`를 실행한다. 셋 다 통과해야 세션이 끝난다
- 마이그레이션에 `DROP TABLE`을 쓰지 마라 (훅이 차단한다)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # Vitest
