import { describe, expect, it } from "vitest";

import { parseCsv } from "./csv";
import { CSV_EMPTY, CSV_HEADER_ONLY, CSV_QUOTED, CSV_UTF8 } from "./__fixtures__";

describe("parseCsv", () => {
  it("헤더 1행 + 거래 3행을 읽는다", () => {
    const rows = parseCsv(CSV_UTF8);

    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual(["이용일자", "가맹점명", "이용금액"]);
    expect(rows[1]).toEqual(["2026-01-05", "스타벅스 강남점", "5500"]);
  });

  it("따옴표 안의 쉼표를 필드 구분자로 보지 않는다", () => {
    const rows = parseCsv(CSV_QUOTED);

    expect(rows[1]).toEqual(["2026-01-05", "카페, 스타벅스", "5500"]);
  });

  it("이스케이프된 따옴표를 하나로 되돌린다", () => {
    const rows = parseCsv(CSV_QUOTED);

    expect(rows[2]).toEqual(["2026-01-06", '그는 "최고"라고 했다', "1000"]);
  });

  it("따옴표 안의 줄바꿈은 행을 나누지 않는다", () => {
    const rows = parseCsv(CSV_QUOTED);

    expect(rows).toHaveLength(4);
    expect(rows[3]).toEqual(["2026-01-07", "두 줄\n가맹점", "2000"]);
  });

  it("CRLF 줄바꿈을 처리한다", () => {
    const rows = parseCsv("a,b\r\n1,2\r\n");

    expect(rows).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("마지막 줄바꿈이 빈 행을 만들지 않는다", () => {
    expect(parseCsv(CSV_HEADER_ONLY)).toHaveLength(1);
  });

  it("중간의 빈 줄을 버린다", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("빈 문자열은 빈 배열이 된다", () => {
    expect(parseCsv(CSV_EMPTY)).toEqual([]);
  });

  it("빈 필드를 보존한다", () => {
    expect(parseCsv("합계,,40700")).toEqual([["합계", "", "40700"]]);
  });
});
