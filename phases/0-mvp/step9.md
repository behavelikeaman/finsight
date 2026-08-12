# Step 9: landing-upload

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/PRD.md` — 사용자 흐름, 디자인 방향
- `/docs/ARCHITECTURE.md` — 분석 파이프라인 1단계
- `/src/lib/ingest/index.ts` (step2), `/src/lib/mapping/index.ts` (step3)
- `/src/lib/supabase/auth.ts` (step6 — `ensureSession`, `decideAuthRoute`)
- `/src/lib/supabase/identity.ts` (step8 — `linkGoogle`, `signInGoogle`)
- `/src/types/api.ts` (step1 — `AnalyzeRequest`, `AnalyzeResponse`)
- `/src/app/globals.css` (step0 — Tailwind `@theme` 토큰)

## 작업

`(marketing)` 라우트 그룹에 랜딩과 업로드 퍼널을 만든다. `src/components/`는 TDD 가드 면제이므로 컴포넌트에 유닛 테스트를 강요하지 않는다.

### 화면 흐름 — 한 페이지 안에서 단계 전환

```
① 랜딩          "카드 명세서를 그냥 던져보세요"  + 우상단 [로그인]
      ↓ 파일 드롭 (.csv / .xlsx)
② 전처리        ensureSession() → ingestFile() → guessMapping()
      ↓
③ 컬럼 매핑     날짜│가맹점│금액 드롭다운 + 상위 5행 미리보기
      ↓ [분석 시작]
④ 진행 표시     POST /api/analyze
      ↓
⑤ 프리뷰        총액 · 카테고리 도넛 · 상위 가맹점 3
                "현재 결과를 저장하려면 Google 계정을 연결하세요"
```

### 1. 랜딩 (`src/app/(marketing)/page.tsx`)

카피, 제품 설명, 드롭존. 우상단에 **[로그인]** 진입점을 둔다 — 재방문자가 여기로 들어온다. 클릭 시 `signInGoogle()`.

데모 대시보드 스크린샷 자리를 둔다(정적 이미지 또는 목업 마크업). LLM을 호출하지 마라.

### 2. 드롭존 (`src/components/upload/DropZone.tsx`)

`.csv`, `.xlsx`만 받는다. 그 외 확장자는 거부하고 안내한다. PDF를 던지면 "PDF 명세서는 아직 지원하지 않습니다"로 명확히 알린다.

**파일이 드롭된 이 시점에 `ensureSession()`을 호출한다.** 페이지 로드나 컴포넌트 마운트에서 부르지 마라. 이유: 랜딩을 스쳐간 방문자·크롤러까지 `auth.users` 행을 만든다.

### 3. 컬럼 매핑 UI (`src/components/upload/MappingForm.tsx`)

- `guessMapping()` 결과를 초기값으로 세 개의 드롭다운(날짜·가맹점·금액)
- 선택된 매핑으로 상위 5행을 파싱해 **결과를 그대로 미리보기**한다. 사용자가 "맞게 읽혔다"를 눈으로 확인하는 것이 이 화면의 목적이다
- `validateMapping()`의 이슈를 인라인으로 표시한다. `missing`이 있으면 [분석 시작]을 비활성화하고 어느 컬럼이 없는지 밝힌다
- `unparsable` 이슈는 경고로 띄우되 진행은 막지 않는다

### 4. 분석 요청 (`src/lib/upload/submit.ts`)

```ts
export async function submitAnalysis(req: AnalyzeRequest): Promise<AnalyzeResponse>
```

`normalizeRows()`로 만든 배열을 `POST /api/analyze`에 JSON으로 보낸다.

**원본 파일을 보내지 마라.** `FormData`·`File`을 쓰지 마라. 이유: 본문 크기 제한에 걸리고, 카드번호와 원본이 서버에 도달한다.

10,000행을 넘으면 요청 전에 막고 안내한다.

**TDD 가드 주의**: `src/lib/upload/submit.ts`는 `lib/` 아래이므로 테스트 선행 대상이다. `fetch`를 모킹해 본문이 JSON이고 파일이 실리지 않는지, 상한 초과를 막는지 검증하라.

### 5. 중복 응답 처리

`{ ok:false, reason:'duplicate' }`를 받으면 모달로 2지선다를 띄운다.

```
locked === false → "이미 분석한 명세서입니다"            [취소] [기존 결과 보기]
locked === true  → "이미 분석한 명세서입니다 (2026년 5월)
                    해당 기간은 Pro에서 열람할 수 있습니다"  [취소] [Pro 보기]
```

**"그래도 추가" 선택지를 만들지 마라.** 이유: `UNIQUE(owner_id, fingerprint)` 제약과 충돌해 저장이 실패한다.

### 6. 프리뷰 (`src/components/preview/PreviewPanel.tsx`)

응답의 `periods`에서 최신 기간을 보여준다. 총액, 카테고리 도넛, 상위 가맹점 3개.

AI 인사이트 자리에는 **"로그인하면 AI 분석을 생성합니다"** 로 표기한다.

> **없는 인사이트를 블러 처리해 있는 것처럼 보이게 하지 마라.** 이유: 익명 단계에서는 LLM을 호출하지 않으므로 인사이트가 실제로 존재하지 않는다. 가짜 블러는 사용자를 속이는 것이다.

CTA는 `decideAuthRoute()`로 분기한다. 익명 세션에 결과가 있으므로 정상 흐름에서는 `linkGoogle()`이 불린다.

### 디자인

라이트모드 고정. 색은 `globals.css`의 `@theme` 토큰만 쓴다. hex를 컴포넌트에 하드코딩하지 마라. 금액은 `tabular-nums` + 천 단위 구분자 + 원화 표기.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/upload
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "signInAnonymously\|ensureSession" src/app/(marketing)/` 가 페이지·레이아웃이 아니라 드롭 핸들러에서만 나오는가?
   - `grep -rn "FormData\|new File(" src/lib/upload/ src/components/upload/` 가 비어 있는가?
   - `grep -rn "blur" src/components/preview/` — 인사이트를 가짜로 블러 처리하지 않았는가?
   - 색상 hex가 컴포넌트에 하드코딩되지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 9를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 페이지·컴포넌트 경로와 단계 전환 방식을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 페이지 로드·마운트 시점에 익명 세션을 만들지 마라. 이유: 구경만 한 방문자와 크롤러까지 계정을 만든다. 파일 드롭 시점에만.
- 원본 파일을 서버로 보내지 마라. 이유: 본문 크기 제한과 개인정보 노출.
- 존재하지 않는 AI 인사이트를 블러로 위장하지 마라. 이유: 익명 단계에서는 생성하지 않으므로 사용자를 속이는 것이다.
- 중복 모달에 "그래도 추가"를 넣지 마라. 이유: DB unique 제약과 충돌해 저장이 실패한다.
- 대시보드나 결제 화면을 만들지 마라. 이유: step11·12의 범위다.
- LLM을 호출하지 마라. 이유: 인사이트는 step10에서 계정 연결 후 생성한다.
- 다크모드 분기를 만들지 마라. 이유: 라이트모드 고정이다.
- 기존 테스트를 깨뜨리지 마라.
