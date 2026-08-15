/**
 * 확신도 버킷팅 (ADR-011).
 *
 * 확인이 끝나지 않은 금액을 경비 합계에 넣지 않는다 — 사용자가 그 숫자를
 * 그대로 신고에 쓴다. 미확정은 미확정으로 보여야 한다.
 */
import type { ClassifiedTransaction, ClassifiedView } from "@/types/analysis";
import { CONFIDENCE_THRESHOLD } from "@/types/tier";

export function bucketByClassification(
  txs: ClassifiedTransaction[],
): ClassifiedView {
  const view: ClassifiedView = {
    review: [],
    business: [],
    personal: [],
    unclassified: [],
    businessTotalKrw: 0,
    personalTotalKrw: 0,
  };

  for (const tx of txs) {
    if (tx.classification === null) {
      view.unclassified.push(tx);
      continue;
    }

    if (needsReview(tx)) {
      view.review.push(tx);
      continue;
    }

    if (tx.classification === "business") {
      view.business.push(tx);
      view.businessTotalKrw += tx.amountKrw;
    } else if (tx.classification === "personal") {
      view.personal.push(tx);
      view.personalTotalKrw += tx.amountKrw;
    } else {
      view.review.push(tx);
    }
  }

  return view;
}

function needsReview(tx: ClassifiedTransaction): boolean {
  // 사용자가 이미 확정한 건은 확신도와 무관하게 확인 대상이 아니다.
  if (tx.isUserEdited) return false;

  // 확신도 없이 단정하지 않는다. 값이 없으면 확인 대상으로 본다.
  if (tx.confidence === null) return true;

  return tx.confidence < CONFIDENCE_THRESHOLD;
}
