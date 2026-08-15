import { UploadFlow } from "@/components/upload/UploadFlow";
import { QUOTA, SAMPLE_SIZE } from "@/types/tier";

const FEATURES = [
  {
    title: "자동 컬럼 매핑",
    body: "카드사마다 다른 헤더를 휴리스틱으로 추측합니다. 틀리면 드롭다운으로 바로 고칩니다.",
  },
  {
    title: "거래별 경비 분류",
    body: "가맹점·금액·날짜를 근거로 사업경비와 개인지출을 나누고, 확신도가 낮은 건은 상단에 모아 보여줍니다.",
  },
  {
    title: "수정할수록 정확해지는 규칙",
    body: "고친 분류를 규칙으로 저장해 다음 달부터는 AI 호출 없이 바로 분류합니다.",
  },
];

export default function LandingPage() {
  return (
    <main className="mx-auto flex max-w-[1200px] flex-col gap-16 px-6 py-16 sm:py-24">
      <section className="flex flex-col items-center gap-6 text-center">
        <span className="rounded-full bg-surface-strong px-4 py-1.5 text-xs font-medium tracking-wide text-ink uppercase">
          프리랜서·1인 사업자용
        </span>
        <h1 className="max-w-2xl text-3xl font-normal text-ink sm:text-4xl">
          신고철마다 카드 명세서를 열어 사업경비를 손으로 골라내셨나요
        </h1>
        <p className="max-w-xl text-base text-body">
          카드 명세서를 올리면 AI가 거래별로 사업경비와 개인지출을 갈라드립니다.
          로그인 없이 먼저 결과부터 확인해 보세요.
        </p>
      </section>

      <section className="flex flex-col gap-4">
        <UploadFlow />
        <div className="flex flex-col gap-1 text-xs text-muted">
          <p>원본 파일은 서버로 전송되지 않습니다. 브라우저에서 처리한 거래내역만 전송됩니다.</p>
          <p>거래내역(가맹점·금액·날짜)은 분류 분석을 위해 국외(Anthropic)로 전송됩니다.</p>
          <p>카드번호는 어떤 경우에도 저장하지 않습니다.</p>
        </div>
      </section>

      <section className="grid grid-cols-1 gap-6 sm:grid-cols-3">
        {FEATURES.map((feature) => (
          <div
            key={feature.title}
            className="rounded-2xl border border-hairline bg-canvas p-6"
          >
            <h2 className="mb-2 text-lg font-normal text-ink">{feature.title}</h2>
            <p className="text-sm leading-relaxed text-body">{feature.body}</p>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-center text-2xl font-normal text-ink">요금제</h2>
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
          <PricingCard
            name="Free"
            price="0원"
            items={[
              "업로드·집계 프리뷰 무제한",
              `전건 경비 분류 월 ${QUOTA.free.classifyPerMonth}회`,
              "대화형 Q&A 이용 불가",
              "사용자 규칙 학습",
              `익명 미리보기 상위 ${SAMPLE_SIZE}건 분류`,
            ]}
          />
          <PricingCard
            name="Pro"
            price="월 구독"
            items={[
              "업로드·집계 프리뷰 무제한",
              `전건 경비 분류 월 ${QUOTA.pro.classifyPerMonth}회`,
              `대화형 Q&A 월 ${QUOTA.pro.chatPerMonth}건`,
              "사용자 규칙 학습",
              "CSV 내보내기 · 인쇄",
            ]}
          />
        </div>
      </section>

      <p className="rounded-md bg-surface-soft px-4 py-3 text-center text-xs text-muted">
        분류 결과는 참고용이며, 최종 판단은 세무 대리인과 상의하세요.
      </p>
    </main>
  );
}

function PricingCard({
  name,
  price,
  items,
}: {
  name: string;
  price: string;
  items: string[];
}) {
  return (
    <div className="rounded-2xl border border-hairline bg-canvas p-6">
      <h3 className="text-lg font-normal text-ink">{name}</h3>
      <p className="mt-1 font-mono text-2xl font-medium text-ink">{price}</p>
      <ul className="mt-4 flex flex-col gap-2 text-sm text-body">
        {items.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>
    </div>
  );
}
