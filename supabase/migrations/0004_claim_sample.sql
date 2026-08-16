-- 표본 분류 1회 제한을 원자적으로 만든다
--
-- 배경: 0001의 관문은 읽기와 쓰기가 분리되어 있었다.
--
--   1) checkSampleAllowance() — profiles.sample_used 를 SELECT 해서 판정
--   2) (Anthropic 호출, 6초)
--   3) mark_sample_used()    — 성공 후에 true 로 UPDATE
--
-- 1)과 3) 사이가 6초나 벌어져 있어, 그 사이에 도착한 두 번째 요청도 1)을
-- 통과한다. 실제로 React StrictMode 의 effect 이중 실행으로 재현되었다 —
-- 두 요청이 모두 LLM 을 호출해 **같은 결과에 비용만 2배** 나갔다.
-- 프로덕션에서도 빠른 새로고침·동시 탭·네트워크 재시도로 같은 일이 생긴다.
--
-- 해결: 판정과 소진을 한 문장으로 합친다. UPDATE ... WHERE sample_used = false
-- 는 행 잠금을 잡으므로, 동시에 들어온 둘 중 하나만 1행을 갱신한다.
-- 나머지는 0행을 받고 false 를 돌려받아 LLM 호출 전에 멈춘다.

create or replace function public.claim_sample()
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  affected int;
begin
  if auth.uid() is null then
    raise exception 'claim_sample: 인증되지 않은 호출입니다';
  end if;

  -- 판정과 소진이 한 문장이다. 나눠 쓰면 경합이 다시 생긴다.
  update public.profiles
     set sample_used = true
   where id = auth.uid()
     and sample_used = false;

  get diagnostics affected = row_count;

  -- true  = 이번 호출이 표본 기회를 가져갔다. 호출자는 LLM 을 호출해도 된다.
  -- false = 이미 소진되었다. 호출자는 즉시 멈춰야 한다.
  return affected > 0;
end;
$$;

revoke execute on function public.claim_sample() from public;
revoke execute on function public.claim_sample() from anon;
grant  execute on function public.claim_sample() to authenticated;

-- mark_sample_used() 는 claim_sample() 이 대체한다.
-- 남겨두면 "성공 후에 소진" 이라는 낡은 순서를 다시 쓰게 되므로 지운다.
-- 되돌리는 함수는 여전히 만들지 않는다 — 되돌릴 수 있으면 표본이 무한이 된다.
drop function if exists public.mark_sample_used();
