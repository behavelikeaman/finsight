/**
 * 픽스처 자체의 자기 검증.
 *
 * 이 파일의 픽스처는 ingest 테스트 전체의 기준선이다. 픽스처 생성기가
 * 조용히 망가지면(예: EUC-KR 인코더가 물음표를 뱉으면) 정작 검증하려던
 * 인코딩 버그가 테스트를 통과해 버린다.
 */
import { describe, expect, it } from "vitest";

import {
  CSV_EMPTY,
  CSV_HEADER_ONLY,
  CSV_KOREAN,
  CSV_PREAMBLE_AND_TOTAL,
  CSV_QUOTED,
  CSV_UTF8,
  CSV_WITH_PREAMBLE,
  CSV_WITH_TOTAL,
  buildXlsx,
  encodeEucKr,
  encodeUtf8,
} from "./index";

describe("픽스처", () => {
  it("8종이 모두 서로 다른 내용이다", () => {
    const all = [
      CSV_UTF8,
      CSV_KOREAN,
      CSV_WITH_PREAMBLE,
      CSV_WITH_TOTAL,
      CSV_PREAMBLE_AND_TOTAL,
      CSV_QUOTED,
      CSV_HEADER_ONLY,
      CSV_EMPTY,
    ];
    expect(new Set(all).size).toBe(all.length);
  });

  it("encodeUtf8은 BOM을 선택적으로 붙인다", () => {
    const plain = new Uint8Array(encodeUtf8("가"));
    const withBom = new Uint8Array(encodeUtf8("가", { bom: true }));

    expect(Array.from(withBom.slice(0, 3))).toEqual([0xef, 0xbb, 0xbf]);
    expect(withBom.length).toBe(plain.length + 3);
  });

  it("encodeEucKr은 한글을 2바이트로 인코딩하고 왕복한다", () => {
    const buffer = encodeEucKr("스타벅스,5500");
    const bytes = new Uint8Array(buffer);

    // 한글 4자(8바이트) + ASCII 5자 = 13바이트
    expect(bytes.length).toBe(13);
    expect(bytes[0]).toBeGreaterThan(0x7f);
    expect(new TextDecoder("euc-kr").decode(buffer)).toBe("스타벅스,5500");
  });

  it("encodeEucKr 결과는 UTF-8로 디코딩되지 않는다", () => {
    const buffer = encodeEucKr(CSV_KOREAN);
    expect(() =>
      new TextDecoder("utf-8", { fatal: true }).decode(buffer),
    ).toThrow();
  });

  // ExcelJS는 동적 import라 첫 로드에 수 초가 걸린다. 기본 5초 타임아웃으로는 부족하다.
  it(
    "buildXlsx는 xlsx 시그니처(PK)로 시작하는 버퍼를 만든다",
    async () => {
      const buffer = await buildXlsx([["이용일자"], ["2026-01-05"]]);
      const bytes = new Uint8Array(buffer);

      expect(bytes[0]).toBe(0x50); // 'P'
      expect(bytes[1]).toBe(0x4b); // 'K'
    },
    30_000,
  );
});
