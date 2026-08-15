-- FinSight 초기 스키마
--
-- 원칙:
--   1. 사용자 데이터 테이블 5개 전부 RLS. SELECT뿐 아니라 INSERT·UPDATE에도
--      with check (owner_id = auth.uid()) 를 건다.
--   2. 테이블마다 사용자 권한이 다르다. 일괄로 걸지 않는다.
--      - analyses·transactions·user_rules : 사용자 세션이 읽고 쓴다
--      - profiles                         : 트리거가 만들고, 민감 컬럼은 revoke
--      - usage_counters                   : 사용자는 SELECT만. 쓰기는 함수만
--   3. 금액은 bigint(원 단위 정수). 통화에 부동소수점 타입을 쓰지 않는다.
--   4. 카드번호 컬럼은 존재하지 않는다.
--
-- 적용은 마지막 step에서 사용자가 한다.

-- ─────────────────────────────────────────────────────────────
-- profiles
-- auth.users INSERT 트리거로 자동 생성된다. 없으면 쿼터 판정이 null로 무너진다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  tier                  text not null default 'free' check (tier in ('free', 'pro')),
  -- 익명 표본 분류를 uid당 1회로 제한하는 플래그. 되돌리는 경로를 만들지 않는다.
  sample_used           boolean not null default false,
  polar_customer_id     text,
  polar_subscription_id text,
  current_period_end    timestamptz
);

-- ─────────────────────────────────────────────────────────────
-- analyses
-- ─────────────────────────────────────────────────────────────
create table if not exists public.analyses (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  card_label  text,
  -- sha256(정렬된 "occurred_on|merchant|amount_krw" 전체 행)
  fingerprint text not null,
  source_kind text not null check (source_kind in ('csv', 'xlsx')),
  row_count   int not null,
  -- null = 아직 분류 전
  classified_at timestamptz,
  created_at    timestamptz not null default now(),
  -- 중복 업로드 감지
  constraint analyses_owner_fingerprint_key unique (owner_id, fingerprint)
);

create index if not exists analyses_owner_created_idx
  on public.analyses (owner_id, created_at desc);

-- ─────────────────────────────────────────────────────────────
-- user_rules
-- transactions.rule_id 가 참조하므로 transactions 보다 먼저 만든다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.user_rules (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users (id) on delete cascade,
  merchant_pattern text not null,
  classification   text not null check (classification in ('business', 'personal', 'review')),
  account_code     text check (account_code in (
    'entertainment', 'travel', 'supplies', 'communication',
    'advertising', 'fees', 'welfare', 'vehicle',
    'books', 'education', 'rent', 'other'
  )),
  created_at       timestamptz not null default now(),
  -- 같은 가맹점에 규칙이 둘 생기지 않게 한다. 재수정은 upsert
  constraint user_rules_owner_pattern_key unique (owner_id, merchant_pattern)
);

-- ─────────────────────────────────────────────────────────────
-- transactions
-- amount_krw 는 bigint 다. numeric·double precision 을 쓰지 마라 —
-- 합계에 오차가 쌓인다. confidence 만 소수(0~1)이다.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.transactions (
  id             uuid primary key default gen_random_uuid(),
  analysis_id    uuid not null references public.analyses (id) on delete cascade,
  owner_id       uuid not null references auth.users (id) on delete cascade,
  occurred_on    date not null,
  merchant       text not null,
  amount_krw     bigint not null,
  -- null = 아직 분류 전
  classification text check (classification in ('business', 'personal', 'review')),
  -- src/types/domain.ts 의 AccountCode 12종과 일치해야 한다.
  -- 어긋나면 AI가 지어낸 계정과목이 그대로 저장된다.
  account_code   text check (account_code in (
    'entertainment', 'travel', 'supplies', 'communication',
    'advertising', 'fees', 'welfare', 'vehicle',
    'books', 'education', 'rent', 'other'
  )),
  confidence     real check (confidence >= 0 and confidence <= 1),
  is_user_edited boolean not null default false,
  -- 규칙이 결정한 건임을 추적한다
  rule_id        uuid references public.user_rules (id) on delete set null
);

create index if not exists transactions_analysis_idx
  on public.transactions (analysis_id);

create index if not exists transactions_owner_occurred_idx
  on public.transactions (owner_id, occurred_on);

-- ─────────────────────────────────────────────────────────────
-- usage_counters
-- 사용자는 SELECT만 한다. 쓰기 정책을 만들지 않는다 — increment_usage() 전용.
-- ─────────────────────────────────────────────────────────────
create table if not exists public.usage_counters (
  owner_id      uuid not null references auth.users (id) on delete cascade,
  -- 'YYYY-MM'
  period        text not null,
  classify_used int not null default 0,
  chat_used     int not null default 0,
  primary key (owner_id, period)
);

-- ─────────────────────────────────────────────────────────────
-- profiles 자동 생성 트리거
-- 익명 사용자도 auth.users 에 들어가므로 이 트리거를 탄다.
-- ─────────────────────────────────────────────────────────────
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.profiles (id) values (new.id)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ─────────────────────────────────────────────────────────────
-- 함수 3개 — 전부 security definer, search_path 고정
-- ─────────────────────────────────────────────────────────────

-- 티어 판정은 여기 한 곳에만 존재한다.
-- 애플리케이션 코드에서 tier·current_period_end 를 직접 비교하지 마라.
create or replace function public.effective_tier(uid uuid)
returns text
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(
    (
      select case
        when p.tier = 'pro'
          and p.current_period_end is not null
          and p.current_period_end > now()
        then 'pro'
        else 'free'
      end
      from public.profiles p
      where p.id = uid
    ),
    'free'
  );
$$;

-- uid·period 를 인자로 받지 않는다. 인자로 받으면 호출자가 남의 카운터를
-- 소진시킬 수 있다. 함수 안에서 auth.uid() 와 서버 시각을 읽는다.
create or replace function public.increment_usage(kind text)
returns int
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  caller uuid := auth.uid();
  current_period text := to_char(now(), 'YYYY-MM');
  updated int;
begin
  if caller is null then
    raise exception 'increment_usage: 인증되지 않은 호출입니다';
  end if;

  if kind not in ('classify', 'chat') then
    raise exception 'increment_usage: 알 수 없는 kind %', kind;
  end if;

  insert into public.usage_counters (owner_id, period, classify_used, chat_used)
  values (
    caller,
    current_period,
    case when kind = 'classify' then 1 else 0 end,
    case when kind = 'chat' then 1 else 0 end
  )
  on conflict (owner_id, period) do update
    set classify_used = usage_counters.classify_used
                        + case when kind = 'classify' then 1 else 0 end,
        chat_used     = usage_counters.chat_used
                        + case when kind = 'chat' then 1 else 0 end
  returning case when kind = 'classify' then classify_used else chat_used end
  into updated;

  return updated;
end;
$$;

-- 되돌리는 함수는 만들지 않는다. 되돌릴 수 있으면 표본 분류가 무한이 된다.
create or replace function public.mark_sample_used()
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if auth.uid() is null then
    raise exception 'mark_sample_used: 인증되지 않은 호출입니다';
  end if;

  update public.profiles set sample_used = true where id = auth.uid();
end;
$$;

revoke execute on function public.effective_tier(uuid) from public;
revoke execute on function public.increment_usage(text) from public;
revoke execute on function public.mark_sample_used() from public;
grant execute on function public.effective_tier(uuid) to authenticated;
grant execute on function public.increment_usage(text) to authenticated;
grant execute on function public.mark_sample_used() to authenticated;

-- ─────────────────────────────────────────────────────────────
-- RLS
-- ─────────────────────────────────────────────────────────────
alter table public.profiles       enable row level security;
alter table public.analyses       enable row level security;
alter table public.user_rules     enable row level security;
alter table public.transactions   enable row level security;
alter table public.usage_counters enable row level security;

-- analyses — 사용자가 전부 한다
create policy analyses_select on public.analyses
  for select to authenticated using (owner_id = auth.uid());
create policy analyses_insert on public.analyses
  for insert to authenticated with check (owner_id = auth.uid());
create policy analyses_update on public.analyses
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy analyses_delete on public.analyses
  for delete to authenticated using (owner_id = auth.uid());

-- transactions — 사용자가 전부 한다
create policy transactions_select on public.transactions
  for select to authenticated using (owner_id = auth.uid());
create policy transactions_insert on public.transactions
  for insert to authenticated with check (owner_id = auth.uid());
create policy transactions_update on public.transactions
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy transactions_delete on public.transactions
  for delete to authenticated using (owner_id = auth.uid());

-- user_rules — 사용자가 전부 한다
create policy user_rules_select on public.user_rules
  for select to authenticated using (owner_id = auth.uid());
create policy user_rules_insert on public.user_rules
  for insert to authenticated with check (owner_id = auth.uid());
create policy user_rules_update on public.user_rules
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy user_rules_delete on public.user_rules
  for delete to authenticated using (owner_id = auth.uid());

-- profiles — 읽기와 제한적 UPDATE만. INSERT는 트리거, DELETE는 없다.
create policy profiles_select on public.profiles
  for select to authenticated using (id = auth.uid());
create policy profiles_update on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- 사용자가 바꿀 수 없는 컬럼.
--   tier·current_period_end — 자기 행을 UPDATE해 Pro가 되면 결제가 무의미하다
--   sample_used             — false로 되돌리면 익명 표본 분류가 무한이 된다
--   polar_*                 — 남의 구독 ID를 자기 행에 넣는 통로가 된다
-- 갱신 주체는 웹훅·billing/sync(service role)와 mark_sample_used() 뿐이다.
-- service role은 authenticated 롤이 아니므로 이 revoke의 영향을 받지 않는다.
revoke update (tier, current_period_end, sample_used,
               polar_customer_id, polar_subscription_id)
  on public.profiles from authenticated;

-- usage_counters — SELECT만. INSERT·UPDATE·DELETE 정책을 만들지 않는다.
--
-- 쓰기를 열면 사용자가 update usage_counters set classify_used = 0 으로
-- 쿼터 관문 전체를 무력화한다. DELETE도 같은 구멍이다 — 행을 지우면
-- 카운터가 0부터 다시 시작한다. 쓰기는 increment_usage() 만 한다.
create policy usage_counters_select on public.usage_counters
  for select to authenticated using (owner_id = auth.uid());

revoke insert, update, delete on public.usage_counters from authenticated;
