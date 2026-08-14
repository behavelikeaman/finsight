/**
 * 요금제·임계값 숫자의 단일 출처.
 *
 * 이 숫자를 다른 파일에 하드코딩하지 마라. 랜딩의 요금제 표와 서버 쿼터
 * 검사가 어긋나면 사용자가 결제하고도 막힌다.
 */
import type { Tier } from "./domain";

/** confidence가 이 값 미만이면 classification을 'review'로 둔다. */
export const CONFIDENCE_THRESHOLD = 0.7;

/** 업로드 상한 행 수. 클라이언트·서버 양쪽에서 검사한다. */
export const MAX_ROWS = 10_000;

/** 익명 표본 분류 건수(금액 상위순). */
export const SAMPLE_SIZE = 20;

export const QUOTA: Record<
  Tier,
  { classifyPerMonth: number; chatPerMonth: number }
> = {
  free: { classifyPerMonth: 1, chatPerMonth: 0 },
  pro: { classifyPerMonth: 10, chatPerMonth: 100 },
};
