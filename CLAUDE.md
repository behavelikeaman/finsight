# 프로젝트: FinSight

카드 명세서(CSV/엑셀)를 올리면 AI가 거래별로 **사업경비/개인지출**을 갈라주는, 한국 프리랜서·1인 사업자용 SaaS.
기획은 `docs/PRD.md`, 구조는 `docs/ARCHITECTURE.md`, 결정 배경은 `docs/ADR.md`를 참조할 것.

## 기술 스택
- Next.js 16 (App Router) / React 19 — `next lint`는 없다. ESLint flat config(`eslint.config.mjs`) 사용
- TypeScript strict mode + `noUncheckedIndexedAccess`
- Tailwind CSS v4 — **CSS-first `@theme`**. `tailwind.config.js`를 만들지 마라
- Supabase (Auth + Postgres + RLS), `@supabase/ssr` — `auth-helpers`는 쓰지 마라
- Polar (구독 결제, Merchant of Record), `@polar-sh/sdk` + `@polar-sh/nextjs`
- Anthropic Claude API (`@anthropic-ai/sdk`), 모델 `claude-opus-5`
- 엑셀 파싱은 **ExcelJS**. `xlsx`(SheetJS) 패키지를 쓰지 마라. 이유: npm 배포가 0.18.5에서 멈춰 보안 수정본이 레지스트리에 없다
- 차트는 Recharts (보조 역할), 테스트는 Vitest(**node 환경 단일**)

## 아키텍처 규칙

### 제품 경계
- CRITICAL: **세무 조언을 생성하거나 표시하지 않는다.** "경비 처리 가능합니다", "한도를 초과했습니다" 같은 판단 문구는 프롬프트와 UI 양쪽에서 금지한다. 분류 결과에는 항상 "최종 판단은 세무 대리인과 상의" 고지를 함께 노출한다
- CRITICAL: 분류 결과에는 **확신도**를 함께 산출한다. 낮은 건은 "확인 필요"로 분리해 상단에 모은다. 확신도 없이 단정하지 마라

### 데이터 무결성
- CRITICAL: 금액 집계는 전부 코드가 한다. 합계·평균·증감률을 LLM에게 계산시키지 마라. LLM은 **거래별 분류 판단만** 한다
- CRITICAL: 금액은 정수(원 단위, `bigint`)로 다룬다. 통화에 부동소수점을 쓰지 마라. `parseFloat` 금지
- 서버는 클라이언트가 계산한 집계를 신뢰하지 않는다. 배열을 검증한 뒤 **직접 재집계**한다

### 보안
- CRITICAL: Anthropic·Polar 키는 `src/app/api/` 라우트 핸들러에서만 쓴다. 클라이언트 컴포넌트나 `NEXT_PUBLIC_*`로 절대 노출하지 마라
- CRITICAL: 외부 API로 나가는 거래 데이터는 예외 없이 `src/lib/redact.ts`를 거친다. 마스킹을 거치지 않은 값을 외부로 보내는 코드는 금지
- CRITICAL: 사용자 데이터 테이블에는 예외 없이 RLS를 건다. SELECT뿐 아니라 **INSERT·UPDATE에 `WITH CHECK (owner_id = auth.uid())`** 를 반드시 건다
- CRITICAL: `owner_id`는 클라이언트가 보낸 값이 아니라 **서버가 `auth.uid()`에서 채운다**
- CRITICAL: service role 키는 **Polar 웹훅의 tier 갱신 한 곳에서만** 쓴다. 그 외 어디서도 쓰지 마라. RLS가 무력화된다
- CRITICAL: 유료 기능 게이팅과 쿼터는 서버에서 판정한다. 클라이언트가 보낸 `tier`·잔여 횟수를 신뢰하지 마라
- CRITICAL: 잠긴 데이터는 **서버가 값을 보내지 않는 방식**으로 가린다. CSS 블러로 가리지 마라 — 개발자도구로 걷힌다
- 환경변수는 모듈 로드 시점이 아니라 **호출 시점**에 읽는다(`src/lib/env.ts`). 로드 시점에 읽으면 키 없는 환경에서 빌드가 깨진다
- 카드번호는 어떤 컬럼에도 저장하지 마라

### 비용 규칙
- CRITICAL: Anthropic 호출 시 거래내역은 **프롬프트 캐시 프리픽스**에 배치한다. 후속 Q&A가 매번 전체 내역을 재과금하면 유닛 이코노믹스가 무너진다
- CRITICAL: 모든 AI 호출은 `src/lib/quota.ts` 검사를 통과한 뒤 실행한다. 쿼터 검사 없는 호출 경로를 만들지 마라
- CRITICAL: `user_rules`에 매칭되는 거래는 AI로 보내지 않고 로컬에서 분류한다
- 익명 세션에서는 **표본 분류(상위 20건)만** 허용한다. 전건 분류를 익명에 열지 마라

### 데이터 흐름
- CRITICAL: **원본 파일을 서버로 보내지 마라.** 브라우저가 파싱한 정규화 거래 배열만 JSON으로 전송한다. 라우트 핸들러에서 `FormData`로 파일을 받지 마라
- CRITICAL: `/api/analyze`(집계)는 LLM을 호출하지 않는다. 분류는 `/api/analyses/:id/classify`에서만 한다
- 업로드 상한은 **10,000행 + 본문 크기 상한**. 클라이언트와 서버 양쪽에서 검사한다
- 읽기(목록·상세)는 Server Component에서 직접 조회한다. 그것만을 위한 API 라우트를 만들지 마라

### 인증
- CRITICAL: 익명 세션은 **파일 드롭 시점**에 만든다. 랜딩 방문만으로 `signInAnonymously()`를 호출하지 마라 — 구경꾼·크롤러까지 계정을 만든다
- CRITICAL: 익명 세션에 귀속되지 않은 결과가 있으면 `linkIdentity()`, 없으면 `signInWithOAuth()`. 결과가 있는데 `signInWithOAuth()`를 부르면 **uid가 버려져 사용자가 분석을 잃는다**
- 계정 자체는 삭제하지 않는다(앱 데이터 삭제 + 로그아웃만). 따라서 UI에 **"계정 삭제"라고 쓰지 마라.** "내 데이터 전체 삭제"로 표기한다

### 코드 배치
- 컴포넌트 `src/components/`, 타입 `src/types/`, 외부 API 래퍼 `src/services/`
- `src/lib/{ingest,mapping,analysis}/`와 `rules.ts`·`redact.ts`는 I/O 없는 **순수 함수**로 작성한다. 브라우저·서버 양쪽에서 같은 코드가 돈다
- 기본은 Server Component. 인터랙션이 필요한 곳만 `"use client"`
- 색상은 Tailwind 테마 토큰으로만 쓴다. hex 값을 컴포넌트에 하드코딩하지 마라
- 라이트모드 고정. 다크모드 분기를 만들지 마라
- 표 중심의 고밀도 레이아웃. 차트는 보조이며 주인공이 아니다

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
