import { describe, expect, it } from "vitest";

import type { IdentifiedRow } from "@/types/domain";

import { redactMerchant, redactRows } from "./redact";

describe("redactMerchant — 카드번호", () => {
  it("구분자 네 종류를 모두 [CARD]로 치환한다", () => {
    expect(redactMerchant("1234-5678-9012-3456")).toBe("[CARD]");
    expect(redactMerchant("1234 5678 9012 3456")).toBe("[CARD]");
    expect(redactMerchant("1234********3456")).toBe("[CARD]");
    expect(redactMerchant("1234567890123456")).toBe("[CARD]");
  });

  it("13~15자리 연속 숫자도 카드번호로 본다", () => {
    expect(redactMerchant("1234567890123")).toBe("[CARD]");
    expect(redactMerchant("123456789012345")).toBe("[CARD]");
  });

  it("문맥은 남긴다", () => {
    expect(redactMerchant("1234-5678-9012-3456 승인")).toBe("[CARD] 승인");
  });
});

describe("redactMerchant — 계좌·주민번호·전화번호", () => {
  it("계좌번호를 [ACCT]로 치환한다", () => {
    expect(redactMerchant("국민 123-45-678901 이체")).toBe("국민 [ACCT] 이체");
    expect(redactMerchant("110-234-567890")).toBe("[ACCT]");
  });

  it("주민등록번호를 [RRN]으로 치환한다", () => {
    expect(redactMerchant("901010-1234567")).toBe("[RRN]");
  });

  it("전화번호를 [PHONE]으로 치환한다", () => {
    expect(redactMerchant("010-1234-5678")).toBe("[PHONE]");
    expect(redactMerchant("문의 010-1234-5678")).toBe("문의 [PHONE]");
  });
});

describe("redactMerchant — 성명", () => {
  it("한글 2~4자 + 님을 [NAME]으로 치환한다", () => {
    expect(redactMerchant("홍길동님 계좌이체")).toBe("[NAME] 계좌이체");
    expect(redactMerchant("홍길동 님 계좌이체")).toBe("[NAME] 계좌이체");
    expect(redactMerchant("김철수님")).toBe("[NAME]");
  });

  it("삭제가 아니라 토큰으로 치환해 문맥을 남긴다", () => {
    expect(redactMerchant("홍길동님 이체")).toContain("이체");
  });
});

describe("redactMerchant — 과잉 마스킹 방지", () => {
  it("정상 상호를 건드리지 않는다", () => {
    for (const merchant of [
      "스타벅스 강남점",
      "이마트24",
      "GS25",
      "배스킨라빈스31",
      "쿠팡 로켓배송",
      "교보문고 광화문점",
      "CU 역삼1호점",
      "세븐일레븐 2호점",
    ]) {
      expect(redactMerchant(merchant)).toBe(merchant);
    }
  });

  it("날짜 문자열을 계좌번호로 오인하지 않는다", () => {
    expect(redactMerchant("2026-01-05 결제")).toBe("2026-01-05 결제");
  });

  it("짧은 숫자열을 건드리지 않는다", () => {
    expect(redactMerchant("배달의민족 1234")).toBe("배달의민족 1234");
  });
});

describe("redactRows", () => {
  const rows: IdentifiedRow[] = [
    {
      id: "t1",
      occurredOn: "2026-01-05",
      merchant: "스타벅스 강남점",
      amountKrw: 5500,
    },
    {
      id: "t2",
      occurredOn: "2026-01-07",
      merchant: "홍길동님 1234-5678-9012-3456 이체",
      amountKrw: -320000,
    },
  ];

  it("가맹점명만 마스킹하고 나머지는 보존한다", () => {
    const result = redactRows(rows);

    expect(result.data[0]).toEqual({
      id: "t1",
      occurredOn: "2026-01-05",
      merchant: "스타벅스 강남점",
      amountKrw: 5500,
    });
    expect(result.data[1]?.id).toBe("t2");
    expect(result.data[1]?.occurredOn).toBe("2026-01-07");
    expect(result.data[1]?.amountKrw).toBe(-320000);
    expect(result.data[1]?.merchant).toBe("[NAME] [CARD] 이체");
  });

  it("한 행에서 두 개를 치환하면 removedCount가 2다", () => {
    expect(redactRows([rows[1]!]).removedCount).toBe(2);
  });

  it("마스킹할 것이 없으면 removedCount가 0이다", () => {
    expect(redactRows([rows[0]!]).removedCount).toBe(0);
  });

  it("여러 행의 치환 횟수를 모두 더한다", () => {
    expect(redactRows(rows).removedCount).toBe(2);
  });

  it("입력을 변형하지 않는다", () => {
    const input: IdentifiedRow[] = [
      { ...rows[0]! },
      { ...rows[1]! },
    ];
    const snapshot = input.map((row) => ({ ...row }));

    const result = redactRows(input);

    expect(input).toEqual(snapshot);
    expect(result.data[0]).not.toBe(input[0]);
    expect(result.data[1]).not.toBe(input[1]);
  });

  it("빈 배열도 처리한다", () => {
    expect(redactRows([])).toEqual({ data: [], removedCount: 0 });
  });
});
