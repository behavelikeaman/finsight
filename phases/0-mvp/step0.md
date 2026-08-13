# Step 0: project-setup

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/.env.example` (이미 존재한다. 덮어쓰지 마라)
- `/.gitignore` (이미 `.env*`를 무시한다. 건드리지 마라)

## 작업

빈 저장소에 Next.js 16 프로젝트를 스캐폴딩한다. **이 step의 유일한 목표는 `npm run lint && npm run build && npm run test` 세 커맨드가 전부 통과하는 상태를 만드는 것이다.** 기능 코드는 쓰지 않는다.

### 1. package.json

의존성:
- `next@^16` `react@^19` `react-dom@^19`
- `@supabase/supabase-js` `@supabase/ssr`
- `@anthropic-ai/sdk`
- `@polar-sh/sdk` `@polar-sh/nextjs`
- `exceljs`
- `recharts`
- `@vercel/analytics`

devDependencies:
- `typescript` `@types/node` `@types/react` `@types/react-dom`
- `tailwindcss@^4` `@tailwindcss/postcss` `postcss`
- `vitest` `vite-tsconfig-paths`
- `eslint` `@eslint/js` `typescript-eslint` `eslint-config-next`

scripts:
```json
"dev": "next dev",
"build": "next build",
"lint": "eslint .",
"test": "vitest run"
```

**`next lint`를 쓰지 마라.** 이유: Next 16에는 그 커맨드가 없다. 반드시 `eslint .`로 한다.

### 2. Vitest 설정 (`vitest.config.ts`)

```ts
// environment: 'node' 단일. jsdom을 설정하지 마라.
// passWithNoTests: true  ← 이게 없으면 테스트 0개일 때 실패하고,
//                           Stop 훅 때문에 이후 모든 step 세션이 종료하지 못한다.
// vite-tsconfig-paths 플러그인으로 @/* 별칭을 해석한다.
```

### 3. TypeScript (`tsconfig.json`)

`strict: true`, `noUncheckedIndexedAccess: true`, 경로 별칭 `"@/*": ["./src/*"]`.

`noUncheckedIndexedAccess`를 켜는 이유: 파일 파싱에서 배열 인덱싱이 잦고, 존재하지 않는 컬럼 접근을 컴파일 타임에 잡아야 한다.

### 4. Tailwind v4

**`tailwind.config.js`를 만들지 마라.** 이유: v4는 CSS-first 설정이라 config 파일이 필요 없고, 만들면 v3 관례와 섞여 혼란만 생긴다.

`src/app/globals.css`에:
```css
@import "tailwindcss";

@theme {
  /* 라이트모드 고정. 무채색 배경 + 포인트 컬러 1가지.
     추가로 분류 상태 3색 토큰을 정의한다: business / personal / review.
     색은 분류 상태에만 쓴다. 실제 색상값은 재량.
     단 모든 색은 여기 토큰으로만 정의한다. */
}
```

`postcss.config.mjs`에 `@tailwindcss/postcss` 플러그인을 등록한다.

### 5. ESLint flat config (`eslint.config.mjs`)

`@eslint/js` 권장 + `typescript-eslint` + `eslint-config-next`. `node_modules`, `.next`, `coverage`를 무시한다.

### 6. 최소 앱 구조

- `src/app/layout.tsx` — `globals.css` import, `<html lang="ko">`, `@vercel/analytics`의 `<Analytics />` 배치
- `src/app/page.tsx` — 플레이스홀더 한 줄. **랜딩 구현은 step13의 일이다. 여기서 만들지 마라**

### 7. `src/lib/env.ts`

서버 전용 환경변수를 **호출 시점에** 읽는 접근자.

```ts
export function serverEnv(key: ServerEnvKey): string
// 없으면 명확한 메시지와 함께 throw.
// 모듈 최상단에서 process.env를 읽지 마라.
// 이유: 로드 시점에 읽으면 키가 없는 CI/빌드 환경에서 빌드가 깨진다.
```

`ServerEnvKey`는 `.env.example`의 서버 전용 키 목록과 일치시킨다.

**TDD 가드 주의**: `src/lib/env.ts`는 테스트 선행 대상이다. `src/lib/env.test.ts`를 **먼저** 작성해야 Write가 차단되지 않는다. 테스트는 키가 있을 때 값을 반환하고 없을 때 throw하는 것을 검증한다.

## Acceptance Criteria

```bash
npm install
npm run lint
npm run build
npm run test
```

세 커맨드가 모두 exit 0이어야 한다.

## 검증 절차

1. 위 AC 커맨드를 순서대로 실행한다.
2. 아키텍처 체크리스트:
   - `tailwind.config.js`가 없는가?
   - `package.json`의 lint 스크립트가 `eslint .`인가?
   - `vitest.config.ts`에 `passWithNoTests: true`가 있는가?
   - `tsconfig.json`에 `noUncheckedIndexedAccess: true`가 있는가?
   - `src/lib/env.ts`가 모듈 최상단에서 `process.env`를 읽지 않는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 생성한 설정 파일 목록과 Next/Tailwind 버전을 한 줄로
   - 3회 시도 후에도 실패 → `"status": "error"`, `"error_message"`에 실패한 커맨드와 에러 출력
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason"` 기록 후 즉시 중단

## 금지사항

- `next lint`를 쓰지 마라. 이유: Next 16에 존재하지 않는 커맨드다.
- `tailwind.config.js`를 만들지 마라. 이유: Tailwind v4는 CSS-first이며 config 파일은 v3 관례다.
- `passWithNoTests`를 빼지 마라. 이유: 테스트가 0개인 상태에서 Stop 훅이 실패해 이후 모든 step이 종료 불가가 된다.
- `.env.example`과 `.gitignore`를 덮어쓰지 마라. 이유: 이미 검증된 내용이 들어 있다.
- 랜딩·대시보드·API 라우트를 만들지 마라. 이유: 각각 step13, step15, step8의 범위다.
- `xlsx` 패키지를 설치하지 마라. 이유: npm 배포가 0.18.5에서 멈춰 보안 수정본이 없다. ExcelJS를 쓴다.
- 기존 테스트를 깨뜨리지 마라.
