-- 0001의 함수 실행 권한 결함 수정
--
-- 배경: 0001은 이렇게 함수를 잠그려 했다.
--
--   revoke execute on function public.increment_usage(text) from public;
--   grant  execute on function public.increment_usage(text) to authenticated;
--
-- `from public` 은 PUBLIC 의사롤만 되돌린다. Supabase는 별도로
-- `grant execute on all functions in schema public to anon, authenticated`
-- 를 실행하므로 anon 에 **직접** 부여된 권한이 그대로 남았다.
-- 0002의 profiles 건과 같은 패턴이다 — revoke 대상이 틀렸다.
--
-- 확인 방법:
--   select has_function_privilege('anon','public.effective_tier(uuid)','EXECUTE');
--   -- 수정 후 false 여야 한다.

-- ─────────────────────────────────────────────────────────────
-- anon 은 이 함수들을 호출할 일이 없다.
--
-- increment_usage·mark_sample_used 는 내부에서 auth.uid() 를 검사해
-- 익명 호출에 예외를 던지므로 실질 피해는 없었다. 다만 effective_tier 는
-- uid 를 **인자로** 받으므로, uid 를 아는 호출자가 남의 티어를 조회할 수
-- 있었다. 방어를 함수 내부 검사 한 겹에만 맡기지 않는다.
--
-- 익명 업로드도 signInAnonymously() 이후에는 authenticated 롤이므로
-- 이 revoke 는 익명 흐름을 막지 않는다.
-- ─────────────────────────────────────────────────────────────
revoke execute on function public.effective_tier(uuid) from anon;
revoke execute on function public.increment_usage(text) from anon;
revoke execute on function public.mark_sample_used() from anon;

-- ─────────────────────────────────────────────────────────────
-- handle_new_user() 는 auth.users INSERT 트리거 전용이다.
-- PostgREST 가 /rest/v1/rpc/handle_new_user 로 노출하고 있었다.
--
-- 트리거 발화에는 EXECUTE 권한 검사가 없으므로(트리거는 테이블 소유자
-- 컨텍스트로 실행된다) 전부 revoke 해도 profiles 자동 생성은 계속 동작한다.
-- ─────────────────────────────────────────────────────────────
revoke execute on function public.handle_new_user() from anon;
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.handle_new_user() from public;
