-- 결제 실패 안내를 위해 Polar 구독 상태 원문을 보관한다.
--
-- 배경: tier 는 "권리가 있는가"만 담는 이분값이라, 같은 free 라도 결제한 적이
-- 없어서인지 카드 갱신에 실패해서인지 구분할 수 없었다. 사용자는 자기 카드가
-- 만료된 줄 모른 채 기능이 잠긴 화면만 보게 된다. 안내 문구를 띄우려면
-- Polar가 보내는 상태 자체가 필요하다.
--
-- **티어 판정에는 쓰지 않는다.** 권리 판정은 effective_tier() 한 곳에만
-- 존재한다(tier + current_period_end). 이 컬럼은 화면에 무엇을 안내할지만
-- 정한다. 여기에 판정을 하나 더 만들면 두 판정이 반드시 어긋난다.
--
-- 값은 Polar의 status 원문이다(active·trialing·past_due·canceled·unpaid 등).
-- check 제약을 걸지 않는 이유: Polar가 새 상태를 추가하면 웹훅 쓰기가 통째로
-- 실패해 구독 반영이 멈춘다. 모르는 값은 화면에서 무시하는 편이 안전하다.
alter table public.profiles
  add column if not exists subscription_status text;

-- 사용자 UPDATE 권한은 이미 없다 — 0002 가 profiles 의 insert·update·delete 를
-- 테이블 레벨로 걷어냈다. 컬럼을 추가해도 그 상태가 유지되므로 여기서 따로
-- revoke 하지 않는다. 확인:
--   select has_column_privilege('authenticated','public.profiles',
--                               'subscription_status','UPDATE');  -- false
