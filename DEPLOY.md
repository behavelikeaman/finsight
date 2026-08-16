# 배포 인수인계

이 문서의 항목은 전부 **사람이 직접 해야 하는 것**이다. 프로젝트 생성, 대시보드 토글,
OAuth 클라이언트 등록, 상품 생성, 실제 키 발급은 에이전트가 대신할 수 없다.
위에서부터 순서대로 따라가라. 각 항목에 **왜 필요한지**를 붙여 두었다 —
건너뛰면 무엇이 깨지는지 알고 건너뛰라는 뜻이다.

코드는 준비가 끝난 상태다. 환경변수가 하나도 없어도 `npm run build`는 통과한다
(`src/lib/env.ts`가 호출 시점에만 읽는다). 즉 **빌드가 되었다는 사실은 설정이
끝났다는 뜻이 아니다.** 7번 스모크 테스트를 통과해야 끝이다.

---

## 1. Supabase 프로젝트 생성

[supabase.com](https://supabase.com)에서 프로젝트를 만든다. 리전은 서비스 대상이
한국이므로 `Northeast Asia (Seoul)` 권장.

생성 후 **Project Settings > API**에서 세 값을 받아 적는다.

| 값 | 환경변수 | 비고 |
|---|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` | 클라이언트에 노출됨 (정상) |
| anon / public key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 클라이언트에 노출됨 (정상). RLS가 방어선이다 |
| service_role key | `SUPABASE_SERVICE_ROLE_KEY` | **서버 전용. RLS를 우회한다.** 절대 `NEXT_PUBLIC_`을 붙이지 마라 |

> 왜 필요한가: 인증·DB·행 수준 보안(RLS)이 전부 Supabase 위에 있다.
> service_role 키는 Polar 구독 상태 갱신(`/api/webhooks/polar`, `/api/billing/sync`)
> 두 곳에서만 쓰인다. 다른 곳에서 쓰면 사용자 데이터 격리가 통째로 무너진다.

---

## 2. 마이그레이션 적용

`supabase/migrations/` 의 `.sql` 파일을 **파일명 순서대로** 적용한다.
현재는 `0001_initial.sql` 하나다.

Supabase 대시보드의 **SQL Editor**에 파일 내용을 붙여넣고 실행하거나,
CLI를 쓴다면 `supabase db push`.

> 왜 필요한가: 테이블 5개, `auth.users` INSERT 트리거(`profiles` 자동 생성),
> security definer 함수 3개(`effective_tier`·`increment_usage`·`mark_sample_used`),
> RLS 정책이 전부 이 파일에 있다. 트리거가 없으면 `profiles` 행이 만들어지지 않아
> 쿼터 판정이 null로 무너진다.

### 적용 후 반드시 확인할 것

**Table Editor > `usage_counters` > (우측) RLS Policies** 를 열어
정책이 **SELECT 하나뿐**인지 확인한다.

- INSERT / UPDATE / DELETE 정책이 보이면 **쿼터가 우회 가능한 상태다.**
  `update usage_counters set classify_used = 0` 한 줄로 AI 호출 제한이 사라진다.
  이 프로젝트에서 가장 직접적인 비용 유출 경로다.
- 쓰기는 전부 `increment_usage()` security definer 함수를 통해서만 일어난다.

`profiles`도 함께 확인한다. `tier`·`current_period_end`·`sample_used`·`polar_*`
컬럼에 `revoke update ... from authenticated`가 걸려 있어야 한다.
안 걸려 있으면 사용자가 자기 행을 UPDATE해 결제 없이 Pro가 된다.

---

## 3. Supabase 대시보드 토글 3개

**Authentication > Sign In / Up** 에서 아래 셋을 켠다.
**셋 중 하나라도 빠지면 플로우가 통째로 죽는다.**

| 설정 | 왜 필요한가 |
|---|---|
| **Anonymous Sign-Ins** 활성화 | 파일 드롭 시점에 `signInAnonymously()`로 진짜 `auth.uid()`를 만든다. 없으면 로그인 전 업로드가 아예 시작되지 않는다 |
| **Manual Linking** 활성화 | `linkIdentity('google')`로 **uid를 유지한 채** 계정을 연결한다. 없으면 계정 연결 시 새 uid가 생겨 사용자가 방금 만든 분석을 잃는다 |
| **Google** OAuth 클라이언트 등록 | 유일한 로그인 수단이다 (카카오는 MVP 제외) |

### Google OAuth 설정

1. [Google Cloud Console](https://console.cloud.google.com/apis/credentials)에서 OAuth 2.0 클라이언트 ID를 만든다 (유형: 웹 애플리케이션).
2. **승인된 리디렉션 URI**에 Supabase가 알려주는 콜백 URL을 넣는다
   (`https://<프로젝트>.supabase.co/auth/v1/callback`).
3. 발급된 Client ID / Client Secret을 Supabase의 Google 프로바이더 설정에 넣는다.
4. Supabase **Authentication > URL Configuration > Redirect URLs** 에
   `<사이트>/auth/callback` 을 추가한다.
   → 앱의 콜백 라우트(`src/app/auth/callback/route.ts`)가 code를 세션으로 교환하는 지점이다.
   등록하지 않으면 로그인 후 돌아오지 못한다.

---

## 4. Anthropic API 키

[console.anthropic.com](https://console.anthropic.com)에서 키를 발급받아
`ANTHROPIC_API_KEY`에 넣는다. 모델은 `claude-opus-5`를 쓴다.

> 왜 필요한가: 거래 분류와 Q&A가 전부 이 키로 나간다. **서버 전용이다** —
> `NEXT_PUBLIC_`을 붙이면 키가 브라우저 번들에 박힌다.
>
> 비용 주의: 300건 분류 1회가 약 440원이다. 콘솔에서 **사용량 알림과 월 한도**를
> 반드시 걸어 두라. 앱 쪽 방어선(`src/lib/quota.ts`, 익명 표본 20건 제한,
> 프롬프트 캐시 프리픽스)은 이미 걸려 있지만 계정 단의 상한은 따로다.

---

## 5. Polar (구독 결제)

### 사전 확인 — 이미 검증한 항목

- **한국 정산: 지원된다.** Polar의 [supported countries](https://polar.sh/docs/merchant-of-record/supported-countries) 목록에 South Korea가 포함되어 있다 (Stripe Connect Express 기반 payout).
- **결제 수단: 카드만 지원된다.** Polar는 [Stripe를 통한 카드 결제만](https://polar.sh/legal/payment-processor-partners) 처리한다. 국내 발급 카드라도 **국제 브랜드(Visa/Mastercard/Amex/JCB)면 통과하고, "국내전용" 카드는 결제되지 않는다.** 카카오페이·네이버페이·계좌이체 같은 국내 결제수단도 없다.
  → 이 제약을 받아들일 수 없다면 ADR-005를 뒤집고 토스페이먼츠로 가야 한다. 그건 코드 변경이 아니라 **사업 판단**이다.

### 절차

1. [polar.sh](https://polar.sh)에서 조직을 만들고 payout 계정(Stripe Connect)을 연결한다.
2. **Products**에서 Pro 상품을 만든다 (월 구독).
   → 상품 ID를 `POLAR_PRO_PRODUCT_ID`에 넣는다.
3. **Settings > Developers**에서 액세스 토큰을 발급한다.
   → `POLAR_ACCESS_TOKEN`. 서버 전용이다.
4. **Settings > Webhooks**에서 엔드포인트를 등록한다.
   - URL: `<사이트>/api/webhooks/polar`
   - 포맷: **Raw** (Polar 기본. Discord/Slack 포맷을 고르지 마라)
   - 구독할 이벤트: `subscription.created` · `subscription.active` · `subscription.updated` · `subscription.canceled` · `subscription.uncanceled` · `subscription.revoked`
   - 발급된 시크릿을 `POLAR_WEBHOOK_SECRET`에 넣는다.
     → **서명 검증에 쓴다. 없으면 위조 요청을 걸러낼 수 없고, 누구나 자신을 Pro로 만들 수 있다.**
5. `POLAR_SERVER`는 **먼저 `sandbox`로 두고** 샌드박스 결제를 끝까지 통과시킨 뒤
   `production`으로 바꾼다. 샌드박스와 운영은 토큰·상품 ID·웹훅 시크릿이 전부 다르므로
   전환할 때 5개 값을 함께 바꿔야 한다.
   → 코드는 `production`이라고 정확히 적혀 있을 때만 운영으로 붙고, 그 외의 값은 sandbox로 닫는다.

> 해지·만료 처리: 취소 이벤트가 와도 즉시 free로 내려가지 않는다. `current_period_end`
> 까지 Pro를 유지하고, 만료 판정은 `effective_tier` DB 함수가 한다. 웹훅 처리는 멱등이므로
> 같은 이벤트를 여러 번 받아도 결과가 같다.
>
> 결제 실패(`past_due`) 처리: 재청구를 시도하는 중이므로 **권리를 즉시 거두지
> 않는다.** `/dashboard`에 "결제 수단 확인이 필요합니다" 배너를 띄워 포털로
> 보내고, 갱신이 끝내 실패하면 `current_period_end` 만료와 함께
> `effective_tier`가 free로 닫는다. 유예 일수를 따로 세지 않는다.
>
> 사용자의 해지·카드 교체·영수증 열람은 `/dashboard`의 **구독 관리** 버튼이
> Polar 고객 포털(`/api/billing/portal`)로 보내 처리한다. 별도 설정은 없고
> `POLAR_ACCESS_TOKEN`만 있으면 동작한다. 결제한 적 없는 사용자에게는 서버가
> 버튼 자체를 내보내지 않는다(`profiles.polar_customer_id` 기준).

---

## 6. 호스팅 환경변수 등록

`.env.example`의 **모든 키**를 호스팅(Vercel 권장 — `@vercel/analytics`가 이미 붙어 있다)의
환경변수로 등록한다.

| 환경변수 | 노출 범위 | 출처 |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | 클라이언트 | 1번 |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 클라이언트 | 1번 |
| `SUPABASE_SERVICE_ROLE_KEY` | **서버 전용** | 1번 |
| `ANTHROPIC_API_KEY` | **서버 전용** | 4번 |
| `POLAR_ACCESS_TOKEN` | **서버 전용** | 5번 |
| `POLAR_WEBHOOK_SECRET` | **서버 전용** | 5번 |
| `POLAR_PRO_PRODUCT_ID` | **서버 전용** | 5번 |
| `POLAR_SERVER` | **서버 전용** | `sandbox` 또는 `production` |
| `NEXT_PUBLIC_SITE_URL` | 클라이언트 | 배포 도메인. 예: `https://finsight.app` (끝에 `/` 없이) |

규칙:

- **`NEXT_PUBLIC_` 접두사가 붙은 것만 클라이언트에 노출된다.** 나머지에 실수로 접두사를 붙이면 브라우저 번들에 키가 박힌다. 되돌리려면 키를 폐기하고 재발급해야 한다.
- `NEXT_PUBLIC_SITE_URL`은 Google OAuth 복귀(`/auth/callback`)와 Polar 체크아웃 복귀(`/dashboard?checkout_id=...`)의 기준이다. 틀리면 로그인과 결제가 모두 엉뚱한 곳으로 돌아온다.
- 호스팅 설정 파일(`vercel.json` 등)은 필요 없다. Node 런타임을 강제해야 하는 라우트가 없다 — ExcelJS는 브라우저에서만 동적 import되며 서버로 들어가지 않는다.
- 도메인이 정해진 뒤 **3번의 Redirect URL과 5번의 웹훅 URL을 실제 도메인으로 다시 맞췄는지** 확인하라. 이 둘은 배포 전에 임시값으로 넣어두기 쉬운 자리다.

---

## 7. 배포 후 스모크 테스트

배포 직후 **사람이 직접** 확인한다. 위에서부터 순서대로 하나의 흐름이다.

```
[ ] 랜딩 접속 — auth.users 에 행이 생기지 않는다
    (방문만으로 계정이 생기면 구경꾼·크롤러까지 계정을 만든다)
[ ] CSV 드롭 → 이 시점에 익명 세션이 생긴다
    (Supabase > Authentication > Users 에서 anonymous 사용자 1명 확인)
[ ] 컬럼 매핑이 자동으로 채워진다
[ ] 집계 프리뷰의 총액이 명세서 합계와 일치한다   ← 합계 행 제거가 됐는지 확인
[ ] 표본 20건 분류 결과가 보인다
[ ] 두 번째 파일 드롭 → 표본이 다시 실행되지 않는다 (sample_used)
[ ] Google 연결 → 분석 결과가 그대로 남아 있다   ← uid 유지 확인. 가장 중요
[ ] 전체 분류 실행 → 확인 필요 섹션이 상단에 뜬다
[ ] 분류 수정 + 규칙 저장 → 다음 분석에서 해당 가맹점이 AI 없이 분류된다
[ ] free 티어에서 Q&A 패널이 렌더되지 않는다 (CSS로 숨겨진 게 아니라)
[ ] Pro 결제 → 리다이렉트 직후 바로 Pro가 반영된다 (billing/sync)
[ ] 다른 계정으로 로그인 → 남의 분석이 보이지 않는다   ← RLS 확인
[ ] "내 데이터 전체 삭제" → 데이터가 지워지고 로그아웃된다
```

### 확인 방법 보충

- **"Google 연결 → 결과 유지"**: 연결 전 URL의 분석 ID를 적어 두고, 연결 후 같은 ID의
  페이지가 그대로 열리는지 본다. 결과가 사라졌다면 3번의 **Manual Linking이 꺼져 있다.**
  이 경우 `signInWithOAuth()`로 빠져 새 uid가 만들어졌고, 익명 uid에 붙어 있던 분석은
  주인을 잃은 것이다.
- **"free 티어에서 Q&A 패널이 렌더되지 않는다"**: 개발자도구로 DOM을 검사해
  질문 입력창이나 답변 텍스트가 **아예 존재하지 않는지** 확인한다.
  블러 처리나 `display:none`으로 가려져 있으면 안 된다 — 개발자도구로 걷힌다.
- **"남의 분석이 보이지 않는다"**: 계정 A로 분석을 만든 뒤 그 URL을 복사하고,
  계정 B로 로그인해 같은 URL에 접속한다. **404가 떠야 한다.**
- **"결제 직후 Pro 반영"**: 첫 결제는 웹훅이 아니라 `billing/sync`가 처리한다.
  복귀 URL의 `checkout_id`로 체크아웃을 직접 조회하므로 웹훅이 늦어도 반영된다.
  반영이 안 되면 **서버 로그를 먼저 본다** — 실패 경로마다 원인을 남긴다.
- **웹훅 응답 코드 읽는 법** (Polar 대시보드의 전송 로그):

  | 코드 | 뜻 |
  |---|---|
  | `401` | 서명 불일치. **`POLAR_WEBHOOK_SECRET`이 틀렸다** |
  | `400` | 서명은 맞고 페이로드를 해석하지 못했다. 시크릿 문제가 아니다 — 포맷이 `Raw`가 아니거나 Polar가 스키마를 바꾼 것이다 |
  | `500` | `POLAR_WEBHOOK_SECRET`이 아예 비어 있다 |
  | `200`인데 티어 그대로 | `profiles.polar_customer_id`가 채워졌는지 확인한다 |
- **표본 재실행 여부**: `profiles.sample_used`가 `true`인지 SQL Editor에서 직접 본다.

---

## 남은 것 (이번 phase 밖)

- 버려진 익명 계정 정리 (`auth.users`에 쌓인다)
- 계정 자체 삭제 (현재는 앱 데이터 삭제 + 로그아웃까지. 그래서 UI에 "계정 삭제"라고 쓰지 않는다)
- 이메일 리마인더·리포트 발송 — 신고철 재방문이 핵심이라 다음 phase 1순위
