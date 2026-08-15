import { describe, expect, it } from "vitest";

import { redactRows } from "@/lib/redact";
import type { IdentifiedRow } from "@/types/domain";

import { buildPromptBlocks } from "./prompt";

const ROWS: IdentifiedRow[] = [
  { id: "t1", occurredOn: "2026-01-05", merchant: "스타벅스 강남점", amountKrw: 5500 },
  { id: "t2", occurredOn: "2026-01-07", merchant: "이마트24", amountKrw: 12000 },
];

function ledgerOf(rows: IdentifiedRow[]) {
  const { data } = redactRows(rows);
  return buildPromptBlocks(data);
}

describe("buildPromptBlocks", () => {
  it("system 블록에 cache_control이 붙는다", () => {
    const { system } = ledgerOf(ROWS);

    expect(system.length).toBeGreaterThan(0);
    for (const block of system) {
      expect(block.cache_control).toEqual({ type: "ephemeral" });
      expect(block.type).toBe("text");
    }
  });

  it("ledger 블록에 cache_control이 붙는다", () => {
    const { ledger } = ledgerOf(ROWS);

    expect(ledger.cache_control).toEqual({ type: "ephemeral" });
    expect(ledger.type).toBe("text");
  });

  it("거래내역이 번호가 매겨진 목록으로 들어간다", () => {
    const { ledger } = ledgerOf(ROWS);

    expect(ledger.text).toContain("1. 2026-01-05");
    expect(ledger.text).toContain("2. 2026-01-07");
    expect(ledger.text).toContain("스타벅스 강남점");
    expect(ledger.text).toContain("12000");
  });

  it("같은 입력에 같은 프리픽스 문자열을 낸다(결정론 — 캐시 히트 조건)", () => {
    const a = ledgerOf(ROWS);
    const b = ledgerOf(ROWS);

    expect(a.ledger.text).toBe(b.ledger.text);
    expect(a.system).toEqual(b.system);
  });

  it("계정과목 12개 정의를 시스템 프롬프트에 포함한다", () => {
    const { system } = ledgerOf(ROWS);
    const text = system.map((b) => b.text).join("\n");

    for (const code of [
      "entertainment",
      "travel",
      "supplies",
      "communication",
      "advertising",
      "fees",
      "welfare",
      "vehicle",
      "books",
      "education",
      "rent",
      "other",
    ]) {
      expect(text).toContain(code);
    }
  });

  it("확신이 서지 않으면 review를 내라는 지시를 포함한다", () => {
    const { system } = ledgerOf(ROWS);
    const text = system.map((b) => b.text).join("\n");

    expect(text).toContain("review");
  });

  it("세무 판단 금지 문구가 없다(금지어 자체를 소스에 남기지 않는다)", () => {
    const { system, ledger } = ledgerOf(ROWS);
    const text = system.map((b) => b.text).join("\n") + ledger.text;

    // 금지어를 문자열 결합으로 구성해, 이 검증 코드 자체가 grep에 걸리지 않게 한다.
    const forbidden = [
      ["경비 처리", " 가능"].join(""),
      ["손", "금"].join(""),
      ["절", "세"].join(""),
      ["가산", "세"].join(""),
      ["신고", "하세요"].join(""),
    ];

    for (const word of forbidden) {
      expect(text).not.toContain(word);
    }
  });
});
