# Step 13: landing-upload

## 읽어야 할 파일

- `/CLAUDE.md` — 제품 경계, 인증 규칙, 코드 배치
- `/docs/PRD.md` — 사용자, 사용자 흐름, 요금제, 디자인 절
- `/docs/ADR.md` — ADR-001, ADR-009, ADR-010, ADR-015
- `/src/lib/ingest/index.ts` (step2), `/src/lib/mapping/index.ts` (step3)
- `/src/lib/supabase/auth.ts` (step7 — `ensureSession`, `decideAuthRoute`)
- `/src/lib/supabase/identity.ts` (step12 — `linkGoogle`, `signInGoogle`)
- `/src/types/api.ts`, `/src/types/tier.ts` (step1 — `AnalyzeRequest`, `ClassifyRequest`, `QUOTA`, `SAMPLE_SIZE`)
- `/src/app/globals.css` (step0 — Tailwind `@theme` 토큰)

## 작업

`src/app/(marketing)/`에 랜딩과 업로드 흐름을 만든다. 이 step이 완료되면 **"명세서를 올리면 AI가 경비를 가른다"는 제품 핵심 가설이 실제로 검증 가능한 상태**가 된다.

### 대상 독자

한국의 프리랜서·1인 사업자다. "AI로 소비 패턴을 분석해드립니다" 같은 일반론은 이 사람에게 아무 의미가 없다. 카피는 구체적인 상황에서 출발해야 한다: 신고철에 카드 명세서를 열어 사업경비를 손으로 골라내는 그 작업.

### 화면 흐름

```
1. 랜딩 (Server Component)      — 히어로 + 드롭존 + 요금제 + 고지
2. 파일 드롭 (Client)           — ensureSession() → ingestFile()
3. 컬럼 매핑 확인 (Client)      — guessMapping() 결과를 드롭다운으로 교정
4. 분석 실행 (Client)           — normalizeRows() → POST /api/analyze
5. 집계 프리뷰 (Client)         — 총액·월별·상위 가맹점
6. 표본 분류 (Client)           — POST /api/analyses/:id/classify { mode:'sample' }
7. 계정 연결 유도               — decideAuthRoute() → linkGoogle() | signInGoogle()
```

### 1. 랜딩 (`src/app/(marketing)/page.tsx`)

**Server Component로 작성한다.** 드롭존만 Client다.

- 히어로 — 문제 서술이 먼저, 기능 나열은 그 다음
- 요금제 표 — 숫자는 `src/types/tier.ts`의 `QUOTA`에서 읽는다. **하드코딩하지 마라**
- 데이터 취급 고지 — "원본 파일은 서버로 전송되지 않습니다", "거래내역은 분석을 위해 국외(Anthropic)로 전송됩니다", "카드번호는 저장하지 않습니다". 이 문구를 드롭존 근처에 둔다. 숨기지 마라
- **세무 고지** — "분류 결과는 참고용이며, 최종 판단은 세무 대리인과 상의하세요"

### 2. 드롭존 (`src/components/upload/DropZone.tsx`)

`'use client'`. `.csv`·`.xlsx`만 받는다.

**드롭 시점에 `ensureSession()`을 호출한다.** 랜딩이 렌더될 때가 아니다. 이유: 구경꾼·크롤러까지 `auth.users` 행을 만들면 안 된다.

`ingestFile()`은 브라우저에서 실행된다. 10,000행 초과는 여기서 잡아 안내한다.

### 3. 컬럼 매핑 UI (`src/components/upload/MappingPanel.tsx`)

`guessMapping()` 결과를 미리 채운 드롭다운 3개(날짜/가맹점/금액)와, 상위 5행 미리보기 표를 함께 보여준다.

**미리보기가 있어야 하는 이유**: 매핑이 맞는지는 값을 봐야 안다. 헤더 이름만으로는 원화 컬럼과 외화 컬럼을 구분하지 못한다.

`validateMapping()`의 이슈를 인라인으로 표시한다. `missing`이면 실행 버튼을 막는다.

### 4. 프리뷰 (`src/components/preview/PreviewPanel.tsx`)

`/api/analyze` 응답의 `summary`를 렌더한다 — 총액, 월별, 상위 가맹점. **여기까지는 LLM이 관여하지 않았다.**

이어서 `mode:'sample'`로 분류를 요청하고, 돌아온 20건을 분류 상태별 색으로 표시한다.

나머지 건에 대한 문구:

> "상위 {SAMPLE_SIZE}건을 분류했습니다. 나머지 {n}건은 Google 계정을 연결하면 분류합니다."

**나머지 건을 블러 처리하지 마라.** 아직 분류되지 않았을 뿐 가려진 값이 없다. 없는 결과를 있는 것처럼 위장하는 UI를 만들지 마라 — 개발자도구로 걷히기도 하고, 정직하지도 않다.

`sample_used`로 거부되면(`reason:'sample_used'`) 집계 프리뷰만 보여주고 계정 연결을 유도한다.

### 5. 계정 연결 (`src/components/auth/ConnectPanel.tsx`)

**반드시 `decideAuthRoute()`로 분기한다.**

```
isAnonymous && 방금 만든 분석이 있음  → linkGoogle()
그 외                                → signInGoogle()
```

이 판정을 여기서 다시 구현하지 마라. `src/lib/supabase/auth.ts`의 함수를 부른다.

`identity_taken` 에러는 step12에 정의된 문구로 안내한다.

### 6. 중복 업로드

`/api/analyze`가 `reason:'duplicate'`를 반환하면 "취소 / 기존 결과 보기" 두 선택지를 제시한다. 조용히 넘어가거나 새로 저장하지 마라.

### 디자인

`src/app/globals.css`의 `@theme` 토큰만 쓴다. hex를 컴포넌트에 하드코딩하지 마라.
색은 **분류 상태 3종(business/personal/review)에만** 쓴다. 금액은 tabular-nums, 천 단위 구분자, 원화 표기.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "ensureSession" src/` 가 드롭 핸들러에만 있는가? (`page.tsx`·`layout.tsx`에 있으면 위반)
   - `grep -rn "linkIdentity\|signInWithOAuth" src/components/` 가 비어 있는가? (`identity.ts` 경유여야 한다)
   - `grep -rniE "blur|backdrop-filter" src/components/preview/` 가 비어 있는가?
   - `grep -rn "#[0-9a-fA-F]\{6\}" src/components/` 가 비어 있는가?
   - 요금제 숫자가 `src/types/tier.ts`에서 오는가?
   - 세무 고지 문구가 프리뷰 화면에 있는가?
   - `FormData`로 파일을 전송하는 코드가 없는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 13을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 생성한 페이지·컴포넌트 경로와 흐름 단계를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 랜딩 렌더 시점에 `ensureSession()`을 호출하지 마라. 이유: 구경꾼·크롤러까지 `auth.users` 행을 만든다. 드롭 시점에만.
- 원본 파일을 서버로 보내지 마라. `FormData`를 쓰지 마라. 이유: 카드번호와 원본이 서버에 도달하고 본문 크기 제한에 걸린다.
- 분류되지 않은 거래를 블러로 가리지 마라. 이유: 가려진 값이 아니라 아직 없는 값이다. 위장하지 않고 그대로 안내한다.
- `decideAuthRoute` 없이 `signInGoogle()`을 부르지 마라. 이유: 익명 세션의 분석 결과가 통째로 사라진다.
- 요금제 숫자를 하드코딩하지 마라. 이유: 서버 쿼터와 어긋나면 사용자가 결제하고도 막힌다.
- 세무 판단 문구("경비 처리 가능합니다" 등)를 UI에 쓰지 마라. 이유: 제품 경계이며 법적 위험이다.
- 색을 분류 상태 외의 곳에 쓰지 마라. 이유: 금융 표에서 색이 흔해지면 분류 상태가 눈에 띄지 않는다.
- hex 색상값을 컴포넌트에 하드코딩하지 마라. 이유: 테마 토큰이 단일 출처다.
- 대시보드를 만들지 마라. 이유: step15의 범위다.
- 기존 테스트를 깨뜨리지 마라.
