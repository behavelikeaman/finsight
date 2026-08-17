-- 이메일 수신 동의를 사용자가 직접 켜고 끌 수 있게 한다.
--
-- 배경: PRD의 「MVP 제외 사항」이 이메일 리마인더·리포트를 다음 phase로 미뤘다.
-- 이 마이그레이션은 그 선행 단계로 **동의의 저장과 해지 경로만** 만든다.
-- 발송 코드·크론·발송 이력 테이블은 없다. 값만 남고 아무도 읽지 않는 것이
-- 지금은 정상이다.
--
-- 왜 정책을 다시 열지 않고 RPC를 만드는가:
-- 0002가 profiles의 insert·update·delete 를 authenticated·anon 에서 테이블
-- 레벨로 걷어내고 profiles_update 정책도 지웠다. 이유는 그 파일의 주석에 있다 —
-- 컬럼 레벨 revoke 는 테이블 레벨 UPDATE 권한을 되돌리지 못해서, 사용자가
-- `update profiles set tier='pro'` 로 결제 없이 Pro 가 될 수 있었다.
-- 따라서 "수신 동의 컬럼만 열면 된다"는 접근은 이 테이블에서 성립하지 않는다.
-- 컬럼 하나를 열려고 테이블 UPDATE 를 되살리면 tier 도 같이 열린다.
-- 쓰기는 increment_usage·claim_sample 과 같은 형태의 security definer 함수로만
-- 한다.

-- ─────────────────────────────────────────────────────────────
-- 컬럼
--
-- 기본값 false — 명시적 opt-in 이다. 기존 행도 false 로 채워지므로, 이미
-- 가입한 사용자에게 동의하지 않은 메일이 나가는 일이 없다.
-- not null 로 두는 이유: null 이 "모름"으로 남으면 발송 쿼리를 쓰는 쪽이
-- `is not false` 같은 판정을 만들게 되고, 그 순간 미동의자가 대상에 섞인다.
-- ─────────────────────────────────────────────────────────────
alter table public.profiles
  add column if not exists email_opt_in boolean not null default false;

-- 사용자 UPDATE 권한은 이미 없다 — 0002 가 테이블 레벨로 걷어냈고 컬럼을
-- 추가해도 그 상태가 유지된다(0005 의 subscription_status 와 같다). 확인:
--   select has_column_privilege('authenticated','public.profiles',
--                               'email_opt_in','UPDATE');  -- false

-- ─────────────────────────────────────────────────────────────
-- 쓰기 관문
--
-- claim_sample 과 달리 원자적 선점이 아니라 멱등한 set 이다. 수신 동의는
-- 언제든 되돌릴 수 있어야 하므로(해지) 단순 UPDATE 가 맞고, 동시 클릭은
-- 마지막 값이 이기면 충분하다.
--
-- 인자로 uid 를 받지 않는다. auth.uid() 를 함수 안에서 읽는다 — 인자로 받으면
-- 남의 행 동의를 뒤집을 수 있다(increment_usage 와 같은 이유).
-- ─────────────────────────────────────────────────────────────
create or replace function public.set_email_opt_in(opt_in boolean)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  stored boolean;
begin
  if auth.uid() is null then
    raise exception 'set_email_opt_in: 인증되지 않은 호출입니다';
  end if;

  if opt_in is null then
    raise exception 'set_email_opt_in: opt_in 은 null 일 수 없습니다';
  end if;

  -- 이메일 주소가 없는 세션(익명)은 동의를 저장할 수 없다.
  --
  -- 앱 층 게이트만으로는 부족하다. 익명 세션도 롤은 authenticated 라서, uid 만
  -- 검사하면 익명 사용자가 anon 키로 이 함수를 직접 호출해 true 를 쓸 수 있다.
  -- linkIdentity() 는 uid 를 유지하므로, 그 동의는 나중에 연결된 실계정의
  -- 동의로 남는다 — 사용자가 준 적 없는 동의가 기록된다.
  --
  -- JWT 의 is_anonymous 클레임이 아니라 auth.users.email 을 본다. 토큰은 오래될
  -- 수 있고, "보낼 주소가 있는가"가 실제 전제 조건이다.
  if not exists (
    select 1
      from auth.users u
     where u.id = auth.uid()
       and u.email is not null
  ) then
    raise exception 'set_email_opt_in: 이메일 주소가 없는 세션입니다';
  end if;

  update public.profiles
     set email_opt_in = opt_in          -- 이 컬럼 하나만 건드린다
   where id = auth.uid()                -- 본인 행만
  returning email_opt_in into stored;

  if not found then
    raise exception 'set_email_opt_in: 프로필 행이 없습니다';
  end if;

  -- 호출자는 요청 값이 아니라 이 반환값을 화면에 반영해야 한다.
  return stored;
end;
$$;

-- 0003 이 학습한 대로 public 만 revoke 하면 anon 에 직접 부여된 grant 가 남는다.
-- 둘 다 걷고 authenticated 에만 준다.
revoke execute on function public.set_email_opt_in(boolean) from public;
revoke execute on function public.set_email_opt_in(boolean) from anon;
grant  execute on function public.set_email_opt_in(boolean) to authenticated;

-- 확인:
--   select has_function_privilege('anon',
--            'public.set_email_opt_in(boolean)','EXECUTE');           -- false
--   select has_function_privilege('authenticated',
--            'public.set_email_opt_in(boolean)','EXECUTE');           -- true
