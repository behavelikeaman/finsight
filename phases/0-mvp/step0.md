# Step 0: project-setup

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md`
- `/docs/PRD.md`

## 작업

Next.js 15 프로젝트를 저장소 루트에 생성하고, ARCHITECTURE.md의 디렉터리 골격을 만든다.

1. `npx create-next-app@latest . --typescript --tailwind --app --src-dir --eslint --no-turbopack --import-alias "@/*"` 로 프로젝트를 초기화한다. 저장소 루트에 이미 `CLAUDE.md`, `docs/`, `scripts/`, `phases/`, `.gitignore`가 있으므로 **이 파일들을 덮어쓰거나 삭제하지 마라.** create-next-app이 `.gitignore`를 덮어쓰려 하면 기존 내용(`phases/**/phase*-output.json` 등)을 보존한 뒤 Next.js 항목을 병합하라.

2. `tsconfig.json`에서 `strict: true`를 확인한다. 추가로 `noUncheckedIndexedAccess: true`를 켠다. 이유: CSV 파싱에서 배열 인덱싱이 잦고, 존재하지 않는 컬럼 접근을 컴파일 타임에 잡아야 한다.

3. Vitest를 설치하고 설정한다.
   - `vitest`, `@vitejs/plugin-react`, `jsdom` 설치
   - `vitest.config.ts` 작성 (`@/*` alias가 tsconfig와 동일하게 해석되도록)
   - `package.json`에 `"test": "vitest run"`, `"test:watch": "vitest"` 추가
   - 스모크 테스트 `src/lib/__tests__/smoke.test.ts` 하나를 작성해 러너가 동작함을 증명한다

4. ARCHITECTURE.md의 디렉터리 골격을 빈 상태로 생성한다. 각 디렉터리에 `.gitkeep`을 두어 커밋되게 하라.
   ```
   src/app/(marketing)/
   src/app/(app)/dashboard/
   src/app/try/
   src/app/api/
   src/components/
   src/types/
   src/lib/csv/
   src/services/
   ```

5. `.env.example`을 작성한다. 실제 값은 넣지 않는다.
   ```
   ANTHROPIC_API_KEY=
   NEXT_PUBLIC_SUPABASE_URL=
   NEXT_PUBLIC_SUPABASE_ANON_KEY=
   SUPABASE_SERVICE_ROLE_KEY=
   POLAR_ACCESS_TOKEN=
   POLAR_WEBHOOK_SECRET=
   ```

6. 기본 랜딩 페이지(`src/app/page.tsx`)는 create-next-app 기본값을 지우고 `FinSight` 제목만 있는 최소 페이지로 교체한다. 실제 랜딩은 step 10에서 만든다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 스모크 테스트 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - ARCHITECTURE.md 디렉터리 구조를 따르는가?
   - ADR 기술 스택(Next.js 15 App Router, TS strict, Tailwind)을 벗어나지 않았는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. `git status`로 `CLAUDE.md`, `docs/`, `scripts/`, `phases/`가 삭제되지 않았음을 확인한다.
4. 결과에 따라 `phases/0-mvp/index.json`의 step 0을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 루트의 `CLAUDE.md`, `docs/`, `scripts/`, `phases/`를 삭제하거나 덮어쓰지 마라. 이유: Harness 프레임워크의 실행 기반이며, 삭제되면 이후 step이 전부 실행 불가능해진다.
- 실제 API 키나 시크릿을 `.env.local` 또는 코드에 넣지 마라. 이유: 커밋 유출 위험. `.env.example`에는 빈 값만 둔다.
- 상태 관리 라이브러리(Redux, Zustand, Jotai 등)를 설치하지 마라. 이유: ARCHITECTURE.md에서 전역 상태 라이브러리를 도입하지 않기로 했다.
- UI 컴포넌트 라이브러리를 임의로 추가하지 마라. 이유: 디자인 방향이 PRD에 정의되어 있고, 의존성은 필요할 때 별도 결정한다.
- 아직 어떤 비즈니스 로직도 구현하지 마라. 이 step은 골격만 만든다.
