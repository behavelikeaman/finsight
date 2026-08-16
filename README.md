# FinSight

카드 명세서(CSV/엑셀)를 올리면 AI가 거래별로 **사업경비 / 개인지출**을 갈라주는,
한국 프리랜서·1인 사업자용 SaaS.

- 기획: [`docs/PRD.md`](docs/PRD.md)
- 구조: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
- 결정 배경: [`docs/ADR.md`](docs/ADR.md)
- 디자인: [`docs/DESIGN.md`](docs/DESIGN.md)
- 배포 절차: [`DEPLOY.md`](DEPLOY.md)

---

## 제품 경계 — 먼저 읽을 것

**FinSight는 세무 조언을 제공하지 않는다.**
거래 분류와 계정과목 매핑까지만 한다. "경비 처리 가능/불가", "한도 초과" 같은
세법 판단은 생성하지도, 표시하지도 않는다. 분류 결과는 **참고용**이며 최종 판단은
세무 대리인과 상의해야 한다. 이 고지는 분류 결과가 보이는 모든 화면에 상시 노출된다.

분류에는 항상 **확신도**가 함께 산출된다. 확신도가 낮은 건은 "확인 필요"로 분리되어
표 상단에 모인다. 확신도 없이 단정하는 화면은 만들지 않는다.

### 데이터 취급

- **원본 파일은 서버로 전송되지 않는다.** 브라우저가 파싱한 정규화 거래 배열(날짜·가맹점·금액)만 JSON으로 보낸다.
- 카드번호는 어떤 컬럼에도 저장하지 않는다.
- 외부 API(Anthropic)로 나가는 데이터는 예외 없이 `src/lib/redact.ts`를 거쳐 주민번호·전화번호·카드번호·계좌번호·성명이 제거된다.
- 거래내역(가맹점·금액·일시) 자체는 분류를 위해 국외(Anthropic)로 전송된다. 이 사실은 업로드 화면에 명시한다.

---

## 로컬 실행

요구사항: Node.js 20 이상.

```bash
npm install
cp .env.example .env.local   # 값을 채운다. 발급 절차는 DEPLOY.md 참조
npm run dev                  # http://localhost:3000
```

`.env.local`을 채우지 않아도 `npm run build`·`npm run test`는 통과한다 —
환경변수는 모듈 로드 시점이 아니라 **호출 시점**에 읽기 때문이다(`src/lib/env.ts`).
다만 업로드·분류·결제 플로우를 실제로 돌리려면 `DEPLOY.md`의 1~6번을 먼저 마쳐야 한다.

## 명령어

| 명령어 | 설명 |
|---|---|
| `npm run dev` | 개발 서버 |
| `npm run build` | 프로덕션 빌드 |
| `npm run lint` | ESLint (flat config. `next lint`는 없다) |
| `npm run test` | Vitest (node 환경 단일) |

## 기술 스택

Next.js 16 (App Router) / React 19 · TypeScript strict + `noUncheckedIndexedAccess` ·
Tailwind CSS v4 (CSS-first `@theme`) · Supabase (Auth + Postgres + RLS) ·
Polar (구독 결제, Merchant of Record) · Anthropic Claude (`claude-opus-5`) ·
ExcelJS · Recharts · Vitest

## 구조

```
src/
├── app/
│   ├── (marketing)/   랜딩 — 비로그인 접근
│   ├── (app)/         대시보드 — 로그인 필수
│   └── api/           라우트 핸들러 (변경·외부호출 전용)
├── components/        UI 컴포넌트
├── types/             도메인 타입 + API 계약
├── lib/
│   ├── ingest/        인코딩 감지, CSV·ExcelJS → RawTable
│   ├── mapping/       헤더 휴리스틱, 값 정규화, 매핑 검증
│   ├── analysis/      집계, fingerprint, 중복판정, 확신도 버킷
│   ├── rules.ts       user_rules 선적용 (AI 호출 전 관문)
│   ├── quota.ts       티어별 사용량 검사 (AI 호출 전 관문)
│   ├── redact.ts      외부 전송 전 민감정보 제거 (단일 관문)
│   ├── supabase/      browser · server · admin(구독 갱신 전용) + auth · session
│   └── env.ts         호출 시점 환경변수 접근자
├── services/          anthropic · polar
└── middleware.ts      세션 갱신
supabase/migrations/   스키마 · RLS · security definer 함수
```

파이프라인은 3단계로 나뉜다 — **집계**(`/api/analyze`, LLM 없음) →
**분류**(`/api/analyses/:id/classify`) → **Q&A**(`/api/analyses/:id/chat`, Pro).
금액 집계는 전부 코드가 한다. LLM은 거래별 분류 판단만 한다.

## 요금제

| | Free | Pro |
|---|---|---|
| 업로드·집계 프리뷰 | 무제한 | 무제한 |
| 전건 경비 분류 | 월 1회 | 월 10회 |
| 대화형 Q&A | — | 월 100건 |
| 사용자 규칙 학습 | O | O |
| CSV 내보내기 · 인쇄 | — | O |

숫자의 단일 출처는 `src/types/tier.ts`의 `QUOTA`다. 다른 파일에 복제하지 마라.

## 개발 규칙

- **TDD.** 새 기능은 테스트를 먼저 쓴다. TDD 가드 훅이 테스트 없는 구현 파일 작성을 차단한다 (`app/api/**/route.ts`·`src/middleware.ts` 포함, `types/`·`components/`·`page.tsx` 면제).
- Stop 훅이 세션 종료 시 `npm run lint && npm run build && npm run test`를 실행한다. 셋 다 통과해야 한다.
- 커밋 메시지는 conventional commits (`feat:`, `fix:`, `docs:`, `refactor:`).
- 그 밖의 규칙은 [`CLAUDE.md`](CLAUDE.md)에 있다.
