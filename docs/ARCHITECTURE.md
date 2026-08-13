# 아키텍처

## 디렉토리 구조
```
src/
├── app/
│   ├── (marketing)/       # 랜딩, 가격 안내
│   ├── (app)/dashboard/   # 로그인 후 화면
│   ├── try/               # 로그인 없는 1회 체험
│   └── api/               # 라우트 핸들러 (외부 API 호출은 전부 여기)
│       ├── parse/         # CSV → 정규화 거래 배열
│       ├── classify/      # 거래 분류
│       ├── chat/          # 대화형 Q&A (유료)
│       └── webhooks/polar/
├── components/            # UI 컴포넌트
├── types/                 # TypeScript 타입 정의
├── lib/                   # 유틸리티 + 헬퍼
│   ├── csv/               # 인코딩 감지, 파싱, 컬럼 매핑 적용
│   ├── redact.ts          # 외부 전송 전 민감정보 제거
│   ├── rules.ts           # 사용자 규칙 선적용
│   └── quota.ts           # 티어별 사용량 검사
└── services/              # 외부 API 래퍼 (anthropic, supabase, polar)
```

## 패턴
- Server Components 기본. 인터랙션이 필요한 곳(업로드 위젯, 분류 수정 표, 채팅)만 Client Component.
- 외부 API 호출은 예외 없이 `app/api/` 라우트 핸들러 경유. Anthropic 키가 클라이언트 번들에 들어갈 경로를 원천 차단하기 위함.
- `services/`는 얇은 래퍼만 담당한다. 도메인 로직은 `lib/`에 두고 순수 함수로 유지해 테스트 가능하게 만든다.

## 데이터 흐름

### 업로드 → 분류
```
CSV 파일
  → [클라이언트] 파일 선택
  → POST /api/parse
      → 인코딩 감지 (UTF-8 실패 시 CP949 폴백)
      → 카드사 지문 계산 (헤더 행 해시)
      → 저장된 컬럼 매핑 조회
          ├─ 있음: 결정론적 파싱 (AI 호출 0)
          └─ 없음: 상위 20행만 Anthropic으로 → 매핑 JSON 추론 → DB 저장
      → 정규화 거래 배열 반환
  → POST /api/classify
      → 쿼터 검사 (lib/quota)
      → 사용자 규칙 선적용 (lib/rules) — 매칭된 거래는 AI 제외
      → 나머지 거래만 redact() 통과 후 Anthropic 호출
         (거래내역은 캐시 프리픽스에 배치)
      → 거래별 {분류, 계정과목, 확신도} 반환
  → [클라이언트] 수정 가능한 표로 렌더
  → 사용자 수정 → user_rules에 저장
```

### 저장 정책
```
원본 CSV      → Supabase Storage, 30일 후 자동 삭제
정규화 거래   → Postgres, 컬럼 암호화, 구독 해지 +30일까지 보존
컬럼 매핑     → Postgres, 카드사 지문 기준 전역 공유 (개인정보 없음)
사용자 규칙   → Postgres, 사용자별
```

## 상태 관리
- 서버 상태(거래, 분류 결과, 구독 상태)는 Server Components에서 직접 조회.
- 클라이언트 상태(표 수정 중인 값, 업로드 진행률)는 `useState`/`useReducer`. 전역 상태 라이브러리는 도입하지 않는다.
- 낙관적 업데이트는 분류 수정에만 적용한다.
