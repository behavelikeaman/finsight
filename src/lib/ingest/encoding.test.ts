import { describe, expect, it } from "vitest";

import { decodeText } from "./encoding";
import { CSV_KOREAN, CSV_UTF8, encodeEucKr, encodeUtf8 } from "./__fixtures__";

describe("decodeText", () => {
  it("UTF-8 파일을 그대로 디코딩한다", () => {
    expect(decodeText(encodeUtf8(CSV_UTF8))).toBe(CSV_UTF8);
  });

  it("UTF-8 BOM을 제거한다", () => {
    const decoded = decodeText(encodeUtf8(CSV_UTF8, { bom: true }));

    expect(decoded).toBe(CSV_UTF8);
    expect(decoded.startsWith("﻿")).toBe(false);
  });

  it("EUC-KR 파일의 한글이 깨지지 않는다", () => {
    const decoded = decodeText(encodeEucKr(CSV_KOREAN));

    expect(decoded).toBe(CSV_KOREAN);
    expect(decoded).toContain("스타벅스 강남점");
    expect(decoded).toContain("교보문고 광화문점");
    expect(decoded).not.toContain("�");
  });

  it("빈 버퍼는 빈 문자열이 된다", () => {
    expect(decodeText(new ArrayBuffer(0))).toBe("");
  });

  it("ASCII만 있는 파일은 UTF-8 경로로 처리된다", () => {
    expect(decodeText(encodeUtf8("a,b,c\n1,2,3"))).toBe("a,b,c\n1,2,3");
  });
});
