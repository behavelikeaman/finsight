# Step 11: try-flow

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL 전체)
- `/docs/PRD.md`
- `/docs/ADR.md` (특히 ADR-004, ADR-006, ADR-007, ADR-012)
- `/src/app/api/parse/route.ts` (step 6)
- `/src/app/api/classify/route.ts` (step 8)
- `/src/types/` 전체
- `/src/app/(marketing)/` (step 10 — 톤과 스타일을 맞춘다)

## 작업

`src/app/try/`에 로그인 없는 1회 체험 흐름을 구현한다. 이 step이 완료되면 **"CSV를 올리면 AI가 경비를 분류한다"는 제품 핵심 가설이 실제로 검증 가능한 상태**가 된다.

### 화면 흐름

한 페이지 안에서 상태 전환으로 처리한다. 라우트를 나누지 마라 — 익명 사용자의 결과는 저장되지 않으므로 새로고침하면 사라지고, URL 상태를 만들면 사용자가 잃어버린 결과를 되찾으려다 실패한다.

1. **업로드 대기** — 드롭존 + 파일 선택 버튼. 아래에 데이터 취급 고지를 **접힌 링크가 아니라 본문으로** 노출한다 (ADR-004): 카드번호·성명은 전송 전 제거되고, 분석은 미국 Anthropic API를 거치며, 익명 체험 결과는 저장되지 않는다는 사실.
2. **처리 중** — `/api/parse` → `/api/classify` 순차 호출. 두 단계를 구분해 표시한다("파일 읽는 중" → "분류하는 중"). 분류는 수십 초 걸릴 수 있으므로 진행 표시가 없으면 사용자가 멈춘 줄 안다.
3. **결과** — 분류 표 + 가입 유도.

### 결과 표

`src/components/classification-table.tsx`에 만든다. **이 컴포넌트는 다음 phase의 대시보드에서 재사용되므로** 저장 로직을 안에 넣지 마라. 표시와 로컬 수정만 담당하고, 변경은 콜백으로 밖에 알린다.

```ts
interface ClassificationTableProps {
  transactions: Transaction[];
  classifications: Classification[];
  onEdit?: (transactionId: string, next: Partial<Classification>) => void;
  readOnly?: boolean;
}
```

요구사항:
- **"확인 필요" 섹션을 표 상단에 분리 배치한다** (ADR-007). `label === "uncertain"`인 건과 `confidence < 임계값`인 건이 여기 모인다. 사용자가 스크롤하다 우연히 발견하게 두지 마라.
- 각 행: 날짜, 가맹점, 금액, 분류(business/personal/uncertain), 계정과목, 확신도, 근거(`reason`).
- 분류 상태에만 색을 쓴다 (PRD 디자인). 나머지는 무채색.
- `source === "rule"`인 건은 별도 표시. 확신도의 의미가 다르다.
- 금액은 천 단위 구분 기호와 원 단위로 표시한다.
- 합계를 보여준다: 사업경비 합계, 개인지출 합계, 확인 필요 합계.
- **표 하단 또는 상단에 세무 고지를 상시 노출한다** (ADR-006): "분류 결과는 참고용이며, 최종 판단은 세무 대리인과 상의하세요."

체험에서는 `readOnly`를 쓰지 않는다 — 수정할 수 있어야 제품 가치가 전달된다. 다만 수정 내용은 저장되지 않으므로 그 사실을 안내한다.

### 가입 유도

결과 화면 하단에 배치한다. 저장되지 않는다는 사실과, 가입하면 무엇이 달라지는지(결과 저장, 수정 학습, 월 분석 횟수)를 적는다.

**결과를 흐리게 처리하거나 일부만 보여주고 가입을 요구하지 마라.** ADR-012의 전제는 "가치를 완전히 보여준 뒤 가입시킨다"이다. 페이월을 결과 위에 씌우면 체험 자체가 무의미해진다.

### 에러 처리

step 6·8의 `error.code`에 대응하는 한국어 메시지를 매핑한다. `src/lib/error-messages.ts`에 두어 대시보드에서도 재사용하게 하라.

- `TRIAL_ALREADY_USED` → 이미 체험했다는 안내 + 가입 유도
- `ENCODING_FAILED`, `HEADER_NOT_FOUND`, `MAPPING_INFERENCE_FAILED` → 파일 형식 문제 안내 + 지원 형식 설명
- `TOO_MANY_TRANSACTIONS` → 익명 체험은 100건까지라는 안내 + 가입 유도
- `FILE_TOO_LARGE` → 10MB 제한 안내
- `CLASSIFICATION_FAILED` → 재시도 안내

원문 에러 메시지나 스택을 사용자에게 노출하지 마라.

### 테스트

`src/components/__tests__/classification-table.test.tsx` + `/try` 페이지 스모크.

필수 케이스:
- `uncertain` 건이 상단 섹션에 렌더되는지
- 세무 고지 문구가 항상 렌더되는지 (ADR-006 회귀)
- 합계 계산이 정확한지 (음수 금액 포함)
- `onEdit` 콜백이 호출되는지
- 에러 코드가 한국어 메시지로 매핑되는지

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 신규 테스트 포함 전부 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `classification-table.tsx`가 저장 로직 없이 재사용 가능한가?
   - 세무 고지가 상시 노출되는가?
   - "확인 필요"가 상단에 분리되어 있는가?
   - 결과에 페이월이 씌워져 있지 않은가?
   - 데이터 취급 고지가 업로드 화면 본문에 있는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 11을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 결과에 페이월·블러를 씌우지 마라. 이유: ADR-012는 가치를 완전히 보여준 뒤 가입시키는 전략이다.
- 익명 사용자의 데이터를 저장하지 마라.
- `classification-table.tsx`에 DB 저장이나 API 호출을 넣지 마라. 이유: 다음 phase의 대시보드에서 재사용해야 하며, 결합되면 재작성해야 한다.
- 데이터 취급 고지를 접힌 아코디언이나 푸터 링크로 숨기지 마라. 이유: 국외 이전 고지는 업로드 시점에 보여야 의미가 있다.
- 세무 고지를 생략하지 마라 (ADR-006).
- 원문 에러 메시지나 스택 트레이스를 사용자에게 노출하지 마라.
- 진행 상태 표시 없이 긴 요청을 걸지 마라. 이유: 분류는 수십 초가 걸리며, 표시가 없으면 사용자가 이탈한다.
- 기존 테스트를 깨뜨리지 마라
