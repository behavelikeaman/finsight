# 아키텍처

## 기술 스택
- Next.js 16 (App Router) / React 19
- TypeScript strict mode + `noUncheckedIndexedAccess`
- Tailwind CSS v4 (CSS-first `@theme`)
- Supabase (Auth + Postgres + RLS), `@supabase/ssr`
- Polar (구독 결제, Merchant of Record)
- Anthropic Claude API — `claude-opus-5`
- ExcelJS (엑셀 파싱), Recharts (차트, 보조), Vitest (테스트, node 환경 단일)

## 디렉토리 구조
```
src/
├── app/
│   ├── (marketing)/   랜딩 · 요금제 — 비로그인 접근
│   ├── (app)/         대시보드 — 로그인 필수
│   └── api/           라우트 핸들러 (변경·외부호출 전용)
├── components/        UI 컴포넌트
├── types/             도메인 타입 + API 계약
├── lib/
│   ├── ingest/        인코딩 감지, csv·ExcelJS → RawTable
│   ├── mapping/       헤더 휴리스틱, 값 정규화, 매핑 검증
│   ├── analysis/      집계, fingerprint, 중복판정, 확신도 버킷
│   ├── rules.ts       user_rules 선적용 (AI 호출 전 관문)
│   ├── quota.ts       티어별 사용량 검사 (AI 호출 전 관문)
│   ├── redact.ts      외부 전송 전 민감정보 제거 (단일 관문)
│   ├── supabase/      browser · server · admin(웹훅 전용) + auth · session
│   └── env.ts         호출 시점 환경변수 접근자
└── services/          anthropic · polar
```

## 패턴
- **Server Components 기본.** 드롭존, 컬럼 매핑 UI, 분류 수정 표, 채팅 등 인터랙션이 필요한 곳만 `'use client'`
- **순수 함수 우선.** `lib/{ingest,mapping,analysis}`와 `rules.ts`·`redact.ts`는 I/O 없는 순수 함수다. 같은 코드가 브라우저·서버 양쪽에서 돌고, 픽스처만으로 테스트가 완결된다
- **서비스 래퍼.** 외부 API 호출은 `services/` 안에서만. 라우트 핸들러는 래퍼를 호출할 뿐 SDK를 직접 다루지 않는다
- **읽기는 라우트를 만들지 않는다.** 목록·상세는 Server Component에서 직접 조회한다
- ExcelJS는 **동적 import**한다. 정적 포함 시 랜딩 초기 번들에 들어가 LCP를 해친다

## 데이터 흐름

### 분석 파이프라인 — 3단계로 나뉜다
```
[1단계] 집계 — 익명 가능, LLM 호출 없음
  파일 드롭 (브라우저)
    → signInAnonymously()          ← 이 시점에 세션 생성
    → lib/ingest    인코딩 감지(UTF-8 실패 시 CP949 폴백) · 안내문/합계 행 제거
    → lib/mapping   헤더 추측 → 사용자 확인
    → 정규화 거래 배열만 JSON 전송   ← 원본 파일은 서버로 가지 않는다
    → POST /api/analyze
       서버: 스키마·상한 검증 → 중복 판정 → lib/analysis 집계 → 저장
    → 프리뷰 렌더 (총액·월별·상위 가맹점)

[2단계] 분류 — LLM 호출. 익명은 표본 20건, 전건은 계정 연결 후
    → POST /api/analyses/:id/classify   { mode: 'sample' | 'full' }
       서버: 쿼터 검사(lib/quota)
           → user_rules 선적용(lib/rules) — 매칭 건은 AI에 보내지 않는다
           → 나머지만 redact() 통과 후 Anthropic 호출
             (거래내역은 프롬프트 캐시 프리픽스에 배치)
           → 거래별 { classification, accountCode, confidence } 저장
    → 수정 가능한 표 렌더. 확신도 낮은 건은 "확인 필요"로 상단에

[3단계] Q&A — 유료
    → POST /api/analyses/:id/chat
       서버: 쿼터 검사 → 2단계와 같은 캐시 프리픽스 재사용 + 질의만 추가
```

**단계 분리가 핵심이다.** 집계에 LLM이 없으므로 익명 비용 남용 표면이 사라지고, 집계를 먼저 렌더하므로 LLM 지연이 첫 화면을 막지 않으며, LLM이 실패해도 집계는 살아남는다.

**금액은 항상 코드가 계산한다.** LLM은 거래별 분류 판단만 한다. 합계·평균을 LLM에게 시키지 않으므로 산술 오류가 구조적으로 불가능하다.

**원본 파일을 서버로 보내지 않는 이유**: 요청 본문 크기 제한을 건드리지 않고, 카드번호·원본 파일이 서버에 도달하지 않으며, 보관·삭제 정책이 아예 필요 없어진다. 서버는 배열을 검증한 뒤 직접 재집계하므로 클라이언트 계산을 신뢰하지 않는다.

### 인증 — 두 개의 진입 경로
```
현재 세션이 익명이고, 귀속되지 않은 분석 결과가 있는가?
   │
   ├─ 예  → linkIdentity('google')      uid 유지 → 결과가 그대로 내 것
   │        ▸ Supabase 대시보드에서 Manual Linking 활성화 필요
   │
   └─ 아니오 → signInWithOAuth('google')  기존 계정으로 진입 (재방문 경로)
```

이 판정은 `lib/supabase/auth.ts` 한 곳에서만 한다. 결과가 있는데 `signInWithOAuth()`를 부르면 새 계정이 만들어져 **uid가 버려지고 사용자가 분석을 잃는다.**

익명 세션은 랜딩 방문이 아니라 **파일 드롭 시점**에 만든다. 방문만으로 만들면 구경꾼·크롤러까지 `auth.users`를 오염시킨다.

## 데이터 모델

```
profiles       (id → auth.users, tier, sample_used, polar_customer_id,
                polar_subscription_id, current_period_end)
analyses       (id, owner_id, card_label, fingerprint, source_kind,
                row_count, classified_at, created_at)
transactions   (id, analysis_id, owner_id, occurred_on, merchant, amount_krw,
                classification, account_code, confidence, is_user_edited,
                rule_id)
user_rules     (id, owner_id, merchant_pattern, classification, account_code,
                created_at)
usage_counters (owner_id, period, classify_used, chat_used)
```

- `effective_tier = tier='pro' AND current_period_end > now()` — **서버 함수 하나로만 계산한다.** 여러 곳에 복제 금지
- `profiles` 행은 `auth.users` INSERT 트리거로 자동 생성한다(`tier='free'`). 없으면 쿼터 판정이 null로 무너진다
- `profiles.sample_used` — 익명 표본 분류를 uid당 1회로 제한하는 플래그
- `UNIQUE (owner_id, fingerprint)` — 중복 업로드 감지. `fingerprint = sha256(정렬된 "occurred_on|merchant|amount_krw" 전체 행)`
- `UNIQUE (owner_id, merchant_pattern)` — 같은 가맹점에 규칙이 둘 생기지 않게 한다. 재수정은 upsert
- `transactions.classification` — `'business' | 'personal' | 'review' | null`. `null`은 아직 분류 전
- `transactions.rule_id` — 규칙으로 분류된 건. AI가 아니라 규칙이 결정했음을 추적한다
- 월별 집계는 테이블이 아니라 쿼리다. `occurred_on`으로 `GROUP BY`
- 카드번호는 어떤 컬럼에도 저장하지 않는다

### RLS
5개 테이블 전부 `owner_id = auth.uid()`. 익명 사용자도 진짜 uid가 있으므로 예외 경로가 없다.
**SELECT 정책만으로는 부족하다.** INSERT·UPDATE에 `WITH CHECK (owner_id = auth.uid())`를 반드시 건다. `owner_id`는 서버가 `auth.uid()`에서 채운다.

**단, 테이블마다 사용자에게 주는 권한이 다르다.** 일괄로 걸면 안 된다.

| 테이블 | 사용자 권한 | 쓰기 주체 |
|---|---|---|
| `analyses` · `transactions` · `user_rules` | SELECT·INSERT·UPDATE·DELETE | 사용자 세션 |
| `profiles` | SELECT + 일부 컬럼 UPDATE | 트리거 / 웹훅(service role) / DB 함수 |
| `usage_counters` | **SELECT만** | `increment_usage()` (security definer) |

`usage_counters`에 사용자 쓰기를 열면 `update usage_counters set classify_used = 0`으로 **쿼터 관문 전체가 무력화된다.** 이 프로젝트에서 가장 직접적인 비용 유출 경로다. DELETE도 같은 이유로 막는다 — 행을 지우면 카운터가 0부터 다시 시작한다.

`profiles`의 `tier` · `current_period_end` · `sample_used` · `polar_*`는 `revoke update ... from authenticated`로 막는다. 각각 결제 우회, 표본 무한 사용, 남의 구독 ID 탈취 경로가 된다.

security definer 함수 3개: `effective_tier(uid)` · `increment_usage(kind)` · `mark_sample_used()`.
`increment_usage`는 **`uid`·`period`를 인자로 받지 않는다** — 함수 안에서 `auth.uid()`와 서버 시각을 읽는다. 인자로 받으면 남의 카운터를 소진시킬 수 있다.

**service role은 Polar 웹훅의 tier 갱신과 `billing/sync`에서만** 쓴다. `DELETE /api/account`는 `analyses`·`user_rules`만 지우고 `usage_counters`·`profiles`·`auth.users`는 건드리지 않는다.

## API 계약

| 메서드 · 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/analyze` | `{ rows, cardLabel?, sourceKind }` | `{ ok:true, analysisId, summary }` \| `{ ok:false, reason:'duplicate', existingId }` |
| `POST /api/analyses/:id/classify` | `{ mode:'sample'\|'full' }` | `{ ok:true, classified, fromRules, fromAi, quotaLeft }` \| `{ ok:false, reason:'quota_exceeded'\|'sample_used' }` |
| `PATCH /api/analyses/:id/transactions` | `{ edits:[{id, classification, accountCode}], saveAsRule }` | `{ ok:true, ruleIds }` |
| `POST /api/analyses/:id/chat` | `{ question }` | `{ ok:true, answer, quotaLeft }` \| `{ ok:false, reason:'quota_exceeded'\|'tier_required' }` |
| `DELETE /api/analyses/:id` | — | `{ ok }` |
| `POST /api/billing/checkout` | `{ plan:'pro' }` | `{ url }` |
| `POST /api/billing/sync` | — | `{ tier, currentPeriodEnd }` |
| `POST /api/webhooks/polar` | Polar 이벤트 (서명 검증) | `200` |
| `DELETE /api/account` | — | `{ ok }` |

`billing/sync`가 POST인 이유: Polar를 조회해 `profiles.tier`를 갱신하는 부수효과가 있다. GET이면 프리페치·프리렌더가 호출해 예기치 않게 실행된다. 체크아웃 리다이렉트 직후 호출해 **웹훅 도착을 기다리지 않고** Pro를 반영한다.

### 게이팅 응답
```ts
type Gated = { ok: false; reason: 'quota_exceeded' | 'tier_required' | 'sample_used' }
// ▸ 분류 결과·답변 본문을 절대 포함하지 않는다
```
가리는 것은 CSS가 아니라 **서버가 값을 보내지 않는 것**으로 구현한다. CSS 블러는 개발자도구로 걷힌다.

### 분류 모드
클라이언트가 `mode`를 보내지만 **서버가 재판정한다.** 익명 세션(`is_anonymous`)이 `mode:'full'`을 요청하면 거부한다. 이유: 익명에 전건을 열면 회당 440원의 남용 표면이 생긴다.

## 상태 관리
- 서버 상태는 Server Components + `revalidatePath`
- 클라이언트 상태(업로드 진행, 컬럼 매핑 편집, 분류 수정 중인 값)는 `useState`/`useReducer`
- 낙관적 업데이트는 분류 수정에만 적용한다
- 전역 상태 라이브러리를 도입하지 않는다
