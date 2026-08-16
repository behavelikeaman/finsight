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

/**
 * Pro 구독 가격.
 *
 * **Polar 상품에 설정된 금액과 반드시 일치해야 한다.** 어긋나면 랜딩에서 본
 * 금액과 결제 화면 금액이 달라 결제 직전에 이탈한다. 상품 가격을 바꿀 때는
 * 이 값도 같이 바꿔라.
 *
 * 통화가 USD인 것은 Polar가 카드 결제만 처리하기 때문이다(ADR-005). 원화로
 * 적으면 환율에 따라 실제 청구액과 어긋난다.
 */
export const PRO_PRICE = {
  amount: 19.99,
  currency: "USD",
  /** 화면 표기. 원화가 아님이 드러나야 한다. */
  display: "$19.99",
} as const;
