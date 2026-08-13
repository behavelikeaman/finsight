# 프로젝트: FinSight

카드 명세서 CSV를 업로드하면 AI가 거래를 사업경비/개인지출로 분류해주는, 한국 프리랜서·1인 사업자용 SaaS.

## 기술 스택
- Next.js 15 (App Router)
- TypeScript strict mode
- Tailwind CSS
- Supabase (Postgres + Auth + RLS)
- Anthropic SDK (`claude-opus-5`)
- Polar (구독 결제, Merchant of Record)

## 아키텍처 규칙

- CRITICAL: Anthropic API 키는 `app/api/` 라우트 핸들러에서만 사용한다. 클라이언트 컴포넌트나 `NEXT_PUBLIC_*` 환경변수로 절대 노출하지 않는다.
- CRITICAL: 거래 데이터를 Anthropic API로 보내기 전 반드시 `lib/redact.ts`를 거친다. 카드번호·계좌번호·성명은 전송 대상에서 제거한다. 마스킹을 거치지 않은 원본을 외부 API로 보내는 코드는 금지.
- CRITICAL: 세무 조언을 생성하거나 표시하지 않는다. "이 지출은 경비 처리 가능합니다" 같은 판단 문구는 프롬프트와 UI 양쪽에서 금지한다. 분류 결과에는 항상 "최종 판단은 세무 대리인과 상의" 고지를 함께 노출한다.
- CRITICAL: 업로드 원본 파일은 30일 후 자동 삭제한다. 정규화된 거래 데이터만 장기 보존한다.
- 모든 Supabase 테이블에 RLS를 적용한다. 사용자는 자기 데이터만 읽고 쓸 수 있다.
- 컴포넌트는 `components/`, 타입은 `types/`, 외부 API 래퍼는 `services/`에 분리한다.
- 기본은 Server Component. 인터랙션이 필요한 곳만 `"use client"`.

## 비용 규칙

- CRITICAL: Anthropic API 호출 시 거래내역은 프롬프트 캐시 프리픽스에 배치한다. 후속 Q&A가 매번 전체 내역을 재과금하면 유닛 이코노믹스가 무너진다.
- 사용자 규칙(`user_rules`)에 매칭되는 거래는 AI로 보내지 않고 로컬에서 분류한다.
- 모든 AI 호출은 티어별 쿼터를 확인한 뒤 실행한다. 쿼터 검사 없는 호출 경로를 만들지 않는다.

## 개발 프로세스
- CRITICAL: 새 기능 구현 시 반드시 테스트를 먼저 작성하고, 테스트가 통과하는 구현을 작성할 것 (TDD)
- 커밋 메시지는 conventional commits 형식을 따를 것 (feat:, fix:, docs:, refactor:)

## 명령어
npm run dev      # 개발 서버
npm run build    # 프로덕션 빌드
npm run lint     # ESLint
npm run test     # 테스트
