# Step 15: dashboard-ui

## 읽어야 할 파일

- `/CLAUDE.md` — 제품 경계(세무조언 금지·확신도), 코드 배치
- `/docs/PRD.md` — 요금제 표, 디자인 방향
- `/docs/ARCHITECTURE.md` — "읽기는 라우트를 만들지 않는다", 게이팅 응답
- `/src/types/analysis.ts`, `/src/types/api.ts`, `/src/types/tier.ts` (step1)
- `/src/lib/analysis/index.ts` (step4 — `bucketByClassification`)
- `/src/lib/supabase/server.ts`, `/src/lib/supabase/session.ts` (step6·7)
- `/src/app/api/analyses/[id]/classify/route.ts` (step11), `/src/app/api/analyses/[id]/transactions/route.ts` (step14)
- `/src/components/preview/PreviewPanel.tsx` (step13 — 시각 언어를 맞춰라)

## 작업

`src/app/(app)/dashboard/`에 로그인 후 화면을 만든다. **표가 주인공이고 차트는 보조다.**

### 1. 분석 목록 (`dashboard/page.tsx`)

**Server Component.** Supabase에서 직접 조회한다. 이것만을 위한 API 라우트를 만들지 마라.

`analyses`를 최신순으로. 각 행에 카드 라벨·기간·행 수·분류 완료 여부(`classified_at`).

### 2. 분석 상세 (`dashboard/[id]/page.tsx`)

**Server Component에서 조회**하고, 인터랙션이 필요한 표만 Client로 분리한다.

화면 구성 순서:

```
1. 요약 바        총액 / 사업경비 합계 / 개인지출 합계 / 미확정 건수
2. 확인 필요       ← 항상 최상단. 확신도 낮은 건 + 미분류 건
3. 사업경비        계정과목별 그룹
4. 개인지출
5. 세무 고지       "최종 판단은 세무 대리인과 상의하세요"
```

`bucketByClassification()`을 써서 나눈다. 버킷 로직을 여기서 다시 구현하지 마라.

**요약 바의 사업경비 합계에 `review`·`unclassified` 금액을 더하지 마라.** step4가 이미 그렇게 계산한다. 미확정 건수는 별도로 표시한다. 이유: 확인이 안 끝난 금액을 경비 합계에 넣으면 사용자가 그 숫자를 신고에 쓴다.

### 3. 분류 표 (`src/components/dashboard/TransactionTable.tsx`)

`'use client'`. 고밀도 표.

- 컬럼: 날짜 / 가맹점 / 금액 / 분류 / 계정과목 / 출처
- **출처 컬럼**: 규칙(`fromRule`)·AI·사용자 수정(`isUserEdited`)을 구분해 보여준다. 이유: 사용자가 "왜 이렇게 분류됐지"를 물을 수 있어야 신뢰가 생긴다
- 분류·계정과목은 인라인 드롭다운으로 수정
- 수정 시 **낙관적 업데이트** 후 `PATCH /api/analyses/:id/transactions` 호출. 실패하면 되돌리고 안내
- 계정과목 드롭다운은 `classification === 'business'`일 때만 활성화

#### 규칙 저장 확인

수정 후 **"이 가맹점은 앞으로도 이렇게 분류할까요?"** 를 묻고, 응답에 따라 `saveAsRule`을 보낸다.

묻지 않고 항상 규칙을 만들지 마라. 이유: 같은 가맹점이라도 미팅과 개인 방문이 섞인다. 임의 규칙은 다음 달 전건을 잘못 분류한다.

### 4. 전건 분류 실행

`classified_at`이 비어 있거나 미분류 건이 남아 있으면 "전체 분류" 버튼을 노출하고 `POST /api/analyses/:id/classify { mode:'full' }`을 호출한다.

응답별 처리:
- `quota_exceeded` → 남은 횟수와 다음 갱신 시점을 안내하고 Pro CTA. **분류 결과를 임의로 채우지 마라**
- `ok:true` → `revalidatePath`로 서버 상태 갱신

쿼터 잔여는 서버 응답의 `quotaLeft`만 쓴다. 클라이언트에서 계산하지 마라.

### 5. 차트 (`src/components/dashboard/MonthlyChart.tsx`)

Recharts로 월별 사업경비/개인지출 막대. **보조 역할이다.** 화면 상단을 차지하지 않게 두고, 표 아래에 배치한다.

색은 분류 상태 토큰만 쓴다.

### 6. 내보내기 (Pro)

CSV 내보내기와 인쇄용 CSS. Pro 전용이므로 `getEffectiveTier()`로 **서버에서 판정**하고, free면 버튼 자체를 렌더하지 않는다.

CSS로 숨기지 마라 — 개발자도구로 걷힌다.

### 7. 데이터 삭제 진입점

설정 영역에 **"내 데이터 전체 삭제"** 를 둔다. `DELETE /api/account` 호출.

**"계정 삭제"라고 쓰지 마라.** 계정은 남는다.

### 디자인

`@theme` 토큰만. hex 하드코딩 금지. 금액은 tabular-nums + 천 단위 구분자 + 원화. 라이트모드 고정.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 목록·상세 조회용 API 라우트를 새로 만들지 않았는가?
   - `bucketByClassification`을 import 하는가? (버킷 로직 재구현 금지)
   - 사업경비 합계에 `review`·`unclassified`가 섞이지 않는가?
   - `grep -rniE "blur|display:\s*none.*pro|hidden.*pro" src/components/dashboard/` — Pro 기능을 CSS로 숨기지 않는가?
   - `grep -rniE "계정 삭제" src/` 가 비어 있는가?
   - `grep -rn "#[0-9a-fA-F]\{6\}" src/components/dashboard/` 가 비어 있는가?
   - 세무 고지 문구가 상세 화면에 있는가?
   - 규칙 저장 전에 사용자에게 묻는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 15를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 페이지·컴포넌트 경로와 화면 구성 순서를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 목록·상세 조회용 API 라우트를 만들지 마라. 이유: Server Component에서 직접 조회한다. 라우트는 변경·외부호출 전용이다.
- `review`·`unclassified` 금액을 경비 합계에 더하지 마라. 이유: 사용자가 미확정 금액을 신고에 쓴다.
- 버킷 분류 로직을 컴포넌트에서 다시 구현하지 마라. 이유: `src/lib/analysis`와 어긋나는 순간 화면과 서버의 숫자가 달라진다.
- Pro 기능을 CSS로 숨기지 마라. 이유: 개발자도구로 걷힌다. 서버에서 판정해 렌더하지 않는다.
- 쿼터 잔여를 클라이언트에서 계산하지 마라. 이유: 서버 판정이 유일한 진실이다.
- 규칙 저장을 묻지 않고 실행하지 마라. 이유: 같은 가맹점이라도 건마다 성격이 다르다.
- 세무 판단 문구("경비 처리 가능합니다", "한도 초과" 등)를 쓰지 마라. 이유: 제품 경계이며 법적 위험이다.
- "계정 삭제"라고 쓰지 마라. 이유: 계정은 남는다.
- 차트를 화면 주인공으로 두지 마라. 이유: 표 중심 고밀도 레이아웃이 이 제품의 디자인 결정이다.
- 다크모드 분기를 만들지 마라. 이유: 라이트모드 고정이다.
- 기존 테스트를 깨뜨리지 마라.
