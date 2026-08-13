# Step 14: corrections-api

## 읽어야 할 파일

- `/CLAUDE.md` — 보안 규칙, 비용 규칙
- `/docs/ARCHITECTURE.md` — API 계약의 `PATCH /api/analyses/:id/transactions`
- `/docs/ADR.md` — ADR-011(확신도), ADR-012(규칙 학습)
- `/src/types/api.ts` (step1 — `CorrectionsRequest/Response`, `TransactionEdit`)
- `/src/lib/rules.ts` (step9 — `derivePattern`)
- `/src/lib/supabase/session.ts` (step7 — `requireUser`)
- `/src/app/api/analyses/[id]/classify/route.ts` (step11 — 소유 확인·응답 관례를 맞춰라)

## 작업

`src/app/api/analyses/[id]/transactions/route.ts`에 `PATCH`를 구현한다. 사용자가 고친 분류를 저장하고, **선택 시 규칙으로 학습**한다.

이 step이 유닛 이코노믹스에서 차지하는 위치: 여기서 저장된 규칙이 다음 분석의 AI 호출 건수를 줄인다(step11의 관문 B).

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다. `route.test.ts`를 **먼저** 작성하라.

### 처리 순서

```
1. requireUser()                     — 미인증이면 401
2. 소유 확인                           — analyses.owner_id === uid, 아니면 404
3. edits 검증                         — 각 id가 이 분석에 속하는지, 값이 유효한 enum인지
4. transactions 갱신                  — classification, account_code,
                                        is_user_edited = true, confidence = null
5. saveAsRule이면 user_rules upsert   — derivePattern(merchant) 기준
6. { ok:true, ruleIds }
```

### `is_user_edited`와 `confidence`

수정된 건은 `is_user_edited = true`, **`confidence`는 `null`로 만든다.**

이유: 확신도는 AI 판단의 속성이다. 사람이 확정한 건에 AI의 확신도를 남겨두면, `bucketByClassification`(step4)이 낮은 확신도를 보고 다시 "확인 필요"로 올린다. 사용자가 방금 확정한 건이 계속 재확인 목록에 뜨는 버그가 된다.

### 규칙 학습 (`saveAsRule`)

`derivePattern(merchant)`로 패턴을 만들고 `user_rules`에 **upsert** 한다. 충돌 키는 `(owner_id, merchant_pattern)`이다.

같은 가맹점을 다시 고치면 새 규칙이 생기는 게 아니라 기존 규칙이 갱신되어야 한다. 이유: 규칙이 쌓이면 `applyRules`에서 어느 것이 이기는지 예측할 수 없어진다.

**`saveAsRule`이 false면 규칙을 만들지 마라.** 사용자가 이번 건만 고치려는 경우가 있다(같은 가맹점의 미팅 vs 개인 방문). 묻지 않고 규칙을 만들면 다음 달에 전부 잘못 분류된다.

### 검증

- `edits`가 빈 배열이면 400
- `edits[].id`가 이 `analysisId`에 속하지 않으면 400. **다른 분석의 거래를 고칠 통로를 만들지 마라**
- `classification`이 `'business' | 'personal' | 'review'` 밖이면 400
- `classification !== 'business'`인데 `accountCode`가 있으면 `null`로 정규화
- `edits` 길이 상한(예: 10,000)을 둔다

### 재분류 금지

이 라우트는 AI를 호출하지 않는다. 사용자가 고친 값을 그대로 저장할 뿐이다.

### 테스트

Supabase를 모킹한다.

- 미인증 → 401
- 남의 `analysisId` → 404
- 다른 분석에 속한 `edits[].id` → 400, 갱신 호출 없음
- 정상 수정 → `is_user_edited=true`, `confidence=null`로 갱신되는지
- `classification:'personal'` + `accountCode:'travel'` → `accountCode`가 `null`로 저장되는지
- `saveAsRule:true` → `user_rules` upsert 호출, 반환된 `ruleIds` 길이
- `saveAsRule:false` → `user_rules`에 **접근하지 않는지**
- 같은 가맹점 두 번 수정 → INSERT가 아니라 upsert인지
- Anthropic이 호출되지 않는지

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/app/api/analyses
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "anthropic" src/app/api/analyses/[id]/transactions/` 가 비어 있는가?
   - `confidence`를 `null`로 만드는 코드가 있는가?
   - `saveAsRule`이 false일 때 `user_rules`를 건드리지 않는가?
   - upsert의 충돌 키가 `(owner_id, merchant_pattern)`인가?
   - `edits[].id`의 소속 검증이 있는가?
   - service role 클라이언트를 쓰지 않는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 14를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 엔드포인트·규칙 학습 조건·`confidence` 처리를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 수정된 건에 `confidence`를 남기지 마라. 이유: 사용자가 확정한 건이 계속 "확인 필요"로 다시 올라온다.
- `saveAsRule`이 false인데 규칙을 만들지 마라. 이유: 같은 가맹점이라도 건마다 성격이 다르며, 임의 규칙은 다음 달 전건을 잘못 분류한다.
- 규칙을 INSERT로 쌓지 마라. 이유: 같은 가맹점에 규칙이 여러 개면 `applyRules`의 결과가 예측 불가능해진다. upsert를 쓴다.
- 다른 분석의 거래를 수정할 수 있게 두지 마라. 이유: `analysisId`만 검사하고 `edits[].id`를 검사하지 않으면 남의 데이터로 가는 통로가 열린다.
- AI를 호출하지 마라. 이유: 이 라우트는 사용자 입력을 저장할 뿐이며, 재분류는 비용과 덮어쓰기 문제를 만든다.
- 남의 분석에 403을 반환하지 마라. 이유: 존재 여부를 노출한다. 404를 쓴다.
- service role 클라이언트를 쓰지 마라. 이유: 사용자 세션으로 RLS 아래서 동작해야 한다.
- UI를 만들지 마라. 이유: step15의 범위다.
- 기존 테스트를 깨뜨리지 마라.
