# 아키텍처

## 기술 스택
- Next.js 16 (App Router) / React 19
- TypeScript strict mode
- Tailwind CSS v4 (CSS-first `@theme`)
- Supabase (Auth + Postgres + RLS), `@supabase/ssr`
- Polar (구독 결제, Merchant of Record)
- Anthropic Claude API — `claude-sonnet-5`
- ExcelJS (엑셀 파싱), Recharts (차트), Vitest (테스트, node 환경 단일)

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
│   ├── ingest/        인코딩 감지, csv·ExcelJS → 행 배열
│   ├── mapping/       헤더 휴리스틱, 값 정규화, 매핑 검증
│   ├── analysis/      카테고리 분류, 월별 집계, fingerprint, 잠금 판정
│   ├── supabase/      browser · server · admin(웹훅 전용) + auth 유틸
│   └── env.ts         호출 시점 환경변수 접근자
└── services/          claude · polar
```

## 패턴
- **Server Components 기본.** 드롭존, 컬럼 매핑 UI, 차트 등 인터랙션이 필요한 곳만 `'use client'`
- **순수 함수 우선.** `lib/{ingest,mapping,analysis}`는 I/O 없는 순수 함수다. 같은 코드가 브라우저·서버 양쪽에서 돌고, 픽스처만으로 테스트가 완결된다
- **서비스 래퍼.** 외부 API 호출은 `services/` 안에서만. 라우트 핸들러는 래퍼를 호출할 뿐 SDK를 직접 다루지 않는다
- **읽기는 라우트를 만들지 않는다.** 목록·상세는 Server Component에서 직접 조회한다
- ExcelJS는 **동적 import**한다. 정적 포함 시 랜딩 초기 번들에 들어가 LCP를 해친다

## 데이터 흐름

### 분석 파이프라인 — 2단계로 나뉜다
```
[1단계] 집계 — 익명 가능, LLM 호출 없음
  파일 드롭 (브라우저)
    → signInAnonymously()          ← 이 시점에 세션 생성
    → lib/ingest    인코딩 감지 · 안내문/합계 행 제거
    → lib/mapping   헤더 추측 → 사용자 확인
    → 정규화 거래 배열만 JSON 전송   ← 원본 파일은 서버로 가지 않는다
    → POST /api/analyze
       서버: 스키마·상한 검증 → lib/analysis 재집계 → 저장
    → 프리뷰 렌더 (총액·카테고리·상위 가맹점)

[2단계] 인사이트 — 계정 연결 후
  linkIdentity('google')  또는  signInWithOAuth('google')
    → POST /api/analyses/:id/insight
       서버: 집계 요약본만 Claude에 전달 → 해석·제안 수신 → 저장
    → 대시보드 렌더
```

**이 분리가 핵심이다.** 익명 단계에서 LLM을 부르지 않으므로 비용 남용 표면이 없고, 집계를 먼저 렌더하므로 LLM 지연이 첫 화면을 막지 않으며, LLM이 실패해도 집계는 살아남는다.

**금액은 항상 코드가 계산한다.** LLM에는 집계 요약(카테고리별 합계, 상위 가맹점, 전월 대비 증감)만 전달하고 해석만 맡긴다. 산술 오류가 구조적으로 불가능하고, 토큰 비용이 거래 건수와 무관하게 일정하다.

**원본 파일을 서버로 보내지 않는 이유**: 요청 본문 크기 제한을 건드리지 않고, 카드번호·원본 파일이 서버에 도달하지 않는다. 서버는 배열을 검증한 뒤 직접 재집계하므로 클라이언트 계산을 신뢰하지 않는다.

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
profiles      (id → auth.users, plan, polar_customer_id,
               polar_subscription_id, current_period_end)
analyses      (id, owner_id, card_label, fingerprint,
               source_kind, row_count, created_at)
transactions  (id, analysis_id, owner_id, occurred_on,
               merchant, amount_krw, category)
insights      (id, analysis_id, owner_id, kind, status, content)
```

- `effective_plan = plan='pro' AND current_period_end > now()` — **서버 함수 하나로만 계산한다.** 여러 곳에 복제 금지
- `profiles` 행은 `auth.users` INSERT 트리거로 자동 생성한다(`plan='free'`). 없으면 게이팅 판정이 null로 무너진다
- `UNIQUE (owner_id, fingerprint)` — 중복 업로드 감지. `fingerprint = sha256(정렬된 "occurred_on|merchant|amount_krw" 전체 행)`
- **월별 집계는 테이블이 아니라 쿼리다.** `occurred_on`으로 `GROUP BY`
- 잠금 판정: `해당 월 < 최신 월 - 1개월 AND effective_plan='free'` → `locked`
- 카드번호는 어떤 컬럼에도 저장하지 않는다

### RLS
4개 테이블 전부 `owner_id = auth.uid()`. 익명 사용자도 진짜 uid가 있으므로 예외 경로가 없다.
**SELECT 정책만으로는 부족하다.** INSERT·UPDATE에 `WITH CHECK (owner_id = auth.uid())`를 반드시 건다. `owner_id`는 서버가 `auth.uid()`에서 채운다.

**service role은 Polar 웹훅의 plan 갱신 한 곳에서만** 쓴다. `DELETE /api/account`는 앱 데이터 삭제 + 로그아웃만 수행하고 `auth.users`는 건드리지 않는다.

## API 계약

| 메서드 · 경로 | 요청 | 응답 |
|---|---|---|
| `POST /api/analyze` | `{ rows, cardLabel?, sourceKind }` | `{ ok:true, analysisId, periods }` \| `{ ok:false, reason:'duplicate', existingId, period, locked }` |
| `POST /api/analyses/:id/insight` | — | `{ status, kind, content? }` |
| `DELETE /api/analyses/:id` | — | `{ ok }` |
| `POST /api/billing/checkout` | `{ plan:'pro' }` | `{ url }` |
| `POST /api/billing/sync` | — | `{ plan, currentPeriodEnd }` |
| `POST /api/webhooks/polar` | Polar 이벤트 (서명 검증) | `200` |
| `DELETE /api/account` | — | `{ ok }` |

`billing/sync`가 POST인 이유: Polar를 조회해 `profiles.plan`을 갱신하는 부수효과가 있다. GET이면 프리페치·프리렌더가 호출해 예기치 않게 실행된다. 체크아웃 리다이렉트 직후 호출해 **웹훅 도착을 기다리지 않고** Pro를 반영한다.

### 잠금 응답
```ts
type LockedPeriod = { locked: true; period: string; teaser: string }
// ▸ 금액·인사이트 본문을 절대 포함하지 않는다
```
블러는 CSS가 아니라 **서버가 값을 보내지 않는 것**으로 구현한다. CSS 블러는 개발자도구로 걷힌다.

### 인사이트 kind
클라이언트가 고르지 않는다. 서버가 `effective_plan`으로 정한다(`free`→`basic`, `pro`→`deep`). 이미 같은 kind가 `ready`면 재생성하지 않고, `failed`면 재시도한다.

## 상태 관리
- 서버 상태는 Server Components + `revalidatePath`
- 클라이언트 상태(업로드 진행, 컬럼 매핑 편집)는 `useState`/`useReducer`
- 전역 상태 라이브러리를 도입하지 않는다
