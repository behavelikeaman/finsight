# Step 8: analyze-api

## 읽어야 할 파일

- `/CLAUDE.md` — 보안·데이터흐름 규칙
- `/docs/ARCHITECTURE.md` — API 계약과 분석 파이프라인 1단계
- `/docs/ADR.md` — ADR-006(브라우저 전처리), ADR-014(3단계 분리)
- `/src/types/api.ts`, `/src/types/analysis.ts`, `/src/types/tier.ts` (step1 — `AnalyzeRequest`, `AnalyzeResponse`, `MAX_ROWS`)
- `/src/lib/analysis/index.ts` (step4 — `summarize`, `computeFingerprint`)
- `/src/lib/supabase/server.ts`, `/src/lib/supabase/session.ts` (step6·7)

## 작업

`src/app/api/analyze/route.ts`에 `POST /api/analyze`를 구현한다. 파이프라인 1단계(집계)를 배선하는 step이다.

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다. `src/app/api/analyze/route.test.ts`를 **먼저** 작성하라.

### 처리 순서

```
1. requireUser()            — 미인증이면 401
2. 본문 파싱 + 검증          — rows 배열, 각 필드 타입, MAX_ROWS 상한
3. computeFingerprint(rows)
4. 중복 조회                 — (owner_id, fingerprint)로 기존 analyses 검색
   └ 있으면: 저장하지 않고 { ok:false, reason:'duplicate', existingId } 반환
5. summarize(rows)          — 서버가 직접 계산
6. 저장                      — analyses 1행 + transactions N행 (한 트랜잭션처럼)
                              classification·account_code·confidence 는 전부 null
7. { ok:true, analysisId, summary } 반환
```

**6번에서 `classification`을 채우지 마라.** 이 엔드포인트는 분류하지 않는다. 분류는 step11의 `/api/analyses/:id/classify`가 한다.

### 검증 규칙

- `rows`가 배열이 아니거나 비어 있으면 400
- 행 수가 `MAX_ROWS`(10,000) 초과면 400. 조용히 자르지 마라
- 각 행: `occurredOn`이 `YYYY-MM-DD` 형태, `merchant`가 비어 있지 않은 문자열, `amountKrw`가 **정수**. 하나라도 아니면 400
- 본문 크기 상한도 확인한다

**클라이언트가 보낸 집계·총액을 받지 마라.** 요청은 `rows`·`cardLabel`·`sourceKind`뿐이다. 이유: 클라이언트 계산을 신뢰하면 화면에 뜬 금액이 서버 기록과 달라진다.

### `owner_id`

`transactions`와 `analyses`의 `owner_id`는 **서버가 `auth.uid()`에서 채운다.** 요청 본문에서 읽지 마라. 이유: 남의 `owner_id`로 삽입하려는 시도를 애초에 차단한다(RLS `WITH CHECK`가 2차 방어).

### 저장

`analyses` 1행을 만들고 그 id로 `transactions`를 일괄 삽입한다. 삽입 도중 실패하면 `analyses` 행도 남기지 마라 — 고아 분석이 생긴다. Supabase RPC(`plpgsql` 함수)로 묶거나, 실패 시 명시적으로 `analyses`를 삭제한다.

### 테스트

Supabase 클라이언트와 `session.ts`를 모킹한다. 실제 DB에 접속하지 마라.

- 미인증 → 401
- 10,001행 → 400
- `amountKrw`가 소수 → 400
- `merchant`가 빈 문자열 → 400
- 정상 요청 → `ok:true`, `summary` 반환, `owner_id`가 세션 uid로 채워졌는지
- 저장된 `transactions`의 `classification`이 전부 `null`인지
- 중복 fingerprint → 저장 호출이 **일어나지 않고** `ok:false, reason:'duplicate'` 반환
- 요청 본문에 `owner_id`를 넣어도 무시되는지

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/app/api/analyze
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -n "FormData\|new File(" src/app/api/analyze/route.ts` 가 비어 있는가?
   - LLM 호출이 없는가? (`grep -rn "anthropic" src/app/api/analyze/`)
   - `owner_id`를 요청 본문에서 읽지 않는가?
   - 응답에 `ok` 판별자가 있는가?
   - `MAX_ROWS`를 `src/types/tier.ts`에서 import 하는가? (하드코딩 금지)
3. 결과에 따라 `phases/0-mvp/index.json`의 step 8을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 엔드포인트·검증 규칙·중복 처리 방식을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 원본 파일을 받지 마라. `FormData`·`File`·`Blob`을 쓰지 마라. 이유: 본문 크기 제한에 걸리고, 카드번호와 원본이 서버에 도달한다. 정규화된 배열만 받는다.
- **LLM을 호출하지 마라.** 이유: 익명 사용자도 이 엔드포인트를 쓴다. 분류는 step11에서 쿼터 검사를 거쳐 실행한다.
- `classification`·`account_code`·`confidence`를 채우지 마라. 이유: 이 단계는 분류하지 않는다. 값이 있으면 UI가 분류가 끝난 줄 안다.
- 클라이언트가 보낸 집계·총액을 신뢰하지 마라. 이유: 화면 금액과 서버 기록이 어긋난다.
- `owner_id`를 요청 본문에서 읽지 마라. 이유: 남의 데이터로 삽입할 통로가 된다.
- 상한 초과 시 조용히 잘라내지 마라. 이유: 사용자가 일부만 분석된 줄 모른다.
- 중복일 때 저장하고 나서 알리지 마라. 이유: 이중 계상이 발생해 시계열이 망가진다. 저장 전에 판정한다.
- service role 클라이언트를 쓰지 마라. 이유: 이 경로는 사용자 세션으로 RLS 아래서 동작해야 한다.
- 기존 테스트를 깨뜨리지 마라.
