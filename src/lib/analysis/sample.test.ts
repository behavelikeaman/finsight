import { describe, expect, it } from "vitest";

import type { IdentifiedRow } from "@/types/domain";
import { SAMPLE_SIZE } from "@/types/tier";

import { pickSample } from "./sample";

const ROWS: IdentifiedRow[] = [
  { id: "t1", occurredOn: "2026-01-05", merchant: "편의점", amountKrw: 3200 },
  { id: "t2", occurredOn: "2026-01-07", merchant: "노트북", amountKrw: 1800000 },
  { id: "t3", occurredOn: "2026-01-09", merchant: "환불", amountKrw: -520000 },
  { id: "t4", occurredOn: "2026-01-11", merchant: "식당", amountKrw: 45000 },
];

describe("pickSample", () => {
  it("금액 절대값 내림차순 상위 size건을 고른다", () => {
    expect(pickSample(ROWS, 2).map((r) => r.id)).toEqual(["t2", "t3"]);
  });

  it("환불(음수)도 절대값으로 판단한다", () => {
    expect(pickSample(ROWS, 3).map((r) => r.id)).toEqual(["t2", "t3", "t4"]);
  });

  it("같은 입력에 같은 출력을 낸다", () => {
    expect(pickSample(ROWS, SAMPLE_SIZE)).toEqual(pickSample(ROWS, SAMPLE_SIZE));
  });

  it("동점이면 occurredOn·id 내림차순으로 안정 정렬한다", () => {
    const tied: IdentifiedRow[] = [
      { id: "a", occurredOn: "2026-01-05", merchant: "A", amountKrw: 1000 },
      { id: "c", occurredOn: "2026-01-09", merchant: "C", amountKrw: 1000 },
      { id: "b", occurredOn: "2026-01-09", merchant: "B", amountKrw: 1000 },
    ];

    expect(pickSample(tied, 3).map((r) => r.id)).toEqual(["c", "b", "a"]);
  });

  it("각 원소의 id를 보존한다", () => {
    const sample = pickSample(ROWS, 4);

    expect(sample.every((r) => typeof r.id === "string" && r.id !== "")).toBe(
      true,
    );
    expect(sample[0]).toBe(ROWS[1]);
  });

  it("size가 행 수보다 크면 전체를 낸다", () => {
    expect(pickSample(ROWS, 100)).toHaveLength(4);
  });

  it("size가 0 이하면 빈 배열이다", () => {
    expect(pickSample(ROWS, 0)).toEqual([]);
    expect(pickSample(ROWS, -1)).toEqual([]);
  });

  it("입력 배열을 변형하지 않는다", () => {
    const input = [...ROWS];
    pickSample(input, 2);

    expect(input.map((r) => r.id)).toEqual(["t1", "t2", "t3", "t4"]);
  });
});
