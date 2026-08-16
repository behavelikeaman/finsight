/**
 * 중복 업로드 판정용 지문.
 *
 * 정렬한 뒤 해싱한다 — 같은 명세서를 다른 순서로 내려받아도 같은 지문이 나와야
 * 중복이 잡힌다.
 *
 * Node의 crypto 모듈을 import 하지 마라. 이 코드는 브라우저에서도 돈다.
 * crypto.subtle이 비동기라 반환은 Promise다.
 */
import type { NormalizedRow } from "@/types/domain";

export async function computeFingerprint(
  rows: NormalizedRow[],
): Promise<string> {
  const lines = rows
    .map((row) => `${row.occurredOn}|${row.merchant}|${row.amountKrw}`)
    .sort();

  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(lines.join("\n")),
  );

  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
