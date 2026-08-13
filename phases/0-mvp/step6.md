# Step 6: parse-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md`
- `/docs/ARCHITECTURE.md` (업로드 → 분류 데이터 흐름 절)
- `/docs/ADR.md` (특히 ADR-003)
- `/src/lib/csv/` 전체
- `/src/lib/redact.ts`
- `/src/services/anthropic/` 전체
- `/src/services/supabase/` 전체
- `/src/types/` 전체

## 작업

`src/app/api/parse/route.ts`에 `POST /api/parse`를 구현한다.

### 계약

요청: `multipart/form-data`, 필드명 `file`.

응답 (200):
```ts
{
  fingerprint: string;
  issuerLabel: string;
  encoding: "utf-8" | "cp949";
  transactions: Transaction[];
  mappingSource: "cache" | "inferred";   // 관측용. 캐시 적중률을 알아야 한다
}
```

에러는 `{ error: { code: string; message: string } }` 형태로 4xx/5xx와 함께 반환한다. `code`는 클라이언트가 분기할 수 있는 안정적 문자열이어야 한다 (예: `ENCODING_FAILED`, `HEADER_NOT_FOUND`, `MAPPING_INFERENCE_FAILED`, `FILE_TOO_LARGE`, `TOO_MANY_TRANSACTIONS`).

### 흐름

1. 파일 크기 검사. 10MB 초과 시 `FILE_TOO_LARGE`로 413. 이유: 카드 명세서는 이보다 클 이유가 없고, 무제한 업로드는 DoS 경로다.
2. `decodeBuffer`로 디코딩.
3. `splitRows`로 2차원 배열화.
4. `findHeaderRow` → `computeFingerprint`.
5. `column_mappings`에서 fingerprint 조회.
   - **적중**: 저장된 매핑으로 `applyMapping`. AI 호출 없음. `mappingSource: "cache"`.
   - **미스**: `inferColumnMapping(rows.slice(0, 20), encoding)` 호출 → 결과를 `column_mappings`에 저장(service role 필요) → `applyMapping`. `mappingSource: "inferred"`.
6. 거래 건수가 호출자 티어 상한을 넘으면 `TOO_MANY_TRANSACTIONS`로 400. 티어 판별과 쿼터 소비는 step 7·8에서 다루므로, 이 step에서는 **상한 검사만** 하고 `TIER_LIMITS`의 `maxTransactionsPerUpload`를 참조한다. 인증 사용자면 `profiles.tier`, 아니면 `"anonymous"`로 본다.
7. 거래 배열을 반환한다.

### 저장하지 않는다

이 라우트는 **DB에 거래를 저장하지 않는다.** 이유: 익명 체험(step 11)도 같은 라우트를 쓰는데, 익명 사용자의 거래는 저장 대상이 아니다. 저장은 분류 확정 후 별도 경로에서 한다.

원본 CSV를 Storage에 올리는 것도 이 step 범위 밖이다 — 인증된 사용자 흐름이 완성되는 시점에 붙인다.

### 매핑 저장 시 경합

같은 카드사 파일을 두 사용자가 동시에 올리면 두 번 추론되어 같은 fingerprint로 두 번 insert될 수 있다. `on conflict (fingerprint) do nothing`으로 처리하라. 예외를 던지지 마라 — 사용자에게는 아무 문제가 없는 상황이다.

### 추론 실패 폴백

`inferColumnMapping`이 실패하거나 검증에서 탈락하면 `MAPPING_INFERENCE_FAILED`로 422를 반환한다. 임의로 "0번이 날짜, 1번이 가맹점" 같은 추측을 하지 마라 — 잘못된 매핑은 조용히 틀린 금액을 만든다.

### 테스트

`src/app/api/parse/__tests__/route.test.ts`. Anthropic·Supabase 서비스를 모킹한다.

- 캐시 적중 시 Anthropic이 호출되지 않는지 (**핵심 회귀 테스트** — ADR-003의 비용 절감이 여기 달려 있다)
- 캐시 미스 시 추론 후 매핑이 저장되는지
- 10MB 초과 파일이 413인지
- 거래 건수 초과가 400인지
- 추론 실패가 422이고 폴백 추측을 하지 않는지

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 신규 테스트 포함 전부 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 라우트가 `src/app/api/parse/route.ts`에 있는가?
   - Anthropic 호출이 서비스 래퍼를 통해서만 일어나는가?
   - 캐시 적중 시 AI 호출이 0인가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 캐시 적중 시에도 AI를 호출하지 마라. 이유: ADR-003 전체가 무의미해지고 원가가 사용자 수에 비례해 증가한다.
- 컬럼 매핑 추론이 실패했을 때 기본 매핑을 추측하지 마라. 이유: 잘못된 컬럼을 금액으로 읽으면 사용자가 틀린 숫자를 세무 신고에 쓴다.
- 이 라우트에서 거래를 DB에 저장하지 마라. 이유: 익명 체험도 같은 라우트를 쓰며, 저장 대상이 아니다.
- 파일 크기 상한 없이 업로드를 받지 마라.
- `Transaction.rawRow`를 응답에 포함할 때 마스킹 여부를 확인하라. 클라이언트로 나가는 데이터에도 카드번호가 있으면 안 된다.
- 기존 테스트를 깨뜨리지 마라
