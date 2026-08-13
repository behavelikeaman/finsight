# Step 6: supabase-schema

## 읽어야 할 파일

- `/CLAUDE.md` — 보안 규칙 전체
- `/docs/ARCHITECTURE.md` — 데이터 모델과 RLS 절
- `/docs/ADR.md` — ADR-004, ADR-016, ADR-018
- `/src/types/db.ts`, `/src/types/domain.ts`, `/src/types/tier.ts` (step1 — 컬럼명·타입을 여기에 맞춘다)
- `/.env.example`

## 작업

`supabase/migrations/`에 스키마 마이그레이션 SQL을 작성하고, Supabase 클라이언트 래퍼를 만든다.

**실제 Supabase 프로젝트에 적용하지 않는다.** 로컬 파일만 만든다. 적용은 step18에서 사용자가 한다. Supabase CLI를 설치할 필요도 없다.

### 1. `supabase/migrations/0001_initial.sql`

#### 테이블

`docs/ARCHITECTURE.md`의 데이터 모델 절을 그대로 옮긴다.

- `profiles` — `id uuid primary key references auth.users(id) on delete cascade`, `tier text not null default 'free' check (tier in ('free','pro'))`, `sample_used boolean not null default false`, `polar_customer_id text`, `polar_subscription_id text`, `current_period_end timestamptz`
- `analyses` — `owner_id uuid not null references auth.users(id) on delete cascade`, `card_label text`, `fingerprint text not null`, `source_kind text not null check (source_kind in ('csv','xlsx'))`, `row_count int not null`, `classified_at timestamptz`, `created_at timestamptz not null default now()`
- `transactions` — `analysis_id uuid not null references analyses(id) on delete cascade`, `owner_id uuid not null`, `occurred_on date not null`, `merchant text not null`, `amount_krw bigint not null`, `classification text check (classification in ('business','personal','review'))`, `account_code text`, `confidence real`, `is_user_edited boolean not null default false`, `rule_id uuid references user_rules(id) on delete set null`
- `user_rules` — `owner_id uuid not null`, `merchant_pattern text not null`, `classification text not null`, `account_code text`, `created_at timestamptz not null default now()`
- `usage_counters` — `owner_id uuid not null`, `period text not null` (`'YYYY-MM'`), `classify_used int not null default 0`, `chat_used int not null default 0`, primary key `(owner_id, period)`

`transactions.rule_id`가 `user_rules`를 참조하므로 **`user_rules`를 `transactions`보다 먼저 생성한다.**

**`amount_krw`는 `bigint`다.** `numeric`이나 `real`을 쓰지 마라. 이유: 원 단위 정수이며, 부동소수점 타입은 합계에 오차를 만든다.

`account_code`에는 `src/types/domain.ts`의 `AccountCode` 12개 값을 `check` 제약으로 건다. 이유: 타입과 DB가 어긋나면 AI가 지어낸 계정과목이 그대로 저장된다.

#### 제약

- `unique (owner_id, fingerprint)` on `analyses` — 중복 업로드 감지
- `unique (owner_id, merchant_pattern)` on `user_rules` — 같은 가맹점에 규칙이 둘 생기지 않게. 재수정은 upsert
- 조회용 인덱스: `transactions(analysis_id)`, `transactions(owner_id, occurred_on)`, `analyses(owner_id, created_at desc)`

#### `profiles` 자동 생성 트리거

`auth.users`에 INSERT가 일어나면 `profiles` 행을 `tier='free'`로 만드는 트리거를 건다.

이게 없으면 쿼터 판정이 null로 무너진다. 익명 사용자도 `auth.users`에 들어가므로 이 트리거를 타야 한다.

#### `effective_tier` 함수

```sql
create or replace function public.effective_tier(uid uuid) returns text
-- tier='pro' AND current_period_end > now() 이면 'pro', 아니면 'free'
-- security definer, search_path 고정
```

**이 판정은 여기 한 곳에만 존재한다.** 애플리케이션 코드에서 다시 구현하지 마라.

#### RLS

5개 테이블 전부 `enable row level security`.

각 테이블에 SELECT·INSERT·UPDATE·DELETE 정책을 건다:
- `using (owner_id = auth.uid())` — 읽기·수정·삭제
- **`with check (owner_id = auth.uid())`** — INSERT·UPDATE

`profiles`는 `id = auth.uid()`가 기준이다. `profiles`의 **UPDATE 정책에서 `tier`·`current_period_end` 컬럼을 사용자가 바꿀 수 없게** 한다. 이유: 사용자가 자기 행을 UPDATE해 `tier='pro'`로 만들 수 있으면 결제가 무의미해진다. 컬럼 단위 권한(`revoke update (tier, current_period_end) on profiles from authenticated`)으로 막는다.

> SELECT 정책만 걸고 끝내지 마라. `with check`가 없으면 남의 `owner_id`로 INSERT가 통과한다.

### 2. `src/lib/supabase/browser.ts`

`createBrowserClient`(`@supabase/ssr`) 래퍼. `NEXT_PUBLIC_SUPABASE_URL`·`NEXT_PUBLIC_SUPABASE_ANON_KEY`만 쓴다.

### 3. `src/lib/supabase/server.ts`

`createServerClient` 래퍼. Next 16의 `cookies()`를 사용한다. Server Component와 라우트 핸들러 양쪽에서 쓰인다.

### 4. `src/lib/supabase/admin.ts`

service role 클라이언트. **파일 상단에 사용처를 못 박는 주석을 단다.**

```ts
// 이 클라이언트는 RLS를 우회한다.
// 유일한 사용처: src/app/api/webhooks/polar/route.ts 의 tier 갱신 (step17)
// 그 외 어디서도 import 하지 마라.
```

`serverEnv('SUPABASE_SERVICE_ROLE_KEY')`를 **호출 시점에** 읽는다(step0의 `src/lib/env.ts`). 모듈 로드 시점에 읽으면 키 없는 빌드가 깨진다.

### 테스트

래퍼 3개는 팩토리 함수라 얇게 테스트한다 — `@supabase/ssr`을 모킹하고, 올바른 환경변수 키로 호출되는지와 admin이 로드 시점에 `process.env`를 읽지 않는지를 검증한다. **실제 Supabase에 접속하지 마라.**

SQL 자체는 테스트하지 않는다. 대신 검증 절차의 `grep` 체크리스트로 고정한다.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/supabase
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `grep -c "with check" supabase/migrations/0001_initial.sql` 이 테이블 수 이상인가?
   - `grep -n "enable row level security" supabase/migrations/0001_initial.sql` 이 5줄인가?
   - `grep -n "amount_krw" supabase/migrations/0001_initial.sql` 의 타입이 `bigint`인가?
   - `grep -n "numeric\|float\|real" supabase/migrations/0001_initial.sql` — `confidence` 외에 없는가?
   - `effective_tier` 함수가 정의되어 있는가?
   - `profiles`의 `tier` 컬럼에 사용자 UPDATE가 막혀 있는가?
   - `admin.ts`에 사용처 제한 주석이 있는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 6을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 마이그레이션 파일 경로, 테이블 5개 이름, 래퍼 3개 경로를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 실제 Supabase 프로젝트에 마이그레이션을 적용하지 마라. 이유: 키가 없어 blocked가 되고 이후 step이 전부 멈춘다. 적용은 step18에서 사용자가 한다.
- `DROP TABLE`을 쓰지 마라. 이유: 훅이 차단하고, 데이터 손실 경로를 남기지 않는다.
- SELECT 정책만 만들고 끝내지 마라. 이유: `with check`가 없으면 남의 `owner_id`로 INSERT가 통과한다.
- `amount_krw`에 `numeric`·`real`·`double precision`을 쓰지 마라. 이유: 통화 합계에 오차가 생긴다.
- 사용자가 `profiles.tier`를 UPDATE할 수 있게 두지 마라. 이유: 결제 없이 Pro가 된다.
- `admin.ts`를 웹훅 외의 곳에서 쓰지 마라. 이유: RLS가 무력화되어 모든 사용자 데이터가 노출된다.
- 애플리케이션 코드에 티어 판정을 다시 구현하지 마라. 이유: `effective_tier` 함수와 어긋나는 순간 게이팅이 깨진다.
- 카드번호 컬럼을 만들지 마라. 이유: 저장하지 않기로 한 데이터다. 컬럼이 있으면 언젠가 채워진다.
- 기존 테스트를 깨뜨리지 마라.
