/**
 * 익명 프리뷰에서 AI로 보낼 거래를 고른다 (ADR-015).
 *
 * 금액 절대값 내림차순. 무작위로 고르면 편의점 결제만 나와 "AI가 내 경비를
 * 제대로 가르는가"를 판단할 수 없다.
 */
import type { IdentifiedRow } from "@/types/domain";

export function pickSample(
  rows: IdentifiedRow[],
  size: number,
): IdentifiedRow[] {
  if (size <= 0) return [];

  // 입력을 변형하지 않는다. 호출부가 같은 배열을 화면에 그대로 쓴다.
  return [...rows]
    .sort(
      (a, b) =>
        Math.abs(b.amountKrw) - Math.abs(a.amountKrw) ||
        // 동점 순서를 고정한다. 재실행 시 다른 건이 뽑히면 안 된다.
        b.occurredOn.localeCompare(a.occurredOn) ||
        b.id.localeCompare(a.id),
    )
    .slice(0, size);
}
