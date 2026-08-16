import { describe, expect, it } from "vitest";

import type { ClassifiedTransaction } from "@/types/analysis";
import { CONFIDENCE_THRESHOLD } from "@/types/tier";

import { bucketByClassification } from "./bucket";

function tx(
  overrides: Partial<ClassifiedTransaction> & { id: string },
): ClassifiedTransaction {
  return {
    occurredOn: "2026-01-05",
    merchant: "쿠팡",
    amountKrw: 10000,
    classification: "business",
    accountCode: "supplies",
    confidence: 0.9,
    isUserEdited: false,
    fromRule: false,
    ...overrides,
  };
}

describe("bucketByClassification", () => {
  it("빈 입력에도 형태를 유지한다", () => {
    expect(bucketByClassification([])).toEqual({
      review: [],
      business: [],
      personal: [],
      unclassified: [],
      businessTotalKrw: 0,
      personalTotalKrw: 0,
    });
  });

  it("확신도가 높은 건을 분류대로 나눈다", () => {
    const view = bucketByClassification([
      tx({ id: "a", classification: "business", amountKrw: 10000 }),
      tx({ id: "b", classification: "personal", amountKrw: 3000 }),
    ]);

    expect(view.business.map((t) => t.id)).toEqual(["a"]);
    expect(view.personal.map((t) => t.id)).toEqual(["b"]);
    expect(view.businessTotalKrw).toBe(10000);
    expect(view.personalTotalKrw).toBe(3000);
  });

  it("확신도가 임계값 미만이면 분류와 무관하게 review로 간다", () => {
    const view = bucketByClassification([
      tx({ id: "a", classification: "business", confidence: 0.6 }),
      tx({ id: "b", classification: "personal", confidence: 0.6 }),
    ]);

    expect(view.review.map((t) => t.id)).toEqual(["a", "b"]);
    expect(view.business).toEqual([]);
    expect(view.personal).toEqual([]);
  });

  it("임계값과 같으면 review가 아니다", () => {
    const view = bucketByClassification([
      tx({ id: "a", confidence: CONFIDENCE_THRESHOLD }),
    ]);

    expect(view.business.map((t) => t.id)).toEqual(["a"]);
  });

  it("classification이 'review'면 확신도가 높아도 review다", () => {
    const view = bucketByClassification([
      tx({ id: "a", classification: "review", confidence: 0.95 }),
    ]);

    expect(view.review.map((t) => t.id)).toEqual(["a"]);
  });

  it("사용자가 고친 건은 확신도가 낮아도 review로 보내지 않는다", () => {
    const view = bucketByClassification([
      tx({
        id: "a",
        classification: "business",
        confidence: 0.5,
        isUserEdited: true,
      }),
    ]);

    expect(view.review).toEqual([]);
    expect(view.business.map((t) => t.id)).toEqual(["a"]);
    expect(view.businessTotalKrw).toBe(10000);
  });

  it("classification이 null이면 unclassified다", () => {
    const view = bucketByClassification([
      tx({ id: "a", classification: null, accountCode: null, confidence: null }),
    ]);

    expect(view.unclassified.map((t) => t.id)).toEqual(["a"]);
    expect(view.review).toEqual([]);
  });

  it("확신도가 없는 분류 건은 review로 모은다", () => {
    const view = bucketByClassification([
      tx({ id: "a", classification: "business", confidence: null }),
    ]);

    expect(view.review.map((t) => t.id)).toEqual(["a"]);
  });

  it("review·unclassified 금액을 경비 합계에 더하지 않는다", () => {
    const view = bucketByClassification([
      tx({ id: "a", classification: "business", amountKrw: 10000 }),
      tx({ id: "b", classification: "business", amountKrw: 7000, confidence: 0.4 }),
      tx({ id: "c", classification: "review", amountKrw: 5000 }),
      tx({
        id: "d",
        classification: null,
        accountCode: null,
        confidence: null,
        amountKrw: 3000,
      }),
      tx({ id: "e", classification: "personal", amountKrw: 2000 }),
    ]);

    expect(view.businessTotalKrw).toBe(10000);
    expect(view.personalTotalKrw).toBe(2000);
    expect(view.review.map((t) => t.id)).toEqual(["b", "c"]);
    expect(view.unclassified.map((t) => t.id)).toEqual(["d"]);
  });

  it("합계가 정수를 유지하고 환불 행도 반영한다", () => {
    const view = bucketByClassification([
      tx({ id: "a", classification: "business", amountKrw: 10000 }),
      tx({ id: "b", classification: "business", amountKrw: -4000 }),
    ]);

    expect(view.businessTotalKrw).toBe(6000);
    expect(Number.isInteger(view.businessTotalKrw)).toBe(true);
  });

  it("입력 객체를 그대로 담는다", () => {
    const input = tx({ id: "a" });
    const view = bucketByClassification([input]);

    expect(view.business[0]).toBe(input);
  });
});
