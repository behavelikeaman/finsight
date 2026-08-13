# Step 8: classify-api

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL 전체 + 비용 규칙)
- `/docs/ARCHITECTURE.md`
- `/docs/ADR.md` (특히 ADR-004, ADR-006, ADR-007, ADR-008, ADR-009)
- `/src/lib/rules.ts`, `/src/lib/quota.ts` (step 7)
- `/src/lib/redact.ts`
- `/src/services/anthropic/` 전체
- `/src/app/api/parse/route.ts` (step 6 — 에러 응답 형식을 맞춘다)

## 작업

`src/app/api/classify/route.ts`에 `POST /api/classify`를 구현한다. step 7에서 만든 관문을 여기서 연결한다.

### 계약

요청:
```ts
{ transactions: Transaction[] }
```

응답 (200):
```ts
{
  classifications: Classification[];
  stats: {
    total: number;
    fromRules: number;      // AI를 거치지 않은 건수
    fromAi: number;
    uncertainCount: number; // 확인 필요 섹션에 들어갈 건수
  };
  quota: { used: number; limit: number; resetAt: string | null };
}
```

에러는 step 6과 동일한 `{ error: { code, message } }` 형식. 코드 예: `QUOTA_EXCEEDED`(429), `TRIAL_ALREADY_USED`(429), `CLASSIFICATION_FAILED`(502).

### 흐름 — 순서를 바꾸지 마라

1. **인증 판별.** 세션이 있으면 `userId` + `profiles.tier`, 없으면 익명.
2. **쿼터 검사.**
   - 인증: `checkQuota(userId, "analysis")`. 실패 시 429 `QUOTA_EXCEEDED`.
   - 익명: `computeVisitorHash(ip, ua)` → `checkAnonymousTrial`. 실패 시 429 `TRIAL_ALREADY_USED`.
   - 익명 요청의 거래 수가 `TIER_LIMITS.anonymous.maxTransactionsPerUpload`를 넘으면 400.
3. **규칙 선적용.** 익명은 규칙이 없으므로 건너뛴다. 인증 사용자는 `user_rules`를 조회해 `applyRules`.
4. **AI 분류.** `remaining`이 비어 있으면 AI를 호출하지 마라 — 규칙만으로 전부 분류된 경우다. 이때도 쿼터는 소비하지 않는다.
5. **쿼터 소비.** AI 호출이 성공한 뒤에만 `consumeQuota` / `consumeAnonymousTrial`. AI가 실패했는데 쿼터가 깎이면 안 된다.
6. **병합.** `classified`(규칙) + AI 결과를 합쳐 원래 거래 순서대로 정렬해 반환한다.

### 확신도 임계값

`confidence < 0.7`인 건은 `label`을 강제로 `"uncertain"`으로 바꾼다 (ADR-007). 임계값은 `src/lib/constants.ts`에 상수로 두어 나중에 조정 가능하게 하라.

AI가 `business`라고 했지만 확신도가 낮은 경우, 원래 라벨을 버리지 말고 `reason`에 "AI 추정: 사업경비(확신도 낮음)" 형태로 남겨 사용자가 판단할 근거를 준다.

### 저장

인증 사용자의 경우에만 `transactions`와 `classifications`를 DB에 저장한다. 익명은 저장하지 않는다.

`uploads` 레코드도 여기서 만든다. `storage_path`는 이 step에서 null로 둔다 (원본 업로드는 이 phase 범위 밖).

저장은 트랜잭션으로 묶어라. 거래는 저장됐는데 분류가 실패해 고아 레코드가 남으면 안 된다.

### 부분 실패 처리

AI 배치 중 일부가 실패하면, 성공한 배치의 결과는 살리고 실패한 거래는 `label: "uncertain"`, `confidence: 0`, `reason: "분류 실패 — 다시 시도해 주세요"`로 채워 반환한다. 전체를 502로 버리지 마라 — 사용자가 300건 중 280건의 결과를 잃는다.

단, **전 배치가 실패한 경우**에는 502 `CLASSIFICATION_FAILED`를 반환하고 쿼터를 소비하지 마라.

### 테스트

`src/app/api/classify/__tests__/route.test.ts`. Anthropic·Supabase 모킹.

필수 케이스:
- **쿼터 초과 시 Anthropic이 호출되지 않는지** (핵심 회귀 테스트)
- **AI 실패 시 쿼터가 소비되지 않는지** (핵심 회귀 테스트)
- 규칙으로 전부 분류되면 AI 호출 0, 쿼터 소비 0
- `confidence < 0.7`이 `uncertain`으로 강등되는지
- 익명 요청이 DB에 저장되지 않는지
- 부분 실패 시 성공분이 보존되는지
- 반환된 `classifications` 개수가 입력 거래 수와 일치하는지

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 신규 테스트 포함 전부 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 쿼터 검사 없이 Anthropic에 도달하는 경로가 하나도 없는가? (코드를 직접 읽어 확인하라)
   - 마스킹이 서비스 계층에서 강제되는가?
   - 익명 사용자의 데이터가 저장되지 않는가?
   - CLAUDE.md CRITICAL 규칙을 위반하지 않았는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 8을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 쿼터 검사보다 먼저 Anthropic을 호출하지 마라. 이유: 한도를 넘은 사용자가 무제한으로 원가를 발생시킨다.
- AI 호출 전에 쿼터를 소비하지 마라. 이유: API 장애 시 사용자가 쓰지도 않은 횟수를 잃는다.
- 규칙 선적용을 건너뛰고 전 거래를 AI로 보내지 마라. 이유: ADR-008의 원가 절감이 사라진다.
- 부분 실패를 전체 실패로 처리하지 마라. 이유: 사용자가 대부분의 결과를 잃는다.
- 익명 사용자의 거래를 DB에 저장하지 마라 (ADR-012).
- 세무 판단 문구를 응답에 추가하지 마라 (ADR-006).
- 확신도 임계값을 코드 여러 곳에 하드코딩하지 마라. `constants.ts` 한 곳.
- 기존 테스트를 깨뜨리지 마라
