# Finsight Design System

> 출처: claude.ai/design 프로젝트 `5af3ff6e-758d-4528-81c1-368056289d60`
> (`_ds/finsight-design-system-dda60d56-999c-44e2-821c-f4550f2790c1`)
> 이 디렉터리는 원본 토큰을 그대로 복사한 것이다. 수정은 원본 프로젝트에서 하고 다시 동기화할 것.

## Overview

Finsight is a demo design system modeled on an institutional-financial brand voice — quiet, white-canvas, editorially-spaced, almost monochromatic marketing surfaces for a crypto/trading platform. The single brand voltage is Finsight Blue (`--color-primary`, #0052ff), used scarcely: primary CTA pills, the wordmark, and inline emphasis links. Everything else is white canvas + ink + soft-gray elevation bands + a deep near-black editorial canvas (`--color-surface-dark`) reserved for full-bleed hero sections carrying layered product-UI mockup cards.

Display type (Inter, standing in for the brand's licensed "Display" face) sits at weight 400 — never bold — pairing with body/nav/caption text also in Inter at 400/600/700, and tabular numbers in JetBrains Mono. The page rhythm rotates three modes: bright white editorial sections, soft-gray elevation bands, and full-bleed dark hero bands. The dark hero with floating dashboard mockups is the system's single most distinctive component.

## Sources

This design system was authored from a written brand-guidelines brief provided in chat (no Figma file, codebase, or slide deck was attached). No product screenshots, logo files, or licensed font binaries were supplied. Component inventory, token values, and layout rules below are transcribed directly from that brief. If a Figma file or codebase becomes available later, re-run discovery against it — the brief is a starting approximation, not verified pixel-for-pixel against a live product.

## Intentional additions
- **AssetIcon** — a small circular icon-plate wrapper, implied by the brief's `asset-icon-circular` spec but not spelled out as its own component; added so `AssetRow` has a real glyph slot.

## Index

- `styles.css` — root stylesheet, `@import`s everything in `tokens/`.
- `tokens/` — colors, typography, spacing, radius, shadow, fonts (Google Fonts substitutes).
- `components-bundle.js` — 원본 `_ds_bundle.js`. React UMD 전역에 `window.FinsightDesignSystem_dda60d`로 15개 컴포넌트를 노출한다.
  원본 말미의 `ui_kits/marketing-site/MarketingSite.jsx` 블록(크립토 마케팅 데모)은 프로토타입이 쓰지 않아 제외했다.
- `prototype/` — `FinSight Prototype.html` + `finsight-app.jsx` + `finsight-data.js`.
  브라우저로 HTML을 열면 랜딩 → 컬럼 매핑 → 표본 분류 → 계정 연결 → 전건 표 → Q&A 흐름이 클릭으로 돈다.
  CDN(React·Babel·Google Fonts)을 쓰므로 온라인 상태여야 하고, `file://`이 아니라 로컬 서버로 열어야 한다
  (`npx serve docs/design-system` 등 — `file://`에서는 외부 `.jsx` 로드가 CORS로 막힌다).
  CSS 경로는 원본의 `_ds/...` 대신 로컬 `../tokens/*`를 가리키도록 고쳤다.

원본 프로젝트에는 아래도 존재한다(로컬 미복사):
- `guidelines/` — foundation specimen cards (Colors, Type, Spacing, Radius, Shadow groups in the Design System tab).
- `components/` — 개별 `.jsx` 소스. 번들로만 가져왔다:
  - `navigation/` — TopNav
  - `buttons/` — Button (7 variants)
  - `heroes/` — HeroBand
  - `cards/` — ProductUICard, FeatureCard
  - `trading/` — AssetRow, PriceCell, AssetIcon
  - `pricing/` — PricingTierCard
  - `forms/` — TextInput, SearchInputPill
  - `badges/` — BadgePill
  - `footer/` — CTABand, Footer, FooterLink
- `ui_kits/marketing-site/` — Home, Explore, Pricing screens, click-through.

## Content Fundamentals

No product copy or marketing pages were supplied with the brief, so the notes below are inferred from the brand's stated positioning (institutional, editorial, calm) rather than pulled from real running copy — treat as a starting hypothesis, not a verified voice guide.

- **Register**: institutional and editorial, closer to financial-press copy (Bloomberg/FT) than typical fintech marketing. Calm, declarative sentences over hype.
- **Address**: second person ("you") for product benefits; brand speaks in first person plural sparingly.
- **Casing**: sentence case throughout — headlines, buttons, nav labels. No ALL-CAPS except badge-pill labels (e.g. "INSTITUTIONAL"), which are a deliberate small-caps-style exception.
- **Numbers**: real, specific figures rendered in monospace — not rounded marketing stats.
- **Emoji**: none. No decorative unicode glyphs in copy.
- **Tone words**: trust, custody, regulated, control — vocabulary drawn from banking/custody rather than "moon"/"HODL" trading slang.

## Visual Foundations

- **Color**: one accent color (Finsight Blue) carries every call to action; everything else is neutral ink/gray/near-black. Trading green/red are text-only semantic signals, never fills or button backgrounds.
- **Type**: display headlines at weight 400 (never bold) with tight negative letter-spacing (-0.5px to -2px, scaling with size); body/nav/buttons in the same family at 400–700 with no tracking; all numeric data (prices, % change) in monospace at 500 weight. Display and body never mix inside one headline.
- **Backgrounds**: no photography, no gradients, no textures or patterns. The only "imagery" is the dark hero band's layered product-UI mockup cards — flat-colored dashboard-shaped rectangles, not photos or illustrations. Sections are solid-color full-bleed bands (white / soft-gray / near-black) rotating for rhythm.
- **Animation**: out of scope per brief — treat as none/minimal; use simple opacity or color transitions only, no bounce/spring easing, nothing overtly playful.
- **Hover states**: not documented in the brief beyond press. Treat hover as a subtle background lighten/darken (e.g. secondary-button surface one step darker) — never a color hue change.
- **Press/active states**: primary CTA darkens from Finsight Blue to Finsight Blue Active (#003ecc) — color shift only, no scale/shrink transforms.
- **Borders**: 1px hairline (`--color-hairline`) on card outlines and dividers on white surfaces; 2px Finsight Blue on focused text inputs. No borders on dark surfaces (elevation does the separating there).
- **Shadows**: one shadow tier total — `--shadow-soft` (`0 4px 12px rgba(0,0,0,0.04)`) for hovered/elevated cards. No multi-tier shadow system, no colored shadows.
- **Depth without shadow**: dark heroes use a second, lighter dark surface (`--color-surface-dark-elevated`) plus slight rotation/overlap to fake a stacked-card look — this substitutes for shadow on dark backgrounds.
- **Transparency/blur**: none specified — avoid glassmorphism/backdrop-blur; it isn't part of this brand.
- **Corner radii**: strict scale — pill (100px) on every interactive control (buttons, search, badges), 24px on every container card, full circle on icon plates/avatars. Sharp corners (0px) essentially unused.
- **Cards**: flat white or near-black-elevated fill, 24px radius, 32px internal padding, 1px hairline border on light surfaces only, no border on dark. Hover adds the one soft shadow tier — nothing else changes.
- **Layout rhythm**: 96px vertical padding between major sections; 24px gaps between cards inside a section; 1200px max content width, hero bands go full-bleed.

## Iconography

The brief does not define or reference an icon system, icon font, or SVG set — no icon assets were provided. Two glyph-like shapes are described only structurally: a circular asset-icon plate (`AssetIcon`, `--radius-full`) and a Bitcoin-style glyph fill using the sparse accent-yellow color; neither has a real source asset. No emoji, no unicode-as-icon usage is implied anywhere in the brief.

**Substitution**: this system uses [Lucide](https://lucide.dev) icons via CDN (`https://unpkg.com/lucide@latest`) wherever a UI kit screen needs a generic glyph (search, chevron, menu, globe) — flagged here as a stand-in, not a brand asset. Swap in the real Finsight/Coinbase-family icon set if one becomes available.

## Assets

No logo file, product screenshot, or illustration was provided. Nowhere in this system is a logo mark drawn or approximated — every place a mark would go renders the wordmark "Finsight" in plain type instead. `assets/` is otherwise empty. **Ask**: if you have the real logo, icon set, or product screenshots, attach them and this system will swap the wordmark-only placeholders for real marks.

## Known Gaps (carried from brief + build-time)
- No licensed font files — Inter substitutes CoinbaseDisplay/CoinbaseSans, JetBrains Mono substitutes CoinbaseMono. Flagging for real font files.
- No logo/icon assets — wordmark-only placeholders; Lucide substituted for a generic icon need.
- In-product trading surfaces (order book, charts, order forms) are out of scope — marketing/editorial surfaces only.
- Hover states, animation timing, and form-validation states beyond focus were not specified in the brief and are treated as reasonable defaults, not verified brand rules.
