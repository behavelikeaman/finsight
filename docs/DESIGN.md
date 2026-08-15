# 디자인

토큰·컴포넌트 원본은 `docs/design-system/`에 있다. 이 문서는 그 원본을 **이 제품에 어떻게 적용하는가**를 정한다.
원본을 고칠 때는 claude.ai/design 프로젝트(`5af3ff6e-758d-4528-81c1-368056289d60`)에서 고치고 다시 내려받는다. `docs/design-system/` 안의 파일을 직접 수정하지 마라 — 다음 동기화 때 덮인다.

## 출처와 그 한계

디자인 시스템은 **기관 금융 브랜드 보이스의 크립토/트레이딩 마케팅 사이트**를 전제로 만들어졌다. Figma도 코드베이스도 없이 채팅으로 준 브랜드 브리프 하나에서 나왔다.

우리 제품은 카드 명세서 경비 분류 SaaS다. 따라서 **토큰은 거의 그대로 쓰고, 컴포넌트와 레이아웃 스케일은 골라 쓴다.** 트레이딩 도메인 컴포넌트(`AssetRow`·`PriceCell`·`AssetIcon`)와 마케팅 UI kit은 쓰지 않는다.

`docs/design-system/prototype/`의 클릭 가능한 프로토타입이 실질적인 기준선이다. 토큰은 마케팅용 스케일이지만 프로토타입은 이미 앱 내부용으로 밀도를 조인 상태이며, 그 조정값이 아래 "밀도" 절이다.

## 토큰 → Tailwind v4 `@theme`

`src/app/globals.css`에 `@theme`으로 옮긴다. `tailwind.config.js`를 만들지 않는다.

원본 CSS 변수는 2단 구조다 — 원시 팔레트(`--blue-600`)와 의미 별칭(`--color-primary`). `@theme`에는 **의미 별칭만** 올린다. 원시 팔레트를 유틸리티로 노출하면 `bg-blue-600` 같은 호출이 생겨 의미 계층이 무너진다.

| 원본 토큰 | `@theme` 이름 | 생성되는 유틸리티 |
|---|---|---|
| `--color-primary` `#0052ff` | `--color-primary` | `bg-primary` `text-primary` |
| `--color-primary-active` `#003ecc` | `--color-primary-active` | 눌림 상태 |
| `--color-canvas` `#ffffff` | `--color-canvas` | 페이지 바탕 |
| `--color-surface-soft` `#f7f7f7` | `--color-surface-soft` | 통계 카드·고지 바 |
| `--color-surface-strong` `#eef0f3` | `--color-surface-strong` | 활성 탭·보조 버튼 |
| `--color-hairline` `#dee1e6` | `--color-hairline` | 카드 테두리·표 헤더 구분선 |
| `--color-hairline-soft` `#eef0f3` | `--color-hairline-soft` | 표 행 구분선 |
| `--color-ink` `#0a0b0d` | `--color-ink` | 본문 강조·제목 |
| `--color-body` `#5b616e` | `--color-body` | 본문 |
| `--color-muted` `#7c828a` | `--color-muted` **`#686e76`** | 보조 설명 — 접근성 때문에 값을 바꿨다(아래) |
| `--color-muted-soft` `#a8acb3` | `--color-muted-soft` **`#8b9199`** | 비텍스트 보조 — 값과 용도를 바꿨다(아래) |
| `--radius-sm/md/lg/xl/pill/full` | 동일 | `rounded-*` |
| `--font-display/body/mono` | `--font-display/body/mono` | `font-*` |
| `--text-*-size` 계열 | `--text-*` (+`--text-*--line-height`) | `text-*` |
| `--shadow-soft` | `--shadow-soft` | `shadow-soft` |

`--space-*`는 옮기지 않는다. Tailwind 기본 4px 스케일이 원본(`4·8·12·16·20·24·32·48`)과 이미 일치한다. 예외인 `--space-section`(96px)과 `--content-max-width`(1200px) 둘만 `--spacing-section`·`--container-content`로 올린다.

### 회색 계열은 접근성 때문에 원본에서 벗어난다

원본 팔레트의 회색 셋은 WCAG 2.1 AA를 통과하지 못한다. 마케팅 사이트 기준으로 고른 값이기 때문이다. 우리는 표에 숫자를 읽히는 실무 도구라 그대로 쓸 수 없다. 원칙은 `uxguide.md`의 접근성 절에 있다.

| 토큰 | 원본 | 현재 | 이유 |
|---|---|---|---|
| `--color-muted` | `#7c828a` (3.88:1) | `#686e76` | 표 헤더·확신도·고지 문구에 쓰이는 **정보성 텍스트**다. 4.5:1이 필요하다. 현재 canvas 5.15 / surface-soft 4.80 / review-soft 4.70 |
| `--color-muted-soft` | `#a8acb3` (2.28:1) | `#8b9199` | 텍스트로 쓰지 않는다. **폼 컨트롤 테두리와 차트 축선** 전용이며 비텍스트 기준 3:1을 지킨다(3.18) |
| `--color-business-ink` | 없음 | `#056b3f` | 채우기용 `--color-business` `#05b169`는 연한 배경 위에서 2.52:1이라 **글자로 쓸 수 없다.** 배지 텍스트는 이 토큰을 쓴다(5.95:1) |

`--color-hairline` `#dee1e6`은 1.31:1이지만 그대로 둔다. 카드 테두리와 표 구분선은 **장식**이라 WCAG 1.4.11의 대상이 아니다. 다만 폼 컨트롤 테두리는 컴포넌트를 식별하는 요소라 대상이 되므로, `select`·`input`에는 `hairline`을 쓰지 말고 `muted-soft`를 쓴다.

값을 바꿀 때는 눈으로 판단하지 말고 대비율을 계산해서 확인한다.

### 시맨틱 컬러는 재정의한다

원본의 `--color-semantic-up/down`은 시세 등락이다. 우리에겐 등락이 없다. `transactions.classification`의 세 값에 맞춰 이름을 바꾼다.

| 분류 | 토큰 | 값 | 출처 |
|---|---|---|---|
| `business` | `--color-business` | `#05b169` | `--green-600` |
| `personal` | `--color-personal` | `#a8acb3` | `--gray-500` |
| `review` | `--color-review` | `#f4b000` | `--yellow-500` |

`--red-600` `#cf202f`은 분류에 쓰지 않는다. 파괴적 액션(데이터 전체 삭제)과 에러 상태 전용으로 남긴다. **경비 분류에 빨강을 쓰지 마라** — 개인지출은 잘못된 것이 아니고, 빨강은 "문제 있음"으로 읽힌다.

원본 브리프는 green/red를 "텍스트 전용 신호, 채우기로 쓰지 않음"으로 규정한다. 우리는 상태 점(7px 원)에만 채우기로 쓰고 그 외에는 지킨다.

> 프로토타입 CSS에 `var(--color-gray-500, #a8acb3)` 참조가 있다. 그 변수는 정의된 적이 없고(실제 이름은 `--gray-500`) 폴백값으로 동작 중이다. 이식할 때 `--color-personal`로 고친다.

## 밀도 — 마케팅과 앱을 가른다

CLAUDE.md는 **표 중심 고밀도 레이아웃**을 요구하고, 디자인 시스템은 96px 섹션 여백에 32px 카드 패딩의 마케팅 스케일이다. 충돌이 아니라 적용 범위 문제다.

| | 마케팅 (`(marketing)`) | 앱 (`(app)`) |
|---|---|---|
| 섹션 여백 | 96px (`--space-section`) | 24–32px |
| 카드 패딩 | 32px (`--space-xl`) | 24px |
| 표 셀 패딩 | — | 12px |
| 카드 반경 | 24px (`--radius-xl`) | 16px (`--radius-lg`) |
| 최대 폭 | 1200px | 1200px |

프로토타입이 이미 이 분리를 따르고 있다. 랜딩 히어로는 `padding:96px 0 64px`, 표는 `td{padding:12px}`, 통계 카드는 `padding:24px`다.

**pill(100px) 반경은 양쪽 모두 지킨다.** 버튼·탭·칩·검색은 예외 없이 pill이다. 이것이 이 브랜드에서 가장 알아보기 쉬운 신호다.

## 라이트모드 고정과 다크 서피스

CLAUDE.md의 "라이트모드 고정"은 **테마 분기를 만들지 말라**는 뜻이지 어두운 색을 쓰지 말라는 뜻이 아니다. `prefers-color-scheme` 분기, `dark:` variant, 테마 토글을 만들지 않는다.

`--color-surface-dark` `#0a0b0d`은 라이트 페이지 안의 **한 요소 배경**으로만 쓴다. 프로토타입 기준 용처는 토스트, 모달 오버레이(50% 투명), 사용자 채팅 말풍선 세 곳이다.

원본 시스템의 간판인 다크 히어로 밴드(`HeroBand theme="dark"` + 떠 있는 `ProductUICard`)는 **쓰지 않는다.** 우리 랜딩의 주인공은 히어로 이미지가 아니라 드롭존이다. 프로토타입도 흰 캔버스 위 점선 드롭존으로 갔다.

## 컴포넌트

원본 15개 중 실제로 쓰는 것과 버리는 것.

| 컴포넌트 | 판정 | 비고 |
|---|---|---|
| `Button` | 채택 | 7개 variant. 앱은 `primary`·`secondary-light`·`tertiary-text`만 쓴다 |
| `FeatureCard` | 채택 | 랜딩 3열 그리드 |
| `PricingTierCard` | 채택 | 요금제·업그레이드 모달 |
| `BadgePill` | 채택 | 대문자 라벨. 원본에서 유일하게 ALL-CAPS가 허용되는 자리 |
| `TextInput` | 채택 | 포커스 시 2px `--color-primary` 테두리 |
| `TopNav` `Footer` `FooterLink` `CTABand` | 부분 채택 | 마케팅 라우트 전용. 앱 헤더는 별도(탭 + 요금제 칩) |
| `SearchInputPill` | 보류 | 검색 기능이 생기면 |
| `HeroBand` `ProductUICard` | 미채택 | 다크 히어로 밴드를 쓰지 않는다 |
| `AssetRow` `PriceCell` `AssetIcon` | 미채택 | 트레이딩 도메인 |

`components-bundle.js`는 React UMD 전역에 붙는 프로토타입용 번들이다. **그대로 가져오지 마라.** `src/components/`에 Tailwind 클래스 기반 TSX로 다시 쓰고, 번들은 시각적 기준으로만 참조한다. 인라인 `style` 객체와 CSS 변수 문자열을 그대로 옮기면 테마 토큰 규칙이 무너진다.

## 화면

프로토타입의 7개 상태가 곧 화면 인벤토리다. 상태 머신은 `finsight-app.jsx`의 `App()`에 있다.

| 프로토타입 상태 | 라우트 | 핵심 UI |
|---|---|---|
| `landing` | `(marketing)/` | 드롭존, 개인정보 문구 2줄, FeatureCard 3장 |
| `parsing` | — | 스피너. 화면이 아니라 전이 상태 |
| `mapping` | `(app)` 업로드 흐름 | 3단계 스텝바, 헤더 셀렉트 3개 + 첫 행 미리보기 |
| `preview` | `(app)/analyses/:id` | 통계 카드 3장, 표본 20건 표, 잠금 배너 |
| `connect` | 인증 흐름 | Google 동의 카드 |
| `table` | `(app)/analyses/:id` | 전건 표, 확신도 컬럼, 계정과목 셀렉트 |
| `qa` | `(app)/analyses/:id/chat` | 말풍선, 빠른 질문 칩, 하단 고정 입력 |

`preview`와 `table`은 같은 라우트의 분류 전/후다. 별도 페이지로 만들지 않는다.

### 제품 경계가 UI에 박혀 있는 지점

프로토타입이 이미 반영한 것들 — 구현 시 빠뜨리지 마라.

- **고지 바.** 앱 화면 상단에 항상 `이 결과는 세무 조언이 아닙니다. 최종 판단은 세무 대리인과 상의하세요.` 분류 결과가 보이는 곳이면 예외 없이 붙는다
- **확신도 컬럼.** 모든 거래 행이 `%`를 노출한다. 확신도 없이 분류만 보여주는 표를 만들지 마라
- **확인 필요 상단 정렬 + 행 배경 `#fffdf5`.** 낮은 확신도가 스크롤 아래 묻히면 안 된다
- **잠금은 자물쇠 아이콘 + 배너.** CSS 블러가 아니다. 서버가 값을 보내지 않고, UI는 그 빈자리를 명시적으로 표시한다
- **규칙 저장 토스트.** 분류를 고치면 `'가맹점' → 분류로 앞으로 자동 분류됩니다`를 띄운다. 규칙 학습이 일어났다는 사실이 보이지 않으면 사용자는 같은 수정을 반복한다

### 인쇄

프로토타입에 `@media print`가 있다. 헤더·고지 바·툴바를 숨기고 확인필요 행 배경을 흰색으로 되돌린다. 세무 대리인에게 넘기는 종이가 실제 산출물이므로 인쇄 스타일을 나중으로 미루지 않는다.

## 규칙

- 색은 테마 토큰으로만 쓴다. hex를 컴포넌트에 하드코딩하지 마라. 유일한 예외는 확인필요 행 배경 `#fffdf5` — 토큰으로 승격시키거나 하드코딩하지 말고 `--color-review-surface`로 추가한다
- 숫자(금액·확신도·건수)는 전부 `--font-mono`, weight 500. 표 금액 셀은 우측 정렬
- display 타이포는 weight 400 고정. 제목을 굵게 만들지 마라 — 이 브랜드는 크기와 자간으로 위계를 만든다
- 그라디언트·사진·텍스처·글래스모피즘을 쓰지 않는다. 그림자는 `--shadow-soft` 한 단계뿐이다
- 애니메이션은 opacity·color 전환만. 바운스·스프링 이징을 쓰지 마라. 스피너와 토스트 등장(0.2s)이 현재 전부다
- 문장은 sentence case. ALL-CAPS는 `BadgePill`과 표 헤더 라벨에만 허용한다
- 아이콘은 프로토타입의 인라인 SVG 세트(`ICON_PATHS`, 10개)를 기준으로 한다. 브랜드 아이콘 세트가 없으므로 Lucide 경로를 그대로 쓰되 필요한 것만 인라인한다. 아이콘 폰트나 CDN을 의존성으로 추가하지 마라

## 미해결

- **로고가 없다.** 현재는 워드마크 "FinSight" + 8px 파란 점이다. 실제 마크가 생기면 `.wordmark`만 교체하면 된다
- **폰트가 대체품이다.** Inter가 브랜드의 라이선스 display 페이스를, JetBrains Mono가 mono를 대신한다. Google Fonts CDN 의존을 `next/font`로 옮긴다
- **호버 상태가 규정되지 않았다.** 브리프는 눌림 상태만 정의한다. 배경 한 단계 밝게/어둡게로 처리하고 색상(hue)을 바꾸지 마라
- **차트.** Recharts는 보조다. 프로토타입의 주간 지출 막대는 순수 CSS flex다. 이 정도로 충분한 자리에 Recharts를 끌어오지 마라
