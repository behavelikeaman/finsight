# Step 13: deploy-config

## 읽어야 할 파일

- `/CLAUDE.md`
- `/docs/PRD.md`, `/docs/ARCHITECTURE.md`
- `/.env.example`
- `/supabase/migrations/` (step5 산출물 — 적용해야 할 파일 목록)
- `/phases/0-mvp/index.json` — 앞선 step들의 summary

## 작업

배포 설정 파일과 인수인계 문서를 만든 뒤, **이 step은 `blocked`로 종료한다.**

이것은 실패가 아니라 설계된 종료다. 여기서부터는 외부 서비스 계정과 키가 필요해 자동화할 수 없다.

### 1. `vercel.json`

빌드 커맨드와 리전 정도만 담는다. 과하게 설정하지 마라.

### 2. `README.md`

프로젝트 개요, 로컬 실행 방법(`npm install` → `.env.local` 준비 → `npm run dev`), 스크립트 설명. 이미 있으면 갱신한다.

### 3. `docs/DEPLOY.md`

아래 체크리스트를 **순서대로 수행 가능한 형태**로 쓴다. 각 항목에 어디서 무엇을 얻어 어느 환경변수에 넣는지 명시한다.

```
1. Supabase 프로젝트 생성
   - Project Settings > API 에서 URL, anon key, service_role key 확보
   - → NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY

2. Supabase 인증 설정  ← 이 셋을 켜지 않으면 전체 플로우가 죽는다
   - Authentication > Anonymous Sign-Ins  활성화
   - Authentication > Manual Linking      활성화
   - Authentication > Providers > Google  활성화

3. Google OAuth 클라이언트 발급
   - Google Cloud Console > OAuth 2.0 클라이언트 ID 생성
   - 승인된 리디렉션 URI: <SUPABASE_URL>/auth/v1/callback
   - client id/secret을 Supabase Google provider에 등록

4. 마이그레이션 적용
   - supabase/migrations/0001~0004 를 순서대로 적용
   - 적용 후 4개 테이블에 RLS가 켜졌는지 확인

5. Anthropic 키 발급 → ANTHROPIC_API_KEY

6. Polar 설정
   - Pro 상품 생성 → POLAR_PRO_PRODUCT_ID
   - Organization Access Token → POLAR_ACCESS_TOKEN
   - 웹훅 엔드포인트 등록: <SITE_URL>/api/webhooks/polar
   - 웹훅 시크릿 → POLAR_WEBHOOK_SECRET
   - 개발 중에는 POLAR_SERVER=sandbox

7. Vercel
   - 저장소 연결
   - 위 환경변수 전부 등록 (NEXT_PUBLIC_SITE_URL은 실제 도메인)
   - 배포

8. 배포 후 확인 — 아래 종단 검증 14항목 수행
```

### 4. 종단 검증 체크리스트

아래 14항목을 `docs/DEPLOY.md`에 그대로 담는다. **★ 표시는 화면이 아니라 네트워크 탭·DB로 직접 확인해야 하는 항목**이다 — 눈으로만 보면 통과한 것처럼 보이지만 실제로는 뚫려 있을 수 있다.

1. EUC-KR + 상단 안내문 + 하단 합계 행이 있는 CSV 업로드 → 한글이 깨지지 않고 **총액이 2배가 아닌지**
2. 같은 내용의 .xlsx 업로드 → 동일한 결과
3. 컬럼 매핑을 일부러 틀리게 바꾸면 경고가 뜨는지
4. ★ 네트워크 탭: `/api/analyze` 요청 본문이 **JSON 배열이고 원본 파일이 아닌지**
5. ★ 네트워크 탭: 프리뷰 응답에 **AI 인사이트 본문이 없는지**
6. Google 계정 연결 후 분석이 그대로 내 것인지 (uid 유지). 연결 도중 취소해도 결과가 남는지
7. 로그아웃 후 랜딩 [로그인]으로 재진입 → 히스토리가 그대로 보이는지
8. ★ 랜딩만 방문하고 이탈 → Supabase `auth.users`에 행이 **생기지 않는지**
9. 명세서가 1개일 때 "다음 달 비교" 안내가 뜨는지
10. 같은 파일 재업로드 → "취소 / 기존 결과 보기". 기존이 잠긴 기간이면 "Pro에서 열람"으로 문구가 바뀌는지
11. ★ 2개월치 업로드 후 Free 상태에서 잠긴 기간 응답에 **금액이 없는지**
12. Polar 테스트 결제 → **웹훅 도착 전** 리다이렉트 시점에 잠금이 풀리는지. 이후 인사이트가 `deep`으로 생성되는지
13. ★ 내 데이터 삭제 후 public 테이블 잔여 행이 0인지. UI 문구가 **"계정 삭제"가 아닌지**
14. 대시보드 인쇄 미리보기에서 차트가 잘리지 않는지

### 5. 이 step을 blocked로 종료

`phases/0-mvp/index.json`의 step 13을 다음과 같이 기록한다.

```json
{
  "step": 13,
  "name": "deploy-config",
  "status": "blocked",
  "blocked_reason": "외부 서비스 설정과 키 발급이 필요합니다. docs/DEPLOY.md의 1~8단계를 수행한 뒤 .env.local을 채우고, phases/0-mvp/index.json에서 이 step의 status를 pending으로 되돌린 뒤 재실행하세요. 특히 Supabase의 Anonymous Sign-Ins와 Manual Linking을 켜지 않으면 업로드·계정 연결 플로우 전체가 동작하지 않습니다."
}
```

`blocked_reason`은 사용자가 그것만 읽고 다음 행동을 할 수 있어야 한다. "설정이 필요함" 같은 모호한 문장을 쓰지 마라.

## Acceptance Criteria

```bash
npm run lint
npm run build
npm run test
test -f vercel.json && test -f docs/DEPLOY.md && echo "배포 문서 OK"
```

## 검증 절차

1. 위 AC 커맨드를 실행한다.
2. 문서 체크리스트:
   - `docs/DEPLOY.md`의 각 항목이 `.env.example`의 환경변수와 1:1로 대응하는가?
   - Supabase Anonymous Sign-Ins와 Manual Linking 활성화가 명시돼 있는가?
   - 종단 검증 항목이 포함돼 있는가?
3. `phases/0-mvp/index.json`의 step 13을 위 형식대로 **`blocked`** 로 기록하고 즉시 종료한다.

## 금지사항

- 실제 배포를 시도하지 마라. 이유: 자격 증명이 없고, 배포는 사용자의 결정이다.
- Supabase·Polar·Google에 실제로 접속하거나 리소스를 만들지 마라. 이유: 계정과 키가 없다.
- `.env.local`을 만들지 마라. 이유: 실제 키를 담는 파일이며 사용자가 직접 채운다.
- `.env.example`을 덮어쓰지 마라. 이유: 이미 검증된 목록이다. 항목이 빠졌으면 추가만 한다.
- 이 step을 `completed`로 기록하지 마라. 이유: 외부 설정이 남아 있으며, `blocked`가 이 step의 정상 종료 상태다.
- 앞선 step의 코드를 수정하지 마라. 이유: 이 step은 설정과 문서만 다룬다.
- 기존 테스트를 깨뜨리지 마라.
