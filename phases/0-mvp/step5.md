# Step 5: supabase-schema

## 읽어야 할 파일

- `/CLAUDE.md` — 보안 규칙 전체
- `/docs/ARCHITECTURE.md` — 데이터 모델과 RLS 절
- `/docs/ADR.md` — ADR-002, ADR-012, ADR-013
- `/src/types/db.ts` (step1 — 컬럼명·타입을 여기에 맞춘다)
- `/.env.example`

## 작업

`supabase/migrations/`에 스키마 마이그레이션 SQL을 작성한다. **실제 Supabase 프로젝트에 적용하지 않는다.** 로컬 파일만 만든다. 적용은 step13에서 사용자가 한다.

`.sql` 파일은 TDD 가드 면제 대상이다.

### `supabase/migrations/0001_init.sql`

4개 테이블. 컬럼은 `docs/ARCHITECTURE.md`의 데이터 모델과 일치시킨다.

```sql
-- profiles
--   id uuid primary key references auth.users(id) on delete cascade
--   plan text not null default 'free' check (plan in ('free','pro'))
--   polar_customer_id text
--   polar_subscription_id text
--   current_period_end timestamptz
--   created_at timestamptz not null default now()

-- analyses
--   id uuid primary key default gen_random_uuid()
--   owner_id uuid not null references auth.users(id) on delete cascade
--   card_label text
--   fingerprint text not null
--   source_kind text not null check (source_kind in ('csv','xlsx'))
--   row_count int not null
--   created_at timestamptz not null default now()
--   unique (owner_id, fingerprint)

-- transactions
--   id bigserial primary key
--   analysis_id uuid not null references analyses(id) on delete cascade
--   owner_id uuid not null references auth.users(id) on delete cascade
--   occurred_on date not null
--   merchant text not null
--   amount_krw bigint not null
--   category text not null

-- insights
--   id uuid primary key default gen_random_uuid()
--   analysis_id uuid not null references analyses(id) on delete cascade
--   owner_id uuid not null references auth.users(id) on delete cascade
--   kind text not null check (kind in ('basic','deep'))
--   status text not null check (status in ('ready','failed'))
--   content jsonb
--   error_message text
--   created_at timestamptz not null default now()
--   unique (analysis_id, kind)
```

금액은 `bigint`다. `numeric`이나 `float`을 쓰지 마라. 이유: 원 단위 정수만 다루기로 했고, 부동소수점은 합계에 오차를 만든다.

인덱스: `transactions(owner_id, occurred_on)`, `analyses(owner_id, created_at desc)`.

### `supabase/migrations/0002_rls.sql`

4개 테이블 전부 `enable row level security`.

정책은 각 테이블마다 **네 종류를 전부** 만든다:
```sql
-- select : using (owner_id = auth.uid())
-- insert : with check (owner_id = auth.uid())
-- update : using (owner_id = auth.uid()) with check (owner_id = auth.uid())
-- delete : using (owner_id = auth.uid())
```
`profiles`는 `owner_id` 대신 `id = auth.uid()`를 쓴다. `profiles`의 INSERT는 트리거가 하므로 사용자 INSERT 정책은 만들지 않는다.

> **SELECT 정책만 만들지 마라.** 이유: INSERT에 `WITH CHECK`가 없으면 다른 사람의 `owner_id`로 행을 만들 수 있다.

### `supabase/migrations/0003_profile_trigger.sql`

`auth.users`에 행이 생기면 `profiles` 행을 자동 생성하는 트리거.

```sql
-- create function public.handle_new_user() returns trigger
--   language plpgsql security definer set search_path = ''
-- insert into public.profiles (id) values (new.id) on conflict do nothing;
--
-- create trigger on_auth_user_created
--   after insert on auth.users for each row execute function public.handle_new_user();
```

**익명 사용자도 예외 없이 행이 생겨야 한다.** 이유: `profiles` 행이 없으면 플랜 판정이 null로 떨어져 게이팅이 통째로 무너진다.

### `supabase/migrations/0004_effective_plan.sql`

플랜 판정을 **DB 함수 하나로** 고정한다. 여러 곳에 로직을 복제하지 마라.

```sql
-- create function public.effective_plan(uid uuid) returns text
--   language sql stable security definer set search_path = ''
-- select case when p.plan = 'pro' and p.current_period_end > now()
--             then 'pro' else 'free' end
--   from public.profiles p where p.id = uid;
```

### `src/lib/supabase/` 클라이언트 3종

TDD 가드 대상이다. 각각 테스트를 **먼저** 작성하라.

```ts
// src/lib/supabase/browser.ts — createBrowserClient (@supabase/ssr)
export function createClient(): SupabaseClient

// src/lib/supabase/server.ts — createServerClient, Next cookies() 연동
export async function createClient(): Promise<SupabaseClient>

// src/lib/supabase/admin.ts — service role. RLS를 우회한다.
export function createAdminClient(): SupabaseClient
```

`admin.ts` 파일 상단에 주석으로 못박는다:
```
// service role은 RLS를 우회한다. 사용처는 Polar 웹훅의 plan 갱신 한 곳뿐이다.
// 다른 곳에서 import하지 마라.
```

키는 `src/lib/env.ts`를 통해 **호출 시점에** 읽는다. 모듈 최상단에서 읽지 마라.

테스트는 환경변수를 주입한 상태에서 클라이언트가 생성되는지, 키가 없으면 명확히 실패하는지 정도만 확인한다. 실제 Supabase에 접속하지 마라.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/lib/supabase
grep -c "ENABLE ROW LEVEL SECURITY\|enable row level security" supabase/migrations/0002_rls.sql
grep -c "with check\|WITH CHECK" supabase/migrations/0002_rls.sql
```

RLS 활성화가 4건, `with check`가 최소 7건 나와야 한다.

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - 4개 테이블 전부 RLS가 켜졌는가?
   - INSERT/UPDATE에 `with check`가 있는가?
   - `profiles` 자동 생성 트리거가 있는가?
   - `amount_krw`가 `bigint`인가?
   - `admin.ts` 외의 파일에서 service role 키를 읽지 않는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 5를 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 마이그레이션 파일 목록과 클라이언트 3종 경로를 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- `DROP TABLE`을 쓰지 마라. 이유: 위험 명령 훅이 차단하며, 마이그레이션은 전진만 한다.
- 실제 Supabase 프로젝트에 마이그레이션을 적용하지 마라. 이유: 키가 없고, 적용은 step13에서 사용자가 한다. 시도하면 blocked가 되어 이후 step이 전부 멈춘다.
- SELECT 정책만 만들지 마라. 이유: INSERT `WITH CHECK`가 없으면 남의 `owner_id`로 행을 삽입할 수 있다.
- 금액 컬럼을 `numeric`/`float`으로 만들지 마라. 이유: 원 단위 정수만 다루며 부동소수점은 오차를 만든다.
- `admin.ts`를 `services/polar` 웹훅 외의 코드에서 import하지 마라. 이유: RLS가 무력화된다.
- API 라우트를 만들지 마라. 이유: step7 이후의 범위다.
- 기존 테스트를 깨뜨리지 마라.
