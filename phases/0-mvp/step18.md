# Step 18: deploy-config

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/PRD.md`, `/docs/ARCHITECTURE.md`, `/docs/ADR.md`
- `/.env.example`
- `/supabase/migrations/` (step6·9 산출물 — 적용해야 할 파일 목록)
- `/phases/0-mvp/index.json` — 앞선 step들의 `summary`

## 작업

배포 설정 파일과 인수인계 문서를 만든 뒤, **이 step은 `blocked`로 종료한다.**

`blocked`가 정상 종료인 이유: 남은 작업이 전부 **사람만 할 수 있는 것**이다. Supabase 프로젝트 생성, 대시보드 토글, OAuth 클라이언트 등록, Polar 상품 생성, 실제 키 발급. 에이전트가 키 없이 진행하면 잘못된 값으로 배포 설정을 채우거나, 실패를 `error`로 잘못 보고한다.

### 1. `README.md`

프로젝트 소개와 로컬 실행 절차. 명령어는 `npm run dev`·`build`·`lint`·`test`.

**제품 경계를 README에도 적는다**: 이 서비스는 세무 조언을 제공하지 않으며, 분류 결과는 참고용이다.

### 2. `DEPLOY.md` — 인수인계 문서

사용자가 순서대로 따라 할 수 있는 체크리스트로 쓴다. 각 항목에 **왜 필요한지**를 한 줄씩 붙여라.

```
1. Supabase 프로젝트 생성
2. supabase/migrations/*.sql 을 순서대로 적용
   → 0001_initial.sql, 0002_usage.sql
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

### 3. 스모크 테스트 체크리스트

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

### 4. 배포 설정 파일

호스팅 설정 파일(예: `vercel.json`)이 필요하면 최소한으로 만든다. Node 런타임 지정이 필요한 라우트가 있는지 확인한다 — ExcelJS는 브라우저에서만 쓰므로 서버 런타임 제약은 없어야 한다.

빌드 시점에 환경변수가 없어도 빌드가 통과해야 한다(step0의 `src/lib/env.ts`가 호출 시점 접근이므로 이미 그렇다). 확인만 하라.

### 5. index.json 갱신

`phases/0-mvp/index.json`의 step 18을 다음과 같이 기록한다:

```json
{ "step": 18, "name": "deploy-config", "status": "blocked",
  "blocked_reason": "외부 서비스 수동 설정 필요 — DEPLOY.md 참조. Supabase 프로젝트 생성/마이그레이션 적용/Anonymous Sign-Ins·Manual Linking·Google OAuth 활성화, Anthropic 키 발급, Polar 상품·웹훅 등록, 호스팅 환경변수 등록." }
```

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
```

세 커맨드가 통과해야 한다. 배포 자체는 검증 대상이 아니다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 문서 체크리스트:
   - `DEPLOY.md`에 Supabase 대시보드 토글 3개가 전부 있는가?
   - `.env.example`의 모든 키가 `DEPLOY.md`의 어딘가에서 설명되는가?
   - 스모크 테스트에 "Google 연결 후 결과 유지" 항목이 있는가?
   - 스모크 테스트에 RLS 확인 항목이 있는가?
   - `README.md`에 세무 조언을 하지 않는다는 경계가 적혀 있는가?
3. `phases/0-mvp/index.json`의 step 18을 `"blocked"`로 기록하고 **즉시 중단한다.**

## 금지사항

- 실제 Supabase·Polar·Anthropic에 접속하지 마라. 이유: 키가 없다. 접속을 시도하면 재시도 루프에 빠져 3회 실패 후 `error`로 잘못 보고된다.
- 키를 추측해 채우거나 더미 값을 `.env`에 쓰지 마라. 이유: 배포 시 조용히 실패하고 원인을 찾기 어려워진다.
- 이 step을 `completed`로 표시하지 마라. 이유: 실제로 남은 작업이 있으며, `completed`로 두면 사용자가 배포 준비가 끝난 줄 안다.
- 기능 코드를 추가하지 마라. 이유: 이 step은 설정과 문서만 다룬다.
- `.env.example`을 덮어쓰지 마라. 이유: 이미 검증된 내용이며 `DEPLOY.md`가 이를 참조한다.
- 기존 테스트를 깨뜨리지 마라.
