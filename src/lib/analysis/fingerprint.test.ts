import { describe, expect, it } from "vitest";

import type { NormalizedRow } from "@/types/domain";

import { computeFingerprint } from "./fingerprint";

const ROWS: NormalizedRow[] = [
  { occurredOn: "2026-01-05", merchant: "스타벅스 강남점", amountKrw: 5500 },
  { occurredOn: "2026-01-07", merchant: "쿠팡", amountKrw: 32000 },
  { occurredOn: "2026-02-03", merchant: "GS25 역삼점", amountKrw: 3200 },
];

describe("computeFingerprint", () => {
  it("sha256 16진수 64자를 반환한다", async () => {
    const fingerprint = await computeFingerprint(ROWS);

    expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  });

  it("같은 내용이면 같은 지문이다", async () => {
    expect(await computeFingerprint(ROWS)).toBe(await computeFingerprint(ROWS));
  });

  it("순서만 다르면 같은 지문이다", async () => {
    const shuffled = [ROWS[2]!, ROWS[0]!, ROWS[1]!];

    expect(await computeFingerprint(shuffled)).toBe(
      await computeFingerprint(ROWS),
    );
  });

  it("한 행의 금액만 달라도 지문이 달라진다", async () => {
    const changed = [ROWS[0]!, ROWS[1]!, { ...ROWS[2]!, amountKrw: 3201 }];

    expect(await computeFingerprint(changed)).not.toBe(
      await computeFingerprint(ROWS),
    );
  });

  it("한 행의 가맹점만 달라도 지문이 달라진다", async () => {
    const changed = [ROWS[0]!, ROWS[1]!, { ...ROWS[2]!, merchant: "GS25" }];

    expect(await computeFingerprint(changed)).not.toBe(
      await computeFingerprint(ROWS),
    );
  });

  it("행이 하나 빠지면 지문이 달라진다", async () => {
    expect(await computeFingerprint(ROWS.slice(0, 2))).not.toBe(
      await computeFingerprint(ROWS),
    );
  });

  it("입력 배열을 정렬로 변형하지 않는다", async () => {
    const input = [...ROWS];
    await computeFingerprint(input);

    expect(input).toEqual(ROWS);
  });

  it("빈 배열도 지문을 낸다", async () => {
    expect(await computeFingerprint([])).toMatch(/^[0-9a-f]{64}$/);
  });
});
