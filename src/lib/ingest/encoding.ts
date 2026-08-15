/**
 * 인코딩 감지.
 *
 * 한국 카드사 CSV는 상당수가 EUC-KR(CP949)이다. UTF-8로 단정하면 가맹점명이
 * 전부 깨지고, 깨진 가맹점명은 분류를 통째로 망가뜨린다.
 *
 * 브라우저·Node 양쪽에 있는 TextDecoder만 쓴다. Node 전용 API를 쓰지 마라.
 */

const UTF8_BOM = [0xef, 0xbb, 0xbf];

export function decodeText(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);

  if (hasUtf8Bom(bytes)) {
    // TextDecoder는 기본적으로 BOM을 떼어낸다.
    return new TextDecoder("utf-8").decode(bytes);
  }

  try {
    // fatal: true 라야 잘못된 바이트에서 예외가 난다. 기본값은 U+FFFD로
    // 조용히 치환해 버려서, 깨진 결과를 그대로 통과시킨다.
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("euc-kr").decode(bytes);
  }
}

function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte);
}
