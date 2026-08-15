/**
 * 계정과목 한글 라벨. src/types/domain.ts의 AccountCode 12종과 일치해야 한다.
 * 이 목록을 늘리지 마라 — 프롬프트·UI·DB 제약이 함께 묶여 있다.
 */
import type { AccountCode } from "@/types/domain";

export const ACCOUNT_CODE_LABEL: Record<AccountCode, string> = {
  entertainment: "접대비",
  travel: "여비교통비",
  supplies: "소모품비",
  communication: "통신비",
  advertising: "광고선전비",
  fees: "지급수수료",
  welfare: "복리후생비",
  vehicle: "차량유지비",
  books: "도서인쇄비",
  education: "교육훈련비",
  rent: "임차료",
  other: "기타",
};

export const ACCOUNT_CODES = Object.keys(ACCOUNT_CODE_LABEL) as AccountCode[];
