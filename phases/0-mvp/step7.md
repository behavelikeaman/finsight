# Step 7: rules-and-quota

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (비용 규칙 절)
- `/docs/ADR.md` (특히 ADR-008, ADR-009, ADR-012)
- `/src/types/` 전체
- `/src/services/supabase/` 전체
- `/supabase/migrations/` 전체 (step 5에서 생성)

## 작업

AI 호출 앞에 세울 두 개의 관문을 구현한다. **이 step에서는 분류 API를 건드리지 않는다** — 관문만 만들고, 연결은 step 8에서 한다.

### `src/lib/rules.ts`

```ts
export function applyRules(
  transactions: Transaction[],
  rules: UserRule[],
): { classified: Classification[]; remaining: Transaction[] };
```

동작:
- 각 거래를 규칙과 대조한다. `merchant_exact`는 가맹점명 완전 일치, `merchant_contains`는 부분 문자열 포함.
- 매칭되면 `Classification`을 만들고 `source: "rule"`, `confidence: 1`, `reason`은 어떤 규칙이 적용됐는지 한 문장으로 적는다.
- 매칭 안 된 거래는 `remaining`에 담는다. **`remaining`만 AI로 간다** — 이것이 ADR-008의 원가 절감 메커니즘이다.
- 여러 규칙이 매칭되면 `merchant_exact`를 `merchant_contains`보다 우선한다. 같은 타입 안에서는 `pattern`이 긴 쪽을 우선한다(더 구체적이므로).
- 비교는 공백 정규화 + 대소문자 무시로 한다. 한글에는 영향 없지만 영문 가맹점명(`GS25` vs `gs25`)에서 필요하다.

`classified.length + remaining.length === transactions.length`가 항상 성립해야 한다. 거래가 사라지거나 중복되면 안 된다.

### `src/lib/quota.ts`

```ts
export type QuotaKind = "analysis" | "chat";

export interface QuotaCheck {
  allowed: boolean;
  used: number;
  limit: number;
  resetAt: string | null;   // 익명은 null
}

export async function checkQuota(userId: string, kind: QuotaKind): Promise<QuotaCheck>;
export async function consumeQuota(userId: string, kind: QuotaKind): Promise<void>;
export async function checkAnonymousTrial(fingerprintHash: string): Promise<boolean>;
export async function consumeAnonymousTrial(fingerprintHash: string): Promise<void>;
```

요구사항:

- 기간 키는 `YYYY-MM` (UTC 아닌 Asia/Seoul 기준). 이유: 한국 사용자에게 "이번 달"은 KST 기준이다.
- `consumeQuota`는 **원자적**이어야 한다. `select` 후 `update`로 나누면 동시 요청에서 쿼터를 초과한다. Postgres의 `insert ... on conflict do update set analyses = usage_counters.analyses + 1`로 단일 문장 처리하라.
- `checkQuota`와 `consumeQuota`를 분리한 이유: 호출자는 먼저 검사해 사용자에게 안내하고, 실제 AI 호출이 성공한 뒤 소비를 확정할 수 있어야 한다. AI가 실패했는데 쿼터가 깎이면 안 된다.
- `checkAnonymousTrial`은 `anonymous_trials`에 해당 해시가 있으면 `false`를 반환한다.
- `TIER_LIMITS`(step 1)를 단일 진실 공급원으로 쓴다. 숫자를 이 파일에 다시 적지 마라.

### `src/lib/fingerprint-visitor.ts`

익명 체험 1회 제한용 방문자 지문 (ADR-012).

```ts
export function computeVisitorHash(ip: string, userAgent: string): string;
```

`ip + "|" + userAgent + "|" + 서버 시크릿`을 SHA-256 해시한다. 서버 시크릿은 환경변수 `VISITOR_HASH_SALT`에서 읽고, `.env.example`에 항목을 추가하라.

**원본 IP를 반환하거나 로깅하지 마라.** 해시만 밖으로 나간다. IP는 개인정보이며, 우리가 보관할 이유는 중복 방지뿐이므로 해시로 충분하다.

이 방어는 완벽하지 않다 (VPN·시크릿 창으로 우회 가능). 목적은 우발적 반복과 저비용 남용을 막는 것이지 결정적 차단이 아니다. 과도한 우회 방지 로직을 추가하지 마라.

### 테스트

`src/lib/__tests__/rules.test.ts`, `src/lib/__tests__/quota.test.ts`. Supabase는 모킹한다.

`rules.test.ts` 필수 케이스:
- exact가 contains보다 우선하는지
- 같은 타입에서 긴 패턴이 우선하는지
- 대소문자·공백 차이를 흡수하는지
- **`classified + remaining` 합이 입력과 정확히 일치하는지** (거래 유실 회귀 방지)
- 규칙이 없으면 전부 `remaining`인지

`quota.test.ts` 필수 케이스:
- 한도 도달 시 `allowed: false`
- 티어별 한도가 `TIER_LIMITS`를 따르는지
- `consumeQuota`가 단일 SQL 문으로 증가시키는지 (모킹된 호출 검사)

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 신규 테스트 포함 전부 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 코드가 `src/lib/`에 있는가?
   - `TIER_LIMITS`가 중복 정의되지 않았는가?
   - `consumeQuota`가 원자적인가?
   - 원본 IP가 어디에도 저장·로깅되지 않는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 7을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- `src/app/api/classify/`를 만들거나 수정하지 마라. 이 step은 관문만 만든다. 이유: 관문과 소비처를 같은 step에서 만들면 "쿼터 검사 없는 경로"가 생겼는지 검증하기 어려워진다.
- `consumeQuota`를 select-then-update로 구현하지 마라. 이유: 동시 요청에서 한도를 넘긴다.
- 한도 숫자를 `quota.ts`에 하드코딩하지 마라. `TIER_LIMITS`를 참조한다.
- 원본 IP를 저장하거나 로깅하지 마라.
- 정규식 기반 규칙 매칭을 추가하지 마라 (ADR-008, step 1의 타입 정의와 일치시켜라).
- `applyRules`에서 거래를 드롭하지 마라. 입력과 출력 개수가 반드시 일치해야 한다.
- 기존 테스트를 깨뜨리지 마라
