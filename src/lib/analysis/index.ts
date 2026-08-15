/**
 * 집계·중복판정·확신도 버킷팅.
 *
 * 경비 분류(사업/개인) 판단은 여기서 하지 않는다 — AI가 한다. 여기서 규칙으로
 * 흉내 내면 진실이 두 개가 된다.
 *
 * 입력 타입이 함수마다 다른 것은 의도된 것이다. summarize·computeFingerprint는
 * 업로드 시점(id 없음), pickSample은 저장 후 분류 경로(id 있음)에서 돈다.
 */
export { bucketByClassification } from "./bucket";
export { computeFingerprint } from "./fingerprint";
export { pickSample } from "./sample";
export { summarize } from "./summarize";
