# Step 2: csv-parsing

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (특히 ADR-003)
- `/src/types/` 전체 (step 1에서 생성)

## 작업

`src/lib/csv/`에 CSV 파싱 유틸리티를 구현한다. **이 step에서는 AI를 호출하지 않는다.** 전부 순수 함수이며 전부 테스트를 동반한다.

### `src/lib/csv/encoding.ts`

```ts
export function decodeBuffer(buffer: ArrayBuffer): { text: string; encoding: "utf-8" | "cp949" };
```

동작: UTF-8로 디코딩을 시도하되 `TextDecoder("utf-8", { fatal: true })`를 사용해 실패를 감지한다. 실패하면 `TextDecoder("euc-kr")`로 재시도한다 (Node의 euc-kr 디코더가 CP949 영역을 포함한다).

`fatal: true` 없이 디코딩하면 잘못된 바이트가 U+FFFD로 조용히 치환되어 감지가 불가능하다. 반드시 fatal 모드로 판별하라.

추가 방어: UTF-8 디코딩이 성공했더라도 결과에 U+FFFD가 포함되어 있으면 cp949로 재시도한다.

### `src/lib/csv/fingerprint.ts`

```ts
export function computeFingerprint(rows: string[][]): string;
export function findHeaderRow(rows: string[][]): number;
```

`findHeaderRow`: 카드사 CSV는 상단에 "이용내역", 조회 기간, 빈 행 같은 머리말이 붙는 경우가 많다. 컬럼 수가 가장 많고 셀이 대부분 비어있지 않은 첫 행을 헤더로 판정한다.

`computeFingerprint`: 헤더 행의 셀 값을 정규화(공백 제거, 소문자화)한 뒤 join하여 SHA-256 해시를 만든다. 조회 기간처럼 매번 바뀌는 값은 헤더에 포함되지 않으므로 같은 카드사의 다른 달 파일은 같은 지문을 갖는다.

지문에 행 개수나 데이터 내용을 섞지 마라. 이유: 매 파일마다 지문이 달라져 매핑 캐시가 무효화되고, ADR-003의 비용 절감이 사라진다.

### `src/lib/csv/parse.ts`

```ts
export function splitRows(text: string): string[][];
```

CSV 문자열을 2차원 배열로 분해한다. 따옴표로 감싼 필드 안의 쉼표와 개행을 올바르게 처리해야 한다. 직접 구현하지 말고 `papaparse`를 사용하라 — 직접 만든 split은 반드시 인용 필드에서 깨진다.

### `src/lib/csv/normalize.ts`

```ts
export function parseAmount(raw: string): number;
export function parseDate(raw: string, format: string): string;  // → "YYYY-MM-DD"
export function applyMapping(rows: string[][], mapping: ColumnMapping): Transaction[];
```

`parseAmount` 요구사항:
- 콤마 제거 (`"1,234,000"` → `1234000`)
- 통화 기호·공백·`원` 제거
- 괄호 표기 음수 지원 (`"(1,000)"` → `-1000`)
- 선행 `-` 지원
- 소수점이 있으면 반올림해 정수로. 이유: 원 단위 아래는 카드 거래에 존재하지 않으며, 부동소수점을 남기면 합계 오차가 생긴다
- 파싱 불가 시 예외를 던진다. 0을 반환하지 마라 — 조용한 오분류로 이어진다

`parseDate` 요구사항:
- 최소 `YYYY.MM.DD`, `YYYY-MM-DD`, `YYYY/MM/DD`, `YYYYMMDD`, `MM/DD` 지원
- `MM/DD`처럼 연도가 없으면 예외를 던진다 (연도 추론은 오류 원인이 된다)
- 항상 `YYYY-MM-DD`로 정규화

`applyMapping`: `mapping.headerRowIndex` 다음 행부터 순회하며 `Transaction[]`을 만든다. 빈 행과 합계 행(금액 컬럼이 비었거나 가맹점명이 비어있는 행)은 건너뛴다. 각 행의 원본을 `rawRow`에 보존한다.

### 테스트

`src/lib/csv/__tests__/`에 각 모듈의 테스트를 작성한다. 최소한 다음을 커버하라:

- `decodeBuffer`: UTF-8 한글, CP949 한글, ASCII만 있는 경우
- `parseAmount`: 콤마, 괄호 음수, 통화기호, 파싱 실패 시 예외
- `parseDate`: 지원 포맷 전부, 연도 없는 입력에서 예외
- `findHeaderRow`: 머리말 3행이 앞에 붙은 케이스
- `computeFingerprint`: 같은 카드사의 서로 다른 달 파일이 같은 지문을 갖는지
- `applyMapping`: 합계 행·빈 행 스킵

테스트 픽스처는 `src/lib/csv/__tests__/fixtures/`에 두되, **실제 개인 카드 명세서를 넣지 마라.** 가상의 가맹점명과 금액으로 만든 샘플만 사용한다.

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 신규 테스트 포함 전부 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 코드가 `src/lib/csv/`에 있는가?
   - 외부 API 호출이 전혀 없는가? (이 step은 순수 함수만)
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- Anthropic API를 호출하지 마라. 컬럼 매핑 추론은 step 4에서 다룬다. 이유: 파싱 로직은 AI 없이 결정론적으로 테스트 가능해야 한다.
- CSV 분해를 직접 구현하지 마라(`text.split(",")` 금지). 이유: 따옴표로 감싼 필드 내부의 쉼표에서 반드시 깨진다. `papaparse`를 쓴다.
- `TextDecoder`를 fatal 모드 없이 쓰지 마라. 이유: 인코딩 오류가 U+FFFD로 조용히 치환되어 감지되지 않는다.
- 파싱 실패 시 기본값(0, 오늘 날짜 등)을 반환하지 마라. 예외를 던져라. 이유: 조용한 오분류는 사용자가 세무 신고에 잘못된 금액을 쓰게 만든다.
- 실제 개인 카드 명세서를 테스트 픽스처로 커밋하지 마라.
- 기존 테스트를 깨뜨리지 마라
