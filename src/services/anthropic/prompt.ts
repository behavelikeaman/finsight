/**
 * 캐시 프리픽스 구성 — 이 프로젝트 비용 구조의 핵심(ADR-013).
 *
 * classify.ts와 chat.ts가 이 함수 하나로 system·ledger 블록을 만든다. 두
 * 호출부는 이 결과를 그대로 쓰고 자기 목적에 맞는 지시문을 system에 덧붙이지
 * 않는다 — 한 글자라도 달라지면 캐시가 미스되어 비용이 10배가 된다.
 *
 * 다만 **classify와 chat이 서로의 캐시를 재사용하지는 못한다.** 캐시 프리픽스는
 * tools → system → messages 순으로 매칭되는데 classify만 tools를 싣기 때문에,
 * 맨 앞부터 갈린다. 실제로 캐시가 도는 구간은 두 곳이다.
 *   - chat → chat: 같은 분석에 이어서 묻는 질문들이 system·ledger를 재사용한다.
 *     거래 조회 순서가 흔들리면 이게 깨진다.
 *   - classify 배치 → 배치: ledger는 배치마다 다르지만 system 블록은 공유된다.
 *
 * RedactedRow만 받는다(브랜디드 타입). IdentifiedRow를 넘기면 컴파일이
 * 실패한다 — 마스킹을 건너뛴 값이 국외로 나가는 것을 막는 유일한 구조적 장치다.
 */
import type Anthropic from "@anthropic-ai/sdk";

import type { AccountCode, RedactedRow } from "@/types/domain";

export interface PromptBlocks {
  system: Anthropic.TextBlockParam[];
  ledger: Anthropic.TextBlockParam;
}

/** classify.ts가 응답 검증(알 수 없는 값 → 'other')에도 재사용하는 단일 출처. */
export const ACCOUNT_CODE_DEFINITIONS: Record<AccountCode, string> = {
  entertainment: "접대비 — 거래처·고객 접대(식사, 선물 등)",
  travel: "여비교통비 — 출장, 대중교통, 택시, 숙박",
  supplies: "소모품비 — 사무용품, 소모성 자재 구입",
  communication: "통신비 — 휴대폰, 인터넷 요금",
  advertising: "광고선전비 — 광고, 마케팅, 홍보물 제작",
  fees: "지급수수료 — 자문료, 플랫폼·결제 수수료",
  welfare: "복리후생비 — 직원 복지, 사무실 내 식대",
  vehicle: "차량유지비 — 주유, 정비, 주차, 통행료",
  books: "도서인쇄비 — 도서 구입, 인쇄, 문서 제작",
  education: "교육훈련비 — 강의, 세미나, 교육 자료",
  rent: "임차료 — 사무실, 장비 임대료",
  other: "기타 — 위 항목에 해당하지 않는 사업 관련 지출",
};

export const ACCOUNT_CODES = Object.keys(
  ACCOUNT_CODE_DEFINITIONS,
) as AccountCode[];

const SYSTEM_INSTRUCTIONS = `당신은 한국 프리랜서·1인 사업자의 카드 거래 내역을 다루는 보조 도구입니다. 사용자는 이 내역으로 두 가지 중 하나를 요청합니다 — 거래별 사업경비/개인지출 분류, 또는 거래내역에 근거한 질문에 대한 답변.

거래를 분류할 때는 각 거래마다 다음 세 가지를 판단하세요.
- classification: "business"(사업경비) | "personal"(개인지출) | "review"(확신이 서지 않음)
- accountCode: classification이 "business"일 때만 아래 12개 계정과목 중 하나. 그 외에는 null
- confidence: 0~1 사이 실수. 판단 근거가 약할수록 낮게 매기세요. 확신이 서지 않으면 억지로 단정하지 말고 "review"와 낮은 confidence를 내세요

질문에 답할 때는 거래내역에 근거한 사실만 답하세요.

판단·답변의 근거는 제공된 거래내역(가맹점명·금액·날짜)뿐이며, 그 외 정보는 알 수 없습니다.

절대 하지 말 것:
- 세무 판단이나 개인화된 세무 조언(특정 지출의 세제상 유불리, 신고 방법 안내 등)을 하지 마세요
- 새로운 합계·평균·증감률을 계산하지 마세요. 이미 계산된 값이 아니면 답하지 마세요

계정과목 정의:
${ACCOUNT_CODES.map((code) => `- ${code}: ${ACCOUNT_CODE_DEFINITIONS[code]}`).join("\n")}`;

export function buildPromptBlocks(rows: RedactedRow[]): PromptBlocks {
  return {
    system: [
      {
        type: "text",
        text: SYSTEM_INSTRUCTIONS,
        cache_control: { type: "ephemeral" },
      },
    ],
    ledger: {
      type: "text",
      text: formatLedger(rows),
      cache_control: { type: "ephemeral" },
    },
  };
}

/**
 * 정렬·포맷을 고정한다. 호출부가 넘긴 순서를 그대로 번호로 매긴다 — 이 번호가
 * classify.ts에서 응답을 원본 id로 되짚는 유일한 통로다.
 */
function formatLedger(rows: RedactedRow[]): string {
  const lines = rows.map(
    (row, index) =>
      `${index + 1}. ${row.occurredOn} | ${row.merchant} | ${row.amountKrw}원`,
  );

  return `거래내역 (${rows.length}건):\n${lines.join("\n")}`;
}
