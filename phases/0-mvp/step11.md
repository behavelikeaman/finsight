# Step 11: classify-api

## 읽어야 할 파일

- `/CLAUDE.md` — CRITICAL 전체 (제품 경계·보안·비용·데이터 흐름)
- `/docs/ARCHITECTURE.md` — API 계약, 파이프라인 2단계, "분류 모드" 절
- `/docs/ADR.md` — ADR-013(쿼터), ADR-014(3단계), ADR-015(표본), ADR-017(서버 판정)
- `/src/types/api.ts`, `/src/types/tier.ts` (step1 — `ClassifyRequest/Response`, `SAMPLE_SIZE`)
- `/src/types/domain.ts` (step1 — `IdentifiedRow`. 이 파이프라인이 `id`를 어떻게 옮기는지 확인하라)
- `/src/lib/rules.ts`, `/src/lib/quota.ts` (step9 — 두 관문)
- `/src/lib/analysis/index.ts` (step4 — `pickSample`)
- `/src/services/anthropic/classify.ts` (step10 — `classifyTransactions`)
- `/src/lib/supabase/session.ts` (step7 — `requireUser`, `getEffectiveTier`, `isAnonymousUser`)
- `/src/app/api/analyze/route.ts` (step8 — 에러 응답 형식을 맞춘다)

## 작업

`src/app/api/analyses/[id]/classify/route.ts`에 `POST /api/analyses/:id/classify`를 구현한다.
step9에서 만든 두 관문과 step10의 서비스를 **여기서 배선한다.** 이 프로젝트에서 AI 비용이 발생하는 경로는 여기와 step16 둘뿐이다.

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다. `route.test.ts`를 **먼저** 작성하라.

### 처리 순서

```
1. requireUser()                          — 미인증이면 401
2. 소유 확인                                — analyses.owner_id === uid, 아니면 404
                                             (403이 아니라 404. 이유: 존재 여부를 노출하지 않는다)
3. mode 재판정                              ← 서버가 결정한다
   ├ isAnonymousUser && mode==='full'  → { ok:false, reason:'anonymous_full_denied' }
   └ 익명이면 mode는 'sample'로 강제
4. 관문 A — mode별 허용 검사
   ├ sample: checkSampleAllowance(uid)  false면 { ok:false, reason:'sample_used' }
   └ full:   checkQuota(uid,'classify') allowed:false면 { ok:false, reason:'quota_exceeded' }
5. 대상 거래 조회                            — classification IS NULL 인 건만
   └ IdentifiedRow[] 로 매핑 (id 를 반드시 실어라)
   └ sample이면 pickSample(rows, SAMPLE_SIZE)
6. 관문 B — applyRules(rows, userRules)
   └ matched 는 AI로 보내지 않고 바로 저장 (rule_id 기록)
7. classifyTransactions({ rows: unmatched })  ← 여기서만 AI 호출
8. 결과 저장                                — id 기준으로 UPDATE
                                              classification, account_code, confidence
9. 성공 시에만 consumeQuota / markSampleUsed  ← RPC 경유 (테이블 직접 쓰기 불가)
10. { ok:true, classified, fromRules, fromAi, quotaLeft }
```

### `id`로만 되짚는다

`applyRules`가 배열을 `matched`/`unmatched`로 쪼개므로 **배열 index는 원본 거래를 가리키지 못한다.** `classifyTransactions`가 반환하는 `ClassifyOutputItem.id`와 `RuleMatch.row.id`로만 UPDATE 대상을 정한다.

index로 되짚는 코드를 쓰지 마라. 조용히 엉뚱한 거래에 분류가 저장되고, 테스트에서 잘 드러나지 않는다.

### 반드시 지킬 순서

**관문 → 호출 → 차감.** 이 순서를 바꾸지 마라.

- 관문보다 AI 호출이 먼저 오면 쿼터가 무의미해진다
- 차감이 호출보다 먼저 오면 API가 실패했는데 사용자 쿼터가 깎인다

**`applyRules`가 `classifyTransactions`보다 먼저다.** 규칙에 걸린 거래는 AI로 나가지 않는다. 이게 재방문 사용자의 원가를 낮추는 구조다.

### 익명 판정

`mode`는 요청 본문에 들어오지만 **서버가 세션으로 재판정한다.** 클라이언트가 `'full'`을 보내도 익명이면 거부한다. 이유: 익명에 전건(회당 약 440원)을 열면 남용 표면이 생긴다.

익명 여부는 `isAnonymousUser(user)`로 판정한다. 요청 본문의 어떤 필드도 신뢰하지 마라.

### 이미 분류된 건

`classification IS NOT NULL`인 거래는 대상에서 제외한다. 이유: 재분류하면 사용자가 고친 값이 덮이고, AI 비용이 중복 발생한다.

`is_user_edited = true`인 건은 **어떤 경우에도 덮어쓰지 마라.**

### 부분 실패

AI 호출이 실패하면 규칙으로 분류된 건(`matched`)은 **그대로 저장하고** 에러를 반환한다. 이유: 규칙 분류는 비용이 들지 않았고 정확하다. 함께 버릴 이유가 없다.

이 경우 `consumeQuota`는 호출하지 않는다.

### 저장

`analyses.classified_at`을 갱신한다. `transactions` 갱신은 일괄 처리하되, `owner_id` 조건을 쿼리에 함께 건다(RLS가 2차 방어지만 명시적으로).

### 테스트

Supabase·Anthropic·`quota`·`rules`를 모킹한다. 실제 호출하지 마라.

- 미인증 → 401
- 남의 `analysisId` → 404
- 익명 + `mode:'full'` → `anonymous_full_denied`, **AI 호출이 일어나지 않음**
- 익명 + `mode:'sample'` + `sample_used=true` → `sample_used`, AI 호출 없음
- free + 쿼터 소진 + `mode:'full'` → `quota_exceeded`, AI 호출 없음
- 규칙이 전건 매칭 → `fromAi === 0`, **AI 호출이 일어나지 않음**
- 규칙 일부 매칭 → AI에 넘어간 배열이 `unmatched`와 일치하는지
- AI 호출 실패 → `matched`는 저장되고 `consumeQuota`는 호출되지 않음
- 성공 → `consumeQuota` 1회 호출
- `is_user_edited=true`인 건이 대상에서 빠지는지
- `mode:'sample'`일 때 AI에 넘어간 건이 `SAMPLE_SIZE` 이하인지
- **규칙이 일부만 매칭된 상태에서** AI 결과가 올바른 거래 id에 저장되는지 (index 되짚기라면 여기서 어긋난다)
- `consumeQuota`/`markSampleUsed`가 테이블 직접 쓰기가 아니라 RPC를 타는지

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
   - `checkQuota`/`checkSampleAllowance` 호출이 `classifyTransactions` 호출보다 **앞에** 있는가?
   - `consumeQuota`/`markSampleUsed`가 성공 경로에만 있는가?
   - `applyRules`가 `classifyTransactions`보다 앞에 있는가?
   - `grep -n "body.mode\|request.*mode" ` — `mode`를 재판정 없이 그대로 쓰는 곳이 없는가?
   - service role 클라이언트를 쓰지 않는가? (`grep -rn "admin" src/app/api/analyses/`)
   - 게이팅 실패 응답에 분류 결과가 없는가?
   - 분류 결과를 배열 index가 아니라 `id`로 저장하는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 11을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 엔드포인트·관문 순서·모드 재판정 방식을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 쿼터 검사 전에 AI를 호출하지 마라. 이유: 관문이 무의미해지고 비용이 새어 나간다.
- AI 호출 전에 쿼터를 차감하지 마라. 이유: 호출이 실패했는데 사용자 쿼터가 깎인다.
- `applyRules` 없이 전건을 AI로 보내지 마라. 이유: 재방문 사용자의 원가가 내려가지 않아 유닛 이코노믹스가 무너진다.
- 클라이언트가 보낸 `mode`를 그대로 신뢰하지 마라. 이유: 익명이 `'full'`을 보내면 회당 440원이 그대로 나간다.
- 이미 분류된 건이나 `is_user_edited=true`인 건을 재분류하지 마라. 이유: 사용자가 고친 값이 덮이고 비용이 중복 발생한다.
- 남의 분석에 403을 반환하지 마라. 이유: 403은 "존재하지만 권한 없음"을 알려준다. 404를 쓴다.
- service role 클라이언트를 쓰지 마라. 이유: 이 경로는 사용자 세션으로 RLS 아래서 동작해야 한다.
- 배열 index로 분류 결과를 되짚지 마라. 이유: `applyRules`가 배열을 쪼갠 뒤라 index가 원본 거래를 가리키지 못한다. 엉뚱한 거래에 분류가 저장되고 테스트에서 드러나지 않는다.
- `usage_counters`·`profiles.sample_used`를 직접 UPDATE하려 하지 마라. 이유: step6이 RLS·컬럼 권한으로 막았다. 막혔다고 정책을 푸는 마이그레이션을 추가하지 말고 RPC를 호출하라.
- 게이팅 실패 응답에 분류 결과를 담지 마라. 이유: 서버가 값을 보내지 않는 것이 유일한 게이팅 수단이다.
- 세무 판단 문구를 응답에 넣지 마라. 이유: 제품 경계다.
- 기존 테스트를 깨뜨리지 마라.
