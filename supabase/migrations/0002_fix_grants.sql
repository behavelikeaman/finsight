-- 0001의 권한 설정 결함 수정
--
-- 배경: 0001은 profiles의 민감 컬럼을 이렇게 막으려 했다.
--
--   revoke update (tier, current_period_end, sample_used, polar_*)
--     on public.profiles from authenticated;
--
-- 이 문장은 **아무 효과가 없다.** Postgres에서 테이블 레벨 UPDATE 권한이
-- 있으면 모든 컬럼을 UPDATE할 수 있고, 컬럼 레벨 revoke는 그것을 되돌리지
-- 못한다. Supabase는 public 스키마의 모든 테이블에 anon·authenticated로
-- ALL을 grant하므로 테이블 레벨 UPDATE가 남아 있었다.
--
-- 결과: 사용자가 자기 행에
--   update profiles set tier='pro', current_period_end='2099-01-01'
-- 를 실행해 결제 없이 Pro가 될 수 있었다. profiles_update 정책이
-- id = auth.uid() 만 검사하므로 RLS도 이를 막지 못한다.
--
-- 확인 방법:
--   select has_column_privilege('authenticated','public.profiles','tier','UPDATE');
--   -- 수정 후 false 여야 한다.

-- ─────────────────────────────────────────────────────────────
-- profiles — authenticated 에게 SELECT 외에는 아무것도 주지 않는다.
--
-- 코드가 profiles를 쓰는 경로는 셋뿐이고 전부 authenticated 롤이 아니다.
--   INSERT : handle_new_user() 트리거 (security definer)
--   UPDATE : 웹훅·billing/sync (service role), mark_sample_used() (security definer)
--   SELECT : 사용자 세션 — 이것만 남긴다
-- ─────────────────────────────────────────────────────────────
revoke insert, update, delete on public.profiles from authenticated;
revoke insert, update, delete on public.profiles from anon;

-- 정책을 남겨두면 UPDATE가 되는 것처럼 읽힌다. grant가 없으니 실제로는
-- 막히지만, 읽는 사람을 오해시키는 정책은 두지 않는다.
drop policy if exists profiles_update on public.profiles;

-- ─────────────────────────────────────────────────────────────
-- usage_counters — 0001은 authenticated 만 revoke 했다. anon 이 남아 있었다.
--
-- 지금은 anon 용 RLS 정책이 없어 거부되지만, 정책이 하나라도 추가되면
-- 그 즉시 쿼터 우회 경로가 된다. 권한 자체를 걷는다.
-- ─────────────────────────────────────────────────────────────
revoke insert, update, delete on public.usage_counters from anon;

-- ─────────────────────────────────────────────────────────────
-- 나머지 사용자 데이터 테이블 — anon 에게는 아무 권한도 필요 없다.
--
-- 익명 업로드도 signInAnonymously() 로 진짜 세션을 받은 뒤에 일어나므로
-- 그 시점의 롤은 authenticated 다. anon 은 로그인 이전 상태이며 이 테이블에
-- 접근할 일이 없다. RLS 정책이 전부 `to authenticated` 라 지금도 거부되지만,
-- 방어를 정책 한 겹에만 의존하지 않는다.
-- ─────────────────────────────────────────────────────────────
revoke insert, update, delete on public.analyses from anon;
revoke insert, update, delete on public.transactions from anon;
revoke insert, update, delete on public.user_rules from anon;
