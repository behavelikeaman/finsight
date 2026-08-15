/**
 * 외부 API로 나가는 데이터의 단일 관문 (ADR-009).
 *
 * 컬럼 매핑이 카드번호 컬럼을 후보에서 제외하므로 정상 경로로는 카드번호가
 * 여기까지 오지 않는다. 그럼에도 이 관문이 필요한 이유는 **가맹점명 필드 자체에**
 * 민감정보가 섞여 오기 때문이다 — '홍길동님 계좌이체', '국민 123-45-678901 이체'
 * 같은 적요가 가맹점명 자리에 들어온다. 중복 방어가 아니라 다른 종류의 방어다.
 *
 * 삭제가 아니라 고정 토큰으로 치환한다. 그냥 지우면 '이체'만 남아 문맥이 사라지고
 * 분류 품질이 떨어진다. '[NAME] 이체'는 "개인 간 송금"이라는 판단 근거가 된다.
 *
 * 이 파일이 RedactedRow를 만드는 유일한 곳이다. 캐스팅을 다른 파일로 복제하지 마라 —
 * 복제하는 순간 마스킹을 건너뛴 값이 외부로 나가는 경로가 열린다.
 */
import type { IdentifiedRow, RedactedRow } from "@/types/domain";

export interface RedactionResult<T> {
  data: T;
  /** 제거된 민감정보 개수. 로깅·감사용 */
  removedCount: number;
}

interface Rule {
  regex: RegExp;
  token: string;
  /** 정상 값을 오인해 잡았을 때 되돌리는 예외 판정 */
  spare?: (match: string) => boolean;
}

/** 'YYYY-MM-DD'. 하이픈 포함 8자리라 계좌번호 규칙에 걸린다. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * 순서가 의미를 가진다. 좁은 패턴(주민번호·전화번호·카드번호)을 먼저 소진시켜야
 * 넓은 계좌번호 규칙이 그것들을 삼키지 않는다.
 *
 * 숫자 규칙은 자릿수와 구분자 형태를 함께 본다. '4자리 이상 숫자열'로 넓게 잡으면
 * 이마트24·GS25·배스킨라빈스31 같은 정상 상호가 깨지고, 그건 분류 품질을 직접 깎는다.
 */
const RULES: Rule[] = [
  // 901010-1234567
  { regex: /(?<!\d)\d{6}[-\s][1-4]\d{6}(?!\d)/g, token: "[RRN]" },
  // 010-1234-5678
  { regex: /(?<!\d)01[016789][-\s]?\d{3,4}[-\s]?\d{4}(?!\d)/g, token: "[PHONE]" },
  // 1234-5678-9012-3456 · 1234 5678 9012 3456 · 1234********3456 · 1234567890123456
  {
    regex: /(?<![\d*])[\d*]{4}[-\s]?[\d*]{4}[-\s]?[\d*]{4}[-\s]?[\d*]{4}(?![\d*])/g,
    token: "[CARD]",
  },
  // 13~15자리 연속 숫자
  { regex: /(?<!\d)\d{13,15}(?!\d)/g, token: "[CARD]" },
  // 123-45-678901 · 110-234-567890 — 하이픈 포함 숫자 8자리 이상
  {
    regex: /(?<![\d-])\d{2,6}-\d{2,6}(?:-\d{2,6})?(?![\d-])/g,
    token: "[ACCT]",
    spare: (match) =>
      ISO_DATE.test(match) || match.replace(/\D/g, "").length < 8,
  },
  // 홍길동님 · 홍길동 님
  { regex: /[가-힣]{2,4}\s?님/g, token: "[NAME]" },
];

export function redactMerchant(raw: string): string {
  return redact(raw).value;
}

export function redactRows(
  rows: IdentifiedRow[],
): RedactionResult<RedactedRow[]> {
  let removedCount = 0;

  // 입력을 변형하지 않는다. 호출부가 원본을 화면에 그대로 쓰고 있어, 변형하면
  // 사용자 화면의 가맹점명이 [NAME]으로 바뀐다.
  const data = rows.map((row) => {
    const { value, count } = redact(row.merchant);
    removedCount += count;

    // occurredOn·amountKrw는 건드리지 않는다. 분류에 필수이고 민감정보가 아니다.
    // id도 그대로 둔다 — 호출부가 이 id로 분류 결과를 되짚는다.
    return {
      id: row.id,
      occurredOn: row.occurredOn,
      merchant: value,
      amountKrw: row.amountKrw,
    } as RedactedRow;
  });

  return { data, removedCount };
}

function redact(raw: string): { value: string; count: number } {
  let value = raw;
  let count = 0;

  for (const rule of RULES) {
    value = value.replace(rule.regex, (match) => {
      if (rule.spare?.(match) === true) return match;
      count += 1;
      return rule.token;
    });
  }

  return { value, count };
}
