# Step 16: chat-api

## 읽어야 할 파일

- `/CLAUDE.md` — 제품 경계, 비용 규칙
- `/docs/ARCHITECTURE.md` — API 계약, 파이프라인 3단계
- `/docs/ADR.md` — ADR-010(세무조언 금지), ADR-013(쿼터·캐싱)
- `/docs/PRD.md` — 핵심 기능 5번, 요금제
- `/src/types/api.ts`, `/src/types/tier.ts` (step1 — `ChatRequest/Response`, `QUOTA`)
- `/src/lib/quota.ts` (step9 — `checkQuota`, `consumeQuota`)
- `/src/services/anthropic/chat.ts`, `/src/services/anthropic/prompt.ts` (step10 — `askAboutLedger`, `buildPromptBlocks`)
- `/src/app/api/analyses/[id]/classify/route.ts` (step11 — 관문 순서와 응답 관례를 그대로 맞춰라)

## 작업

`src/app/api/analyses/[id]/chat/route.ts`에 `POST`를 구현하고, 대시보드에 질의 UI를 붙인다. **Pro 전용 기능이다.**

**TDD 가드 주의**: `route.ts`는 테스트 선행 대상이다. `route.test.ts`를 **먼저** 작성하라.

### 처리 순서

```
1. requireUser()                    — 미인증이면 401
2. 소유 확인                          — analyses.owner_id === uid, 아니면 404
3. checkQuota(uid, 'chat')
   ├ reason 'tier_required'   → { ok:false, reason:'tier_required' }   (free 티어)
   └ reason 'quota_exceeded'  → { ok:false, reason:'quota_exceeded' }  (Pro 소진)
4. 질문 검증                          — 빈 문자열 거부, 길이 상한
5. 거래 조회 → askAboutLedger(rows, question)
6. 성공 시에만 consumeQuota(uid, 'chat')
7. { ok:true, answer, quotaLeft }
```

`tier_required`와 `quota_exceeded`를 **구분해서 반환한다.** UI가 "Pro 기능입니다"와 "이번 달 100건을 다 쓰셨습니다"를 다르게 안내해야 한다.

### 캐시 프리픽스

`askAboutLedger`는 step10의 `buildPromptBlocks`로 **step11과 동일한 프리픽스**를 만든다. 여기서 거래내역을 다르게 정렬하거나 다르게 포맷하면 캐시가 미스되어 질문마다 전체 내역이 재과금된다.

거래 조회 시 **정렬을 고정하라**(`occurred_on`, `id` 순). DB가 반환 순서를 보장하지 않으므로, 명시하지 않으면 호출마다 프리픽스가 달라질 수 있다.

### 답변 경계

시스템 프롬프트는 step10에 있다. 이 라우트는 **응답을 그대로 반환할 뿐 가공하지 않는다.**

단, 응답에 세무 판단이 섞여 나올 수 있으므로 UI에 세무 고지를 함께 노출한다(step15의 문구 재사용).

### 대시보드 UI (`src/components/dashboard/ChatPanel.tsx`)

`'use client'`. 분석 상세 하단에 배치한다.

- free 티어면 **패널 자체를 렌더하지 않고** Pro 안내를 보여준다. `getEffectiveTier()`로 서버에서 판정한다
- 입력창 + 답변 목록. 대화 이력은 **저장하지 않는다**(MVP 범위 밖). 페이지를 벗어나면 사라진다는 것을 문구로 알린다
- 남은 횟수는 서버 응답의 `quotaLeft`만 쓴다

### 테스트

Supabase·Anthropic·`quota`를 모킹한다.

- 미인증 → 401
- 남의 `analysisId` → 404
- free 티어 → `tier_required`, **Anthropic 호출 없음**
- Pro + 쿼터 소진 → `quota_exceeded`, Anthropic 호출 없음
- 빈 질문 → 400
- 성공 → `consumeQuota` 1회 호출
- Anthropic 실패 → `consumeQuota` **호출 안 됨**
- 같은 분석에 두 번 질의 → `buildPromptBlocks`에 전달된 거래 배열이 동일한 순서인지

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
npx vitest run src/app/api/analyses
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 아키텍처 체크리스트:
   - `checkQuota`가 `askAboutLedger`보다 앞에 있는가?
   - `consumeQuota`가 성공 경로에만 있는가?
   - `tier_required`와 `quota_exceeded`를 구분해 반환하는가?
   - 거래 조회 쿼리에 `order by`가 명시되어 있는가?
   - `buildPromptBlocks`를 재사용하는가? (프리픽스를 새로 만들지 않는가)
   - 게이팅 실패 응답에 `answer`가 없는가?
3. 결과에 따라 `phases/0-mvp/index.json`의 step 16을 업데이트한다:
   - 성공 → `"status": "completed"`, `"summary"`에 엔드포인트·게이팅 구분·캐시 프리픽스 재사용 방식을 한 줄로
   - 실패 → `"status": "error"` + `"error_message"`
   - 사용자 개입 필요 → `"status": "blocked"` + `"blocked_reason"` 후 중단

## 금지사항

- 쿼터 검사 전에 Anthropic을 호출하지 마라. 이유: Q&A는 질문마다 비용이 발생하며, 관문 없는 경로는 마진을 직접 깎는다.
- 호출 실패 시 쿼터를 차감하지 마라. 이유: 사용자가 답을 못 받고 횟수만 잃는다.
- 프리픽스를 새로 구성하지 마라. `buildPromptBlocks`를 재사용한다. 이유: 프리픽스가 달라지면 캐시 미스로 입력비가 약 10배가 된다.
- 거래 조회에 `order by`를 빼지 마라. 이유: 반환 순서가 흔들리면 프리픽스가 매번 달라져 캐시가 무효화된다.
- `tier_required`와 `quota_exceeded`를 하나로 합치지 마라. 이유: "결제하세요"와 "다음 달에 오세요"는 완전히 다른 안내다.
- free 티어에 패널을 렌더하고 CSS로 가리지 마라. 이유: 개발자도구로 걷힌다. 서버에서 판정해 렌더하지 않는다.
- 대화 이력을 DB에 저장하지 마라. 이유: MVP 범위 밖이며, 테이블·RLS·삭제 정책이 함께 따라온다.
- 세무 조언을 유도하는 프롬프트를 덧붙이지 마라. 이유: 제품 경계다. 시스템 프롬프트는 step10이 단일 출처다.
- 게이팅 실패 응답에 `answer`를 담지 마라. 이유: 서버가 값을 보내지 않는 것이 유일한 게이팅 수단이다.
- 기존 테스트를 깨뜨리지 마라.
