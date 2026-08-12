# Step 11: dashboard-ui

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/PRD.md` — 요금제 표, 잠금 정책, 디자인 방향
- `/docs/ARCHITECTURE.md` — 잠금 응답, 읽기는 Server Component
- `/src/types/analysis.ts` (step1 — `PeriodView`, `LockedPeriod`), `/src/types/api.ts`
- `/src/lib/analysis/index.ts` (step4 — `aggregateByPeriod`, `applyLocks`)
- `/src/lib/supabase/server.ts`, `/src/lib/supabase/session.ts` (step5·6)
- `/src/app/api/analyses/[id]/insight/route.ts` (step10)
- `/src/components/preview/PreviewPanel.tsx` (step9 — 시각 언어를 맞춰라)

## 작업

`(app)` 라우트 그룹에 대시보드를 만든다. 로그인 필수 구역이다.

### 1. 데이터 조회는 Server Component에서

목록·상세를 위한 API 라우트를 **만들지 마라.** Server Component에서 Supabase로 직접 조회한다. RLS가 소유권을 보장한다.

```
src/app/(app)/dashboard/page.tsx        분석 목록 + 최신 분석 요약
src/app/(app)/analyses/[id]/page.tsx    분석 상세
```

조회 후 반드시 `getEffectivePlan()` → `applyLocks()`를 거쳐 `PeriodView[]`로 만든 뒤 클라이언트 컴포넌트에 넘긴다.

> **잠긴 기간의 금액을 클라이언트로 보내지 마라.** `applyLocks`를 거치지 않은 `PeriodSummary`를 그대로 넘기고 CSS로 가리면 개발자도구로 걷힌다. 서버에서 값을 제거하는 것이 유일한 구현이다.

### 2. 차트 (`src/components/charts/`)

Recharts. 클라이언트 컴포넌트로 감싼다.

- 카테고리 도넛
- 월별 추세 라인/바 — **Pro 전용**. Free에서는 잠금 카드로 대체
- 상위 가맹점 바

색은 `globals.css`의 `@theme` 토큰만 쓴다. hex 하드코딩 금지.

**인쇄 대응**: `ResponsiveContainer`는 인쇄 레이아웃에서 width 0으로 렌더되어 차트가 사라지는 알려진 함정이 있다. `@media print`에서 고정 width로 대체하는 폴백을 둔다. 인쇄 미리보기로 실제 확인하라.

### 3. 잠금 UI

`LockedPeriod`를 받으면 금액 없이 `teaser`와 잠금 상태만 보여주고 Pro CTA를 띄운다.

```
지난달 대비 지출이 늘었습니다        🔒
[Pro로 잠금 해제]
```

`LockedPeriod`에는 금액이 아예 없으므로 숫자를 만들어내지 마라.

### 4. 인사이트 패널

페이지 진입 시 `POST /api/analyses/:id/insight`를 호출한다.

- **집계를 먼저 렌더하고**, 인사이트는 로딩 상태로 뒤따르게 한다. 이유: LLM 지연이 첫 화면을 막으면 안 된다
- `status:'failed'`면 집계는 그대로 두고 인사이트 영역에만 재시도 버튼을 띄운다
- `etcRatio > 0.4`면 "가맹점 분류 정확도가 낮습니다" 안내를 띄운다

### 5. 히스토리와 재방문 약속

분석이 **하나뿐이면** 비교 차트 자리에 이렇게 띄운다:

> "다음 달 명세서를 올리면 지난달과 비교해 드려요"

이유: 첫 방문자 전원이 이 상태이고, 이 문구가 30일 뒤 재방문의 유일한 약속이다. 빈 영역으로 두지 마라.

### 6. 설정 — 내 데이터 삭제

`src/app/(app)/settings/page.tsx`에서 `DELETE /api/account`(step8)를 호출한다.

버튼과 확인 문구는 **"내 데이터 전체 삭제"** 다. **"계정 삭제"라고 쓰지 마라.** 이유: 계정 자체는 남으므로 사용자를 오해시킨다. 확인 모달에 "계정 자체 삭제는 아직 지원하지 않습니다"를 명시한다.

### 7. CSV 내보내기 — Pro 전용

```ts
// src/lib/export/csv.ts
export function toCsv(periods: PeriodSummary[]): string
```

`LockedPeriod`가 섞여 있으면 제외한다. 서버에서 플랜을 확인한 뒤 내보내기를 허용한다. 클라이언트 `plan` 값으로 판단하지 마라.

PDF 생성 라이브러리를 추가하지 마라. 인쇄용 CSS로 대체한다.

**TDD 가드 주의**: `src/lib/export/csv.ts`는 테스트 선행 대상이다.

### 8. 중복 안내

대시보드에서 재업로드했을 때도 step9와 **같은 2지선다**를 쓴다(`locked` 여부로 문구 분기). "그래도 추가"를 만들지 마라.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/export
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `src/app/api/analyses/route.ts` 같은 목록 조회 라우트를 만들지 않았는가?
   - Server Component가 `applyLocks`를 거친 결과만 넘기는가?
   - `grep -rn "계정 삭제" src/` 가 비어 있는가?
   - `@media print` 폴백이 있는가?
   - 색상 hex가 하드코딩되지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 11을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 페이지 경로·차트 컴포넌트·내보내기 함수를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 잠긴 기간의 금액을 클라이언트로 보내고 CSS로 가리지 마라. 이유: 개발자도구로 걷힌다. 서버에서 값을 제거한다.
- 목록·상세 조회용 API 라우트를 만들지 마라. 이유: Server Component에서 직접 조회한다.
- 클라이언트의 `plan` 값으로 Pro 기능을 열지 마라. 이유: 우회 가능하다. 서버에서 판정한다.
- "계정 삭제"라고 쓰지 마라. 이유: 계정은 남고 데이터만 지워진다.
- PDF 생성 라이브러리를 추가하지 마라. 이유: 인쇄용 CSS로 충분하며 MVP 범위 밖이다.
- 분석이 하나일 때 비교 영역을 빈칸으로 두지 마라. 이유: 재방문 약속이 이 제품의 유일한 리텐션 장치다.
- 다크모드 분기를 만들지 마라. 이유: 라이트모드 고정이다.
- 결제 연동을 만들지 마라. 이유: step12의 범위다. 여기서는 CTA 버튼까지만.
- 기존 테스트를 깨뜨리지 마라.
