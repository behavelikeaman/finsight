# Step 6: product-ui

사용자가 실제로 만지는 부분 전체를 만든다. **이 step이 끝나면 제품이 처음부터 끝까지 동작한다.**

**분량이 큰 step이다. 반드시 A → B → C → D → E 순서로, 각 구간의 중간 확인을 통과한 뒤 다음으로 넘어가라.** 다섯을 동시에 벌여놓으면 실패 지점을 좁힐 수 없다.

| 순서 | 범위 | 산출물 |
|---|---|---|
| A | Google 연결 · 콜백 · 삭제 | `src/lib/supabase/identity.ts`, `src/app/auth/callback/route.ts`, `src/app/api/account/route.ts`, `src/app/api/analyses/[id]/route.ts` |
| B | 수정 저장 API | `src/app/api/analyses/[id]/transactions/route.ts` |
| C | Q&A API | `src/app/api/analyses/[id]/chat/route.ts` |
| D | 랜딩 · 업로드 흐름 | `src/app/(marketing)/`, `src/components/upload/`, `src/components/preview/`, `src/components/auth/` |
| E | 대시보드 | `src/app/(app)/dashboard/`, `src/components/dashboard/` |

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다. A·B·C의 각 라우트는 `route.test.ts`를 **먼저** 작성하라. (`page.tsx`와 `components/`는 면제)

**실제 Supabase·OAuth·Anthropic을 호출하지 마라.** 전부 모킹한다. 키가 없어 blocked가 되면 이후 step이 멈춘다.

## 읽어야 할 파일

먼저 아래 파일들을 읽고 프로젝트의 아키텍처와 설계 의도를 파악하라:

- `/CLAUDE.md` — 제품 경계, 인증 규칙, 보안, 코드 배치
- `/docs/PRD.md` — 사용자, 사용자 흐름, 요금제, 디자인 절, 핵심 기능 5번
- `/docs/ARCHITECTURE.md` — "인증 — 두 개의 진입 경로", API 계약, "읽기는 라우트를 만들지 않는다", 게이팅 응답
- `/docs/DESIGN.md`, `/docs/design-system/` — 토큰·컴포넌트 원본
- `/docs/ADR.md` — ADR-001, ADR-009~013, ADR-015, ADR-016, ADR-018
- `/src/types/api.ts`, `/src/types/analysis.ts`, `/src/types/tier.ts`, `/src/types/domain.ts`
- `/src/lib/ingest/index.ts`, `/src/lib/mapping/index.ts` — 브라우저 파싱·매핑
- `/src/lib/analysis/index.ts` — `bucketByClassification`
- `/src/lib/rules.ts` — `derivePattern`
- `/src/lib/supabase/auth.ts` — `ensureSession`, `decideAuthRoute` (**반드시 읽어라**)
- `/src/lib/supabase/session.ts`, `/src/lib/supabase/server.ts`, `/src/middleware.ts`
- `/src/lib/quota.ts` — `checkQuota`, `consumeQuota`
- `/src/services/anthropic/chat.ts`, `/src/services/anthropic/prompt.ts` — `askAboutLedger`, `buildPromptBlocks`
- `/src/app/api/analyses/[id]/classify/route.ts` — 소유 확인·관문 순서·응답 관례를 그대로 맞춰라
- `/src/app/globals.css` — Tailwind `@theme` 토큰

이전 step에서 만들어진 코드를 꼼꼼히 읽고, 설계 의도를 이해한 뒤 작업하라.

---

# A. 계정 연결과 삭제

Google 계정 연결 플로우와 데이터 삭제를 구현한다. UI는 D·E에서 붙이고, 여기서는 **동작하는 함수와 라우트**를 만든다.

## A-1. 두 경로 (`src/lib/supabase/identity.ts`)

`decideAuthRoute`가 고른 경로를 실제로 수행한다.

```ts
/** 익명 세션의 결과를 유지한 채 Google을 연결한다. uid가 그대로 남는다. */
export async function linkGoogle(redirectTo: string): Promise<{ error?: LinkError }>

/** 기존 계정으로 진입한다. 재방문자 경로. */
export async function signInGoogle(redirectTo: string): Promise<void>

export type LinkError = 'already_linked' | 'identity_taken' | 'unknown'
```

- `linkGoogle` → `supabase.auth.linkIdentity({ provider: 'google', options: { redirectTo } })`
- `signInGoogle` → `supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo } })`

> **익명 세션에 결과가 있을 때 `signInWithOAuth()`를 부르면 새 계정이 만들어져 uid가 버려지고 사용자가 분석을 잃는다.** 호출 전에 반드시 `decideAuthRoute`로 분기하라. 두 함수를 직접 호출하는 코드는 이 파일 밖에 두지 마라.

## A-2. 실패 처리

`linkIdentity`가 실패해도 **현재 익명 세션과 그 결과는 그대로 남아야 한다.** 세션을 정리하거나 로그아웃시키지 마라.

이미 다른 계정에 연결된 Google이면 `identity_taken`을 반환하고, UI는 이렇게 안내한다:

> "이미 사용 중인 Google 계정입니다. 로그인 후 이 파일을 다시 올려 주세요."

기존 계정과의 **병합은 구현하지 않는다.** MVP 범위 밖이다.

## A-3. OAuth 콜백 (`src/app/auth/callback/route.ts`)

`code`를 세션으로 교환하고 원래 위치로 돌려보낸다.

```ts
// GET /auth/callback?code=...&next=/dashboard
// exchangeCodeForSession(code) → redirect(next ?? '/dashboard')
// 실패 시 에러 쿼리를 달아 프리뷰로 돌려보낸다. 결과를 잃지 않게.
```

`next` 파라미터는 **같은 오리진의 경로만** 허용한다. 외부 URL을 그대로 리다이렉트하지 마라. 이유: 오픈 리다이렉트 취약점이 된다.

## A-4. 데이터 삭제 (`src/app/api/account/route.ts`)

```ts
// DELETE /api/account → OkResponse
```

처리: `requireUser()` → 해당 사용자의 `analyses` 삭제(`transactions`는 `ON DELETE CASCADE`로 따라간다) → `user_rules` 삭제 → `signOut()`.

**`usage_counters`를 지우지 마라.** 이유: 카운터가 0부터 다시 시작하면 무료 사용자가 "내 데이터 전체 삭제 → 재업로드"만 반복해 월 1회 제한을 무한히 우회한다. 사용량 기록은 금융 데이터가 아니므로 삭제 요구의 대상도 아니다. 애초에 지울 수도 없다 — `usage_counters`에 사용자 DELETE 정책이 없다.

**`profiles`는 건드리지 마라.** `tier`·`polar_*`·`current_period_end`는 구독이 Polar 쪽에 살아 있으므로 지우면 결제한 사용자가 재로그인 시 free가 된다. `sample_used`도 마찬가지로 되돌리지 마라 — 익명 표본 분류를 무한히 쓰는 통로가 된다. 이 컬럼들은 `revoke update` 대상이라 사용자 세션으로는 갱신 자체가 불가능하다.

**`auth.users`를 삭제하지 마라.** 이유: admin API가 필요한데 service role 사용을 웹훅 한 곳으로 제한했다. 계정 자체 삭제는 다음 phase다.

따라서 이 기능의 사용자 표기는 **"내 데이터 전체 삭제"** 다. 라우트 주석과 이후 UI 문구 모두 그렇게 쓴다.

> **UI에 "계정 삭제"라고 쓰지 마라.** 이유: 계정은 남는데 사용자가 사라졌다고 믿으면 그 자체가 신뢰 문제다. 금융 데이터에서는 특히 그렇다.

## A-5. 분석 삭제 (`src/app/api/analyses/[id]/route.ts`)

```ts
// DELETE /api/analyses/:id → OkResponse
```

소유 확인 후 삭제. 남의 분석에는 404(403이 아니다).

## A-6. 테스트

- `decideAuthRoute`가 `'link'`일 때 `linkIdentity`가, `'signin'`일 때 `signInWithOAuth`가 호출되는지
- `linkIdentity` 실패 시 `signOut`이 **호출되지 않는지** (결과 보존)
- `identity_taken` 매핑
- 콜백이 외부 URL `next`를 거부하는지
- `DELETE /api/account`가 미인증에서 401이고, 정상 시 `analyses`·`user_rules` 삭제와 `signOut`을 호출하는지
- `DELETE /api/account`가 `profiles`를 변경하지 **않는지**
- `DELETE /api/account`가 `usage_counters`에 **접근하지 않는지**
- `DELETE /api/analyses/:id`가 남의 분석에 404를 반환하는지

**중간 확인**: `npx vitest run src/lib/supabase src/app/auth src/app/api/account` 통과 후 B로.

---

# B. 수정 저장 API (`src/app/api/analyses/[id]/transactions/route.ts`)

`PATCH`. 사용자가 고친 분류를 저장하고, **선택 시 규칙으로 학습**한다.

유닛 이코노믹스에서의 위치: 여기서 저장된 규칙이 다음 분석의 AI 호출 건수를 줄인다(분류 API의 관문 B).

## B-1. 처리 순서

```
1. requireUser()                     — 미인증이면 401
2. 소유 확인                           — analyses.owner_id === uid, 아니면 404
3. edits 검증                         — 각 id가 이 분석에 속하는지, 값이 유효한 enum인지
4. transactions 갱신                  — classification, account_code,
                                        is_user_edited = true, confidence = null
5. saveAsRule이면 user_rules upsert   — derivePattern(merchant) 기준
6. { ok:true, ruleIds }
```

## B-2. `is_user_edited`와 `confidence`

수정된 건은 `is_user_edited = true`, **`confidence`는 `null`로 만든다.**

이유: 확신도는 AI 판단의 속성이다. 사람이 확정한 건에 AI의 확신도를 남겨두면, `bucketByClassification`이 낮은 확신도를 보고 다시 "확인 필요"로 올린다. 사용자가 방금 확정한 건이 계속 재확인 목록에 뜨는 버그가 된다.

## B-3. 규칙 학습 (`saveAsRule`)

`derivePattern(merchant)`로 패턴을 만들고 `user_rules`에 **upsert** 한다. 충돌 키는 `(owner_id, merchant_pattern)`이다.

같은 가맹점을 다시 고치면 새 규칙이 생기는 게 아니라 기존 규칙이 갱신되어야 한다. 이유: 규칙이 쌓이면 `applyRules`에서 어느 것이 이기는지 예측할 수 없어진다.

**`saveAsRule`이 false면 규칙을 만들지 마라.** 사용자가 이번 건만 고치려는 경우가 있다(같은 가맹점의 미팅 vs 개인 방문). 묻지 않고 규칙을 만들면 다음 달에 전부 잘못 분류된다.

## B-4. 검증

- `edits`가 빈 배열이면 400
- `edits[].id`가 이 `analysisId`에 속하지 않으면 400. **다른 분석의 거래를 고칠 통로를 만들지 마라**
- `classification`이 `'business' | 'personal' | 'review'` 밖이면 400
- `classification !== 'business'`인데 `accountCode`가 있으면 `null`로 정규화
- `edits` 길이 상한(예: 10,000)을 둔다

이 라우트는 AI를 호출하지 않는다. 사용자가 고친 값을 그대로 저장할 뿐이다.

## B-5. 테스트

- 미인증 → 401 / 남의 `analysisId` → 404
- 다른 분석에 속한 `edits[].id` → 400, 갱신 호출 없음
- 정상 수정 → `is_user_edited=true`, `confidence=null`로 갱신되는지
- `classification:'personal'` + `accountCode:'travel'` → `accountCode`가 `null`로 저장되는지
- `saveAsRule:true` → `user_rules` upsert 호출, 반환된 `ruleIds` 길이
- `saveAsRule:false` → `user_rules`에 **접근하지 않는지**
- 같은 가맹점 두 번 수정 → INSERT가 아니라 upsert인지
- Anthropic이 호출되지 않는지

**중간 확인**: `npx vitest run src/app/api/analyses` 통과 후 C로.

---

# C. Q&A API (`src/app/api/analyses/[id]/chat/route.ts`)

`POST`. **Pro 전용 기능이다.** UI는 E에서 붙인다.

## C-1. 처리 순서

```
1. requireUser()                    — 미인증이면 401
2. 소유 확인                          — analyses.owner_id === uid, 아니면 404
3. checkQuota(uid, 'chat')
   ├ reason 'tier_required'   → { ok:false, reason:'tier_required' }   (free 티어)
   └ reason 'quota_exceeded'  → { ok:false, reason:'quota_exceeded' }  (Pro 소진)
4. 질문 검증                          — 빈 문자열 거부, 길이 상한
5. 거래 조회 → IdentifiedRow[] 로 매핑 → askAboutLedger(rows, question)
6. 성공 시에만 consumeQuota(uid, 'chat')
7. { ok:true, answer, quotaLeft }
```

`tier_required`와 `quota_exceeded`를 **구분해서 반환한다.** UI가 "Pro 기능입니다"와 "이번 달 100건을 다 쓰셨습니다"를 다르게 안내해야 한다.

## C-2. 캐시 프리픽스

`askAboutLedger`는 `buildPromptBlocks`로 **분류 API와 동일한 프리픽스**를 만든다. 여기서 거래내역을 다르게 정렬하거나 다르게 포맷하면 캐시가 미스되어 질문마다 전체 내역이 재과금된다.

거래 조회 시 **정렬을 고정하라**(`occurred_on`, `id` 순). DB가 반환 순서를 보장하지 않으므로, 명시하지 않으면 호출마다 프리픽스가 달라질 수 있다.

## C-3. 답변 경계

시스템 프롬프트는 `src/services/anthropic/`에 있다. 이 라우트는 **응답을 그대로 반환할 뿐 가공하지 않는다.** 단, 응답에 세무 판단이 섞여 나올 수 있으므로 UI에 세무 고지를 함께 노출한다.

## C-4. 테스트

- 미인증 → 401 / 남의 `analysisId` → 404
- free 티어 → `tier_required`, **Anthropic 호출 없음**
- Pro + 쿼터 소진 → `quota_exceeded`, Anthropic 호출 없음
- 빈 질문 → 400
- 성공 → `consumeQuota` 1회 호출
- Anthropic 실패 → `consumeQuota` **호출 안 됨**
- 같은 분석에 두 번 질의 → `buildPromptBlocks`에 전달된 거래 배열이 동일한 순서인지

**중간 확인**: `npx vitest run src/app/api` 통과 후 D로.

---

# D. 랜딩과 업로드 흐름 (`src/app/(marketing)/`)

이 구간이 완료되면 **"명세서를 올리면 AI가 경비를 가른다"는 제품 핵심 가설이 실제로 검증 가능한 상태**가 된다.

## D-1. 대상 독자

한국의 프리랜서·1인 사업자다. "AI로 소비 패턴을 분석해드립니다" 같은 일반론은 이 사람에게 아무 의미가 없다. 카피는 구체적인 상황에서 출발해야 한다: 신고철에 카드 명세서를 열어 사업경비를 손으로 골라내는 그 작업.

## D-2. 화면 흐름

```
1. 랜딩 (Server Component)      — 히어로 + 드롭존 + 요금제 + 고지
2. 파일 드롭 (Client)           — ensureSession() → ingestFile()
3. 컬럼 매핑 확인 (Client)      — guessMapping() 결과를 드롭다운으로 교정
4. 분석 실행 (Client)           — normalizeRows() → POST /api/analyze
5. 집계 프리뷰 (Client)         — 총액·월별·상위 가맹점
6. 표본 분류 (Client)           — POST /api/analyses/:id/classify { mode:'sample' }
7. 계정 연결 유도               — decideAuthRoute() → linkGoogle() | signInGoogle()
```

## D-3. 랜딩 (`src/app/(marketing)/page.tsx`)

**Server Component로 작성한다.** 드롭존만 Client다.

- 히어로 — 문제 서술이 먼저, 기능 나열은 그 다음
- 요금제 표 — 숫자는 `src/types/tier.ts`의 `QUOTA`에서 읽는다. **하드코딩하지 마라**
- 데이터 취급 고지 — "원본 파일은 서버로 전송되지 않습니다", "거래내역은 분석을 위해 국외(Anthropic)로 전송됩니다", "카드번호는 저장하지 않습니다". 이 문구를 드롭존 근처에 둔다. 숨기지 마라
- **세무 고지** — "분류 결과는 참고용이며, 최종 판단은 세무 대리인과 상의하세요"

## D-4. 드롭존 (`src/components/upload/DropZone.tsx`)

`'use client'`. `.csv`·`.xlsx`만 받는다.

**드롭 시점에 `ensureSession()`을 호출한다.** 랜딩이 렌더될 때가 아니다. 이유: 구경꾼·크롤러까지 `auth.users` 행을 만들면 안 된다.

`ingestFile()`은 브라우저에서 실행된다. 10,000행 초과는 여기서 잡아 안내한다.

## D-5. 컬럼 매핑 UI (`src/components/upload/MappingPanel.tsx`)

`guessMapping()` 결과를 미리 채운 드롭다운 3개(날짜/가맹점/금액)와, 상위 5행 미리보기 표를 함께 보여준다.

**미리보기가 있어야 하는 이유**: 매핑이 맞는지는 값을 봐야 안다. 헤더 이름만으로는 원화 컬럼과 외화 컬럼을 구분하지 못한다.

`validateMapping()`의 이슈를 인라인으로 표시한다. `missing`이면 실행 버튼을 막는다.

## D-6. 프리뷰 (`src/components/preview/PreviewPanel.tsx`)

`/api/analyze` 응답의 `summary`를 렌더한다 — 총액, 월별, 상위 가맹점. **여기까지는 LLM이 관여하지 않았다.**

이어서 `mode:'sample'`로 분류를 요청하고, 돌아온 20건을 분류 상태별 색으로 표시한다.

나머지 건에 대한 문구:

> "상위 {SAMPLE_SIZE}건을 분류했습니다. 나머지 {n}건은 Google 계정을 연결하면 분류합니다."

**나머지 건을 블러 처리하지 마라.** 아직 분류되지 않았을 뿐 가려진 값이 없다. 없는 결과를 있는 것처럼 위장하는 UI를 만들지 마라 — 개발자도구로 걷히기도 하고, 정직하지도 않다.

`sample_used`로 거부되면(`reason:'sample_used'`) 집계 프리뷰만 보여주고 계정 연결을 유도한다.

## D-7. 계정 연결 (`src/components/auth/ConnectPanel.tsx`)

**반드시 `decideAuthRoute()`로 분기한다.**

```
isAnonymous && 방금 만든 분석이 있음  → linkGoogle()
그 외                                → signInGoogle()
```

이 판정을 여기서 다시 구현하지 마라. `src/lib/supabase/auth.ts`의 함수를 부른다. `identity_taken` 에러는 A-2의 문구로 안내한다.

## D-8. 중복 업로드

`/api/analyze`가 `reason:'duplicate'`를 반환하면 "취소 / 기존 결과 보기" 두 선택지를 제시한다. 조용히 넘어가거나 새로 저장하지 마라.

**중간 확인**: `npm run lint && npm run build` 통과 후 E로.

---

# E. 대시보드 (`src/app/(app)/dashboard/`)

로그인 후 화면. **표가 주인공이고 차트는 보조다.** 시각 언어는 D의 `PreviewPanel`과 맞춘다.

## E-1. 분석 목록 (`dashboard/page.tsx`)

**Server Component.** Supabase에서 직접 조회한다. 이것만을 위한 API 라우트를 만들지 마라.

`analyses`를 최신순으로. 각 행에 카드 라벨·기간·행 수·분류 완료 여부(`classified_at`).

## E-2. 분석 상세 (`dashboard/[id]/page.tsx`)

**Server Component에서 조회**하고, 인터랙션이 필요한 표만 Client로 분리한다.

화면 구성 순서:

```
1. 요약 바        총액 / 사업경비 합계 / 개인지출 합계 / 미확정 건수
2. 확인 필요       ← 항상 최상단. 확신도 낮은 건 + 미분류 건
3. 사업경비        계정과목별 그룹
4. 개인지출
5. 세무 고지       "최종 판단은 세무 대리인과 상의하세요"
```

`bucketByClassification()`을 써서 나눈다. 버킷 로직을 여기서 다시 구현하지 마라.

**요약 바의 사업경비 합계에 `review`·`unclassified` 금액을 더하지 마라.** `src/lib/analysis`가 이미 그렇게 계산한다. 미확정 건수는 별도로 표시한다. 이유: 확인이 안 끝난 금액을 경비 합계에 넣으면 사용자가 그 숫자를 신고에 쓴다.

## E-3. 분류 표 (`src/components/dashboard/TransactionTable.tsx`)

`'use client'`. 고밀도 표.

- 컬럼: 날짜 / 가맹점 / 금액 / 분류 / 계정과목 / 출처
- **출처 컬럼**: 규칙(`fromRule`)·AI·사용자 수정(`isUserEdited`)을 구분해 보여준다. 이유: 사용자가 "왜 이렇게 분류됐지"를 물을 수 있어야 신뢰가 생긴다
- 분류·계정과목은 인라인 드롭다운으로 수정
- 수정 시 **낙관적 업데이트** 후 `PATCH /api/analyses/:id/transactions` 호출. 실패하면 되돌리고 안내
- 계정과목 드롭다운은 `classification === 'business'`일 때만 활성화

### 규칙 저장 확인

수정 후 **"이 가맹점은 앞으로도 이렇게 분류할까요?"** 를 묻고, 응답에 따라 `saveAsRule`을 보낸다.

묻지 않고 항상 규칙을 만들지 마라. 이유: 같은 가맹점이라도 미팅과 개인 방문이 섞인다. 임의 규칙은 다음 달 전건을 잘못 분류한다.

## E-4. 전건 분류 실행

`classified_at`이 비어 있거나 미분류 건이 남아 있으면 "전체 분류" 버튼을 노출하고 `POST /api/analyses/:id/classify { mode:'full' }`을 호출한다.

응답별 처리:
- `quota_exceeded` → 남은 횟수와 다음 갱신 시점을 안내하고 Pro CTA. **분류 결과를 임의로 채우지 마라**
- `ok:true` → `revalidatePath`로 서버 상태 갱신

쿼터 잔여는 서버 응답의 `quotaLeft`만 쓴다. 클라이언트에서 계산하지 마라.

## E-5. 차트 (`src/components/dashboard/MonthlyChart.tsx`)

Recharts로 월별 사업경비/개인지출 막대. **보조 역할이다.** 화면 상단을 차지하지 않게 두고, 표 아래에 배치한다. 색은 분류 상태 토큰만 쓴다.

## E-6. Q&A 패널 (`src/components/dashboard/ChatPanel.tsx`)

`'use client'`. 분석 상세 하단에 배치한다. C의 라우트를 호출한다.

- free 티어면 **패널 자체를 렌더하지 않고** Pro 안내를 보여준다. `getEffectiveTier()`로 서버에서 판정한다
- 입력창 + 답변 목록. 대화 이력은 **저장하지 않는다**(MVP 범위 밖). 페이지를 벗어나면 사라진다는 것을 문구로 알린다
- 남은 횟수는 서버 응답의 `quotaLeft`만 쓴다
- 세무 고지를 함께 노출한다

## E-7. 내보내기 (Pro)

CSV 내보내기와 인쇄용 CSS. Pro 전용이므로 `getEffectiveTier()`로 **서버에서 판정**하고, free면 버튼 자체를 렌더하지 않는다. CSS로 숨기지 마라 — 개발자도구로 걷힌다.

## E-8. 데이터 삭제 진입점

설정 영역에 **"내 데이터 전체 삭제"** 를 둔다. `DELETE /api/account` 호출. **"계정 삭제"라고 쓰지 마라.** 계정은 남는다.

## E-9. 디자인 (D·E 공통)

`src/app/globals.css`의 `@theme` 토큰만 쓴다. hex를 컴포넌트에 하드코딩하지 마라.
색은 **분류 상태 3종(business/personal/review)에만** 쓴다. 금액은 tabular-nums, 천 단위 구분자, 원화 표기. 라이트모드 고정.

---

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/supabase src/app/auth src/app/api
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -rn "linkIdentity\|signInWithOAuth" src/` 결과가 `src/lib/supabase/identity.ts`에만 나오는가?
   - `grep -rn "usage_counters\|sample_used\|profiles" src/app/api/account/` 가 비어 있는가?
   - `grep -rn "admin\|service_role" src/app/api/` 가 비어 있는가?
   - `grep -rniE "계정 삭제|계정을 삭제" src/` 가 비어 있는가?
   - 콜백이 `next`의 오리진을 검사하는가? `grep -rn "admin.auth.deleteUser" src/` 가 비어 있는가?
   - `grep -rn "anthropic" src/app/api/analyses/[id]/transactions/` 가 비어 있는가?
   - `confidence`를 `null`로 만드는 코드가 있는가? `saveAsRule`이 false일 때 `user_rules`를 건드리지 않는가?
   - upsert의 충돌 키가 `(owner_id, merchant_pattern)`인가? `edits[].id`의 소속 검증이 있는가?
   - chat 라우트에서 `checkQuota`가 `askAboutLedger`보다 앞에 있고, `consumeQuota`가 성공 경로에만 있는가?
   - `tier_required`와 `quota_exceeded`를 구분해 반환하는가? 게이팅 실패 응답에 `answer`가 없는가?
   - 거래 조회 쿼리에 `order by`가 명시되어 있는가? `buildPromptBlocks`를 재사용하는가?
   - `grep -rn "ensureSession" src/` 가 드롭 핸들러에만 있는가? (`page.tsx`·`layout.tsx`에 있으면 위반)
   - `grep -rniE "blur|backdrop-filter" src/components/` 가 비어 있는가?
   - `grep -rn "#[0-9a-fA-F]\{6\}" src/components/` 가 비어 있는가?
   - 요금제 숫자가 `src/types/tier.ts`에서 오는가? `FormData`로 파일을 전송하는 코드가 없는가?
   - 목록·상세 조회용 API 라우트를 새로 만들지 않았는가?
   - `bucketByClassification`을 import 하는가? 사업경비 합계에 `review`·`unclassified`가 섞이지 않는가?
   - `grep -rniE "blur|display:\s*none.*pro|hidden.*pro" src/components/dashboard/` — Pro 기능을 CSS로 숨기지 않는가?
   - 세무 고지 문구가 프리뷰 화면과 상세 화면 양쪽에 있는가? 규칙 저장 전에 사용자에게 묻는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 identity 함수, 라우트 5개 경로, 랜딩·대시보드 페이지와 주요 컴포넌트 경로를 한 줄로
   - 수정 3회 시도 후에도 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 즉시 중단

## 금지사항

- `decideAuthRoute` 없이 `signInWithOAuth()`/`signInGoogle()`을 호출하지 마라. 이유: 익명 세션에 결과가 있으면 uid가 버려져 사용자가 분석을 잃는다.
- `linkIdentity` 실패 시 로그아웃시키지 마라. 이유: 사용자가 방금 올린 분석 결과까지 함께 사라진다.
- 기존 Google 계정과의 병합을 구현하지 마라. 이유: MVP 범위 밖이며, 잘못 구현하면 남의 데이터가 섞인다.
- `next`에 외부 URL을 허용하지 마라. 이유: 오픈 리다이렉트 취약점이 된다.
- `auth.users`를 삭제하지 마라. 이유: admin API가 필요한데 service role 사용을 웹훅 한 곳으로 제한했다.
- `DELETE /api/account`에서 `profiles.tier`·구독 필드를 지우거나 `sample_used`를 되돌리지 마라. 이유: 결제한 사용자가 free가 되고, 익명 표본 분류를 무한히 쓰는 통로가 된다.
- `usage_counters`를 지우지 마라. 이유: 무료 사용자가 삭제→재업로드를 반복해 월 1회 제한을 무한히 우회한다.
- UI 문구나 주석에 "계정 삭제"라고 쓰지 마라. 이유: 계정은 남으며, 사용자가 사라졌다고 믿으면 신뢰 문제가 된다.
- 수정된 건에 `confidence`를 남기지 마라. 이유: 사용자가 확정한 건이 계속 "확인 필요"로 다시 올라온다.
- `saveAsRule`이 false인데 규칙을 만들지 마라. 규칙을 INSERT로 쌓지 마라(upsert를 쓴다). 이유: 임의 규칙은 다음 달 전건을 잘못 분류하고, 규칙이 여러 개면 `applyRules` 결과가 예측 불가능해진다.
- 다른 분석의 거래를 수정할 수 있게 두지 마라. 이유: `analysisId`만 검사하고 `edits[].id`를 검사하지 않으면 남의 데이터로 가는 통로가 열린다.
- `PATCH transactions`에서 AI를 호출하지 마라. 이유: 재분류는 비용과 덮어쓰기 문제를 만든다.
- 쿼터 검사 전에 Anthropic을 호출하지 마라. 호출 실패 시 쿼터를 차감하지 마라.
- 프리픽스를 새로 구성하지 마라. `buildPromptBlocks`를 재사용한다. 거래 조회에 `order by`를 빼지 마라. 이유: 캐시 미스로 입력비가 약 10배가 된다.
- `tier_required`와 `quota_exceeded`를 하나로 합치지 마라. 이유: "결제하세요"와 "다음 달에 오세요"는 완전히 다른 안내다.
- 대화 이력을 DB에 저장하지 마라. 이유: MVP 범위 밖이며, 테이블·RLS·삭제 정책이 함께 따라온다.
- 랜딩 렌더 시점에 `ensureSession()`을 호출하지 마라. 이유: 구경꾼·크롤러까지 `auth.users` 행을 만든다. 드롭 시점에만.
- 원본 파일을 서버로 보내지 마라. `FormData`를 쓰지 마라. 이유: 카드번호와 원본이 서버에 도달한다.
- 분류되지 않은 거래를 블러로 가리지 마라. Pro 기능을 CSS로 숨기지 마라. 이유: 개발자도구로 걷힌다. 서버에서 판정해 렌더하지 않는다.
- 요금제 숫자를 하드코딩하거나 쿼터 잔여를 클라이언트에서 계산하지 마라. 이유: 서버 판정이 유일한 진실이며, 어긋나면 결제한 사용자가 막힌다.
- 목록·상세 조회용 API 라우트를 만들지 마라. 이유: Server Component에서 직접 조회한다. 라우트는 변경·외부호출 전용이다.
- 버킷 분류 로직을 컴포넌트에서 다시 구현하지 마라. `review`·`unclassified` 금액을 경비 합계에 더하지 마라.
- 세무 판단 문구("경비 처리 가능합니다", "한도 초과" 등)를 UI나 프롬프트에 쓰지 마라. 이유: 제품 경계이며 법적 위험이다.
- 남의 분석에 403을 반환하지 마라. 404를 쓴다. service role 클라이언트를 쓰지 마라.
- 색을 분류 상태 외의 곳에 쓰지 마라. hex 색상값을 하드코딩하지 마라. 다크모드 분기를 만들지 마라.
- 차트를 화면 주인공으로 두지 마라. 이유: 표 중심 고밀도 레이아웃이 이 제품의 디자인 결정이다.
- 실제 OAuth·Supabase·Anthropic을 호출하는 테스트를 쓰지 마라. 이유: blocked가 되어 이후 step이 전부 멈춘다.
- 결제를 구현하지 마라. 이유: step7의 범위다.
- 기존 테스트를 깨뜨리지 마라.
