# Step 4: anthropic-service

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` (CRITICAL — API 키 서버 전용, 마스킹 강제, 세무조언 금지, 프롬프트 캐싱)
- `/docs/ADR.md` (특히 ADR-003, ADR-004, ADR-006, ADR-007, ADR-009)
- `/src/types/` 전체
- `/src/lib/csv/` 전체
- `/src/lib/redact.ts`

## 작업

`src/services/anthropic/`에 Claude API 래퍼를 구현한다. 라우트 핸들러(step 6, 8)가 이 모듈만 호출하게 만든다.

모델은 `claude-opus-5`를 사용한다. `@anthropic-ai/sdk`를 설치한다.

### `src/services/anthropic/client.ts`

```ts
export function getClient(): Anthropic;
```

`ANTHROPIC_API_KEY` 환경변수로 클라이언트를 생성한다. 이 모듈은 서버에서만 import 되어야 하므로 파일 최상단에 `import "server-only";`를 넣어라. 이유: 클라이언트 컴포넌트에서 실수로 import하면 빌드 타임에 실패해야 한다. `server-only` 패키지를 설치하라.

### `src/services/anthropic/infer-mapping.ts`

```ts
export async function inferColumnMapping(
  rows: string[][],
  encoding: "utf-8" | "cp949",
): Promise<ColumnMapping>;
```

ADR-003의 컬럼 매핑 추론. 요구사항:

- **상위 20행만** 보낸다. 전체 파일을 보내면 비용이 폭증하고 얻는 것이 없다.
- 보내기 전 `redactTransactions`가 아닌 `redactText`를 각 셀에 적용한다. 이 시점엔 아직 `Transaction`이 아니다.
- 구조화 출력(`output_config.format`)으로 `ColumnMapping`의 JSON 스키마를 강제한다. 자유 텍스트 응답을 파싱하지 마라.
- `fingerprint`는 AI가 만드는 값이 아니다. `computeFingerprint`로 로컬 계산해 결과에 채워 넣는다.
- 반환된 컬럼 인덱스가 실제 행 길이 범위 안인지 검증하고, 벗어나면 예외를 던진다.

### `src/services/anthropic/classify.ts`

```ts
export async function classifyTransactions(
  transactions: Transaction[],
): Promise<Classification[]>;
```

요구사항:

- **호출 전 `redactTransactions`를 반드시 통과시킨다.** 이 함수 내부에서 호출하라 — 호출자에게 맡기면 빠뜨릴 경로가 생긴다.
- 거래내역은 **프롬프트 캐시 프리픽스**에 배치한다 (CLAUDE.md 비용 규칙). 시스템 프롬프트 + 거래내역 블록에 `cache_control: { type: "ephemeral" }`를 걸고, 변동되는 지시는 그 뒤에 둔다.
- 구조화 출력으로 `Classification[]` 스키마를 강제한다.
- 거래가 많으면 배치로 나눈다. 한 요청당 최대 200건을 권장한다. `max_tokens`는 건당 출력이 필요하므로 넉넉히 잡고, 큰 배치는 스트리밍을 쓴다.
- 모든 입력 거래에 대해 정확히 하나의 `Classification`이 돌아와야 한다. 누락된 `transactionId`가 있으면 `label: "uncertain"`, `confidence: 0`으로 채워 반환한다. 조용히 드롭하지 마라.
- `source`는 항상 `"ai"`로 채운다.

시스템 프롬프트 요구사항:
- 역할: 한국 프리랜서·1인 사업자의 카드 거래를 사업경비/개인지출로 분류
- 판단 근거로 가맹점 업종, 금액대, 요일·시각 패턴을 쓰도록 지시
- **세무 판단을 하지 말 것을 명시적으로 금지한다** (ADR-006). "경비 처리 가능/불가", "한도 초과", "증빙 필요" 같은 표현을 생성하지 않도록 프롬프트에 못박아라.
- 애매하면 `"uncertain"`으로 두고 낮은 확신도를 반환하도록 지시한다. 억지로 확정하지 않게 하는 것이 ADR-007의 전제다.
- `reason`은 한 문장, 사용자에게 그대로 노출된다고 알려준다.

### `src/services/anthropic/prompts.ts`

시스템 프롬프트 문자열을 상수로 분리한다. 이유: 프롬프트 캐싱은 프리픽스 바이트 일치가 조건이므로, 프롬프트에 타임스탬프·UUID 같은 변동 값이 섞이면 캐시가 매번 무효화된다. 상수로 두면 실수를 막을 수 있다.

### 테스트

`src/services/anthropic/__tests__/`에 작성한다. **실제 API를 호출하지 마라.** SDK를 모킹한다.

- `classifyTransactions`가 마스킹되지 않은 데이터를 SDK에 넘기지 않는지 (모킹된 호출 인자를 검사)
- 응답에 누락된 `transactionId`가 있을 때 `uncertain`으로 채워지는지
- 200건 초과 시 배치가 나뉘는지
- `inferColumnMapping`이 범위를 벗어난 컬럼 인덱스를 받으면 예외를 던지는지

## Acceptance Criteria

```bash
npm run build   # 컴파일 에러 없음
npm test        # 신규 테스트 포함 전부 통과
npm run lint    # 에러 없음
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트를 확인한다:
   - 코드가 `src/services/anthropic/`에 있는가?
   - `import "server-only"`가 있는가?
   - 마스킹이 서비스 내부에서 강제되는가?
   - 시스템 프롬프트에 세무조언 금지가 들어있는가?
   - 캐시 프리픽스 배치가 되어 있는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 4를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary": "산출물 한 줄 요약"`
   - 수정 3회 시도 후에도 실패 → `"status": "error"`, `"error_message": "구체적 에러 내용"`
   - 사용자 개입 필요 (예: `ANTHROPIC_API_KEY` 미설정으로 검증 불가) → `"status": "blocked"`, `"blocked_reason": "구체적 사유"` 후 즉시 중단

## 금지사항

- 마스킹을 호출자 책임으로 미루지 마라. `classifyTransactions` 내부에서 `redactTransactions`를 호출하라. 이유: 호출 경로가 늘어나면 한 곳에서 반드시 빠뜨린다.
- 전체 CSV를 컬럼 추론에 보내지 마라. 상위 20행만. 이유: 비용이 파일 크기에 비례해 폭증하는데 추론 정확도는 나아지지 않는다.
- 프롬프트에 `new Date()`, UUID, 요청 ID 등 매 호출마다 바뀌는 값을 넣지 마라. 이유: 프롬프트 캐시가 무효화되어 CLAUDE.md 비용 규칙을 위반한다.
- 자유 텍스트 응답을 정규식이나 문자열 파싱으로 처리하지 마라. 구조화 출력을 쓴다.
- 응답에서 누락된 거래를 조용히 버리지 마라. 이유: 사용자가 거래 일부가 사라진 것을 모른 채 신고에 쓴다.
- 테스트에서 실제 Anthropic API를 호출하지 마라. 이유: CI에서 비용과 불안정성이 발생한다.
- 세무 판단 문구를 생성하는 프롬프트를 쓰지 마라 (ADR-006).
- 기존 테스트를 깨뜨리지 마라
