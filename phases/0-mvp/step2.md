# Step 2: file-ingest

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` — 디렉토리 구조와 분석 파이프라인 1단계
- `/docs/ADR.md` — ADR-009(브라우저 전처리), ADR-011(ExcelJS)
- `/src/types/domain.ts` (step1 산출물 — `RawTable`, `SourceKind`)
- `/vitest.config.ts` (step0 산출물)

## 작업

`src/lib/ingest/`에 **파일 → `RawTable`** 변환을 구현한다. 이 코드는 브라우저에서 실행되므로 Node 전용 API(`fs` 등)를 쓰면 안 된다. 입력은 `ArrayBuffer`다.

### 공개 인터페이스 (`src/lib/ingest/index.ts`)

```ts
export interface IngestResult { table: RawTable; skippedPreambleRows: number; droppedTotalRows: number }
export interface IngestOptions { maxRows?: number }   // 기본 10000

export async function ingestFile(
  buffer: ArrayBuffer, fileName: string, options?: IngestOptions
): Promise<IngestResult>

export function detectSourceKind(fileName: string): SourceKind
```

### 1. 인코딩 감지 (`encoding.ts`)

```ts
export function decodeText(buffer: ArrayBuffer): string
```

한국 카드사 CSV는 상당수가 **EUC-KR/CP949**다. UTF-8로 단정하면 글자가 전부 깨진다.

판정 순서: UTF-8 BOM 확인 → `TextDecoder('utf-8', { fatal: true })` 시도 → 실패하면 `TextDecoder('euc-kr')`로 폴백. 브라우저 `TextDecoder`가 `euc-kr`을 지원한다.

### 2. CSV 파싱 (`csv.ts`)

```ts
export function parseCsv(text: string): string[][]
```

따옴표로 감싼 필드, 필드 내 쉼표·줄바꿈, 이스케이프된 따옴표(`""`)를 처리한다. 외부 CSV 라이브러리를 추가하지 말고 직접 구현한다. 이유: 의존성 하나를 아끼는 것보다, 이 파서가 픽스처로 완전히 검증되는 편이 낫다.

### 3. 엑셀 파싱 (`xlsx.ts`)

```ts
export async function parseXlsx(buffer: ArrayBuffer): Promise<string[][]>
```

**ExcelJS를 동적 import 한다** (`await import('exceljs')`). 이유: 정적 import하면 랜딩 초기 번들에 들어가 LCP를 해친다. 사용자가 `.xlsx`를 드롭한 순간에만 로드되어야 한다.

첫 워크시트만 읽는다. 셀 값은 전부 문자열로 변환한다(날짜 셀은 `YYYY-MM-DD` 형태 문자열로).

### 4. 표 정리 (`cleanup.ts`)

```ts
export function findHeaderRow(rows: string[][]): number
export function dropTotalRows(rows: string[][], headerIdx: number): { rows: string[][]; dropped: number }
```

**상단 안내문 제거**: 카드사 명세서는 헤더 앞에 "고객님의 이용내역입니다" 같은 줄이 붙는다. 비어 있지 않은 셀 개수가 안정적으로 최대가 되는 첫 행을 헤더로 판정한다.

**하단 합계 행 제거**: 맨 아래 "합계 1,234,567" 같은 행. 판정 기준은 *날짜로 파싱 가능한 셀이 없고 숫자 셀만 있는 행*, 또는 첫 셀이 `합계`·`총계`·`계`·`Total`인 행.

> 이 처리를 놓치면 **총액이 2배가 된다.** 금액 정확성이 이 제품의 존재 이유이므로 반드시 테스트로 고정한다.

### 5. 상한

행 수가 `maxRows`(기본 10,000)를 넘으면 명확한 메시지와 함께 throw한다. 조용히 잘라내지 마라. 이유: 사용자가 일부만 분석된 줄 모르고 잘못된 결론을 얻는다.

### 테스트 픽스처

`src/lib/ingest/__fixtures__/`에 최소 8종을 만든다. **바이너리 픽스처(EUC-KR, xlsx)는 테스트 코드에서 생성**한다(문자열을 인코딩하거나 ExcelJS로 워크북을 만들어 buffer 추출).

1. UTF-8 정상 CSV
2. EUC-KR CSV (한글 가맹점명)
3. 상단 안내문 3줄이 붙은 CSV
4. 하단 합계 행이 있는 CSV
5. 안내문 + 합계 행이 둘 다 있는 CSV
6. 따옴표·필드 내 쉼표가 있는 CSV
7. 같은 내용의 .xlsx
8. 빈 파일 / 거래 0건

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/ingest
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 합계 행이 있는 픽스처에서 행 수가 정확히 하나 줄었는가?
   - EUC-KR 픽스처에서 한글이 깨지지 않는가?
   - ExcelJS가 **동적 import**인가? (`grep -n "import('exceljs')" src/lib/ingest/xlsx.ts`)
   - `fs`·`Buffer` 등 Node 전용 API를 쓰지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 2를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 공개 함수 시그니처와 픽스처 종류를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- `xlsx`(SheetJS) 패키지를 쓰지 마라. 이유: npm 배포가 0.18.5에서 멈춰 보안 수정본이 레지스트리에 없다.
- ExcelJS를 정적 import 하지 마라. 이유: 랜딩 초기 번들이 커져 LCP가 나빠진다.
- `fs`, `path`, `Buffer` 같은 Node 전용 API를 쓰지 마라. 이유: 이 코드는 브라우저에서도 실행된다.
- 헤더를 첫 행으로 단정하지 마라. 이유: 카드사 명세서는 상단에 안내문이 붙어 나온다.
- 상한 초과 시 조용히 잘라내지 마라. 이유: 사용자가 일부만 분석된 사실을 모른 채 잘못된 결론을 얻는다.
- 컬럼 매핑·카테고리 분류·집계를 여기서 하지 마라. 이유: 각각 step3, step4의 범위다.
- 기존 테스트를 깨뜨리지 마라.
