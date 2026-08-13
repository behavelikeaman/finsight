# Step 3: redaction

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL 규칙 — 마스킹 강제)
- `/docs/ADR.md` (특히 ADR-004)
- `/src/types/` 전체
- `/src/lib/csv/` 전체 (step 2에서 생성)

## 작업

`src/lib/redact.ts`를 구현한다. 이 모듈은 **외부 API로 나가는 모든 데이터가 반드시 통과해야 하는 단일 관문**이다.

```ts
export interface RedactionResult<T> {
  data: T;
  removedCount: number;   // 제거된 민감정보 개수. 로깅·감사용
}

export function redactTransactions(transactions: Transaction[]): RedactionResult<Transaction[]>;
export function redactText(text: string): RedactionResult<string>;
```

### 제거 대상

1. **카드번호** — 13~19자리 숫자열. 하이픈/공백 구분 포함 (`1234-5678-9012-3456`, `1234 5678 9012 3456`). 마스킹된 형태(`****-****-****-3456`)도 뒷 4자리를 제거한다.
2. **계좌번호** — 하이픈으로 구분된 10자리 이상 숫자열 (`110-123-456789`).
3. **주민등록번호** — `\d{6}-?\d{7}`.
4. **사업자등록번호** — `\d{3}-?\d{2}-?\d{5}`.
5. **성명 후보** — CSV에 `회원명`, `이용자명`, `성명` 같은 컬럼이 있었다면 해당 값. 단, 가맹점명 컬럼은 절대 건드리지 않는다.

제거는 삭제가 아니라 **치환**으로 한다: `[REDACTED_CARD]`, `[REDACTED_ACCOUNT]` 등. 이유: 자리를 남겨야 AI가 "여기 무언가 있었다"는 걸 알고 오해하지 않는다.

### 적용 범위

`redactTransactions`는 `Transaction`의 `merchant`와 `rawRow` 전체에 `redactText`를 적용한다.

**`rawRow`를 반드시 포함해야 한다.** 이유: 컬럼 매핑 추론(step 4)에서 원본 행을 AI에 보내는데, 여기에 카드번호가 그대로 들어있다. `merchant`만 마스킹하고 `rawRow`를 빠뜨리면 CLAUDE.md의 CRITICAL 규칙이 무력화된다.

`amount`와 `date`는 마스킹하지 않는다 — 분류에 필수적이고 그 자체로 식별정보가 아니다.

### 과잉 마스킹 방지

가맹점명에 숫자가 섞이는 경우가 흔하다 (`GS25 강남1호점`, `스타벅스 1234점`). 4자리 이하 숫자나 문자와 붙어있는 숫자는 마스킹하지 마라. 정규식에 단어 경계를 명시하라.

과잉 마스킹은 과소 마스킹만큼 나쁘다 — 가맹점명이 뭉개지면 분류 품질이 무너진다.

### 테스트

`src/lib/__tests__/redact.test.ts`에 작성한다. 최소한 다음을 커버하라:

- 카드번호 4가지 표기(하이픈/공백/연속/마스킹된 형태) 제거
- 계좌번호, 주민번호, 사업자번호 제거
- `rawRow` 안의 민감정보도 제거되는지
- **과잉 마스킹 방지**: `GS25 강남1호점`, `스타벅스 1234점`, `이마트24`가 원형 그대로 남는지
- `amount`, `date`가 변경되지 않는지
- `removedCount`가 정확한지

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 신규 테스트 포함 전부 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - `src/lib/redact.ts` 경로가 CLAUDE.md에 명시된 것과 일치하는가?
   - 외부 API 호출이 없는 순수 함수인가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 3을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `merchant`만 마스킹하고 `rawRow`를 건너뛰지 마라. 이유: 원본 행이 step 4에서 AI로 전송되며, 거기에 카드번호가 들어있다.
- 가맹점명 컬럼의 값을 성명으로 오인해 제거하지 마라. 이유: 분류의 유일한 근거가 사라진다.
- 4자리 이하 숫자를 마스킹하지 마라. 이유: `GS25`, `이마트24` 같은 정상 가맹점명이 파괴된다.
- 마스킹 대상을 삭제(빈 문자열)하지 말고 플레이스홀더로 치환하라.
- 마스킹된 원본 값을 어디에도 로깅하지 마라.
- 기존 테스트를 깨뜨리지 마라
