/**
 * Polar 구독 상태 → Pro 권리 여부.
 *
 * 웹훅과 billing/sync 가 같은 판정을 써야 한다. 두 곳에 상수를 복제하면
 * 한쪽만 고쳐지는 날 게이팅이 어긋난다.
 *
 * 이것은 **최종 판정이 아니다.** 권리의 최종 판정은 effective_tier() 가
 * tier + current_period_end 로 한다. 여기서 true 를 받아도 기간이 지났으면
 * 사용자는 free 다. 이 함수는 "지금 tier 를 내릴 것인가"만 답한다.
 */
const ENTITLED_STATUSES = new Set([
  "active",
  "trialing",
  // 결제 실패는 해지가 아니라 재시도 중인 상태다. 즉시 내리면 재청구가
  // 성공해도 그 사이 사용자가 이유 없이 잘린다. 대신 화면이 안내를 띄우고,
  // 기간이 만료되면 effective_tier 가 알아서 닫는다.
  "past_due",
]);

export function isEntitledStatus(status: string): boolean {
  return ENTITLED_STATUSES.has(status);
}
