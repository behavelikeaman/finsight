/* global args, workflow */
// SOP 프로젝트 래퍼 — FinSight
//
// `args`와 `workflow`는 워크플로우 런타임이 주입하는 전역이라 ESLint가 모른다.
// 위 주석이 없으면 `npm run lint`가 no-undef로 red가 되어 출고 게이트가 막힌다.
//
// 구조: 공정 로직은 전역 정본(~/.claude/workflows/sop.js)에 있고,
//       이 파일은 "우리 프로젝트는 이런 규칙으로 돌린다"는 설정(PRESET) + 호출 3줄이 전부다.

export const meta = {
  name: 'sop',
  description: '표준 업무 공정 — 설계→설계검증→구현→QA병렬→외부검증→종합기록. 전역 정본 호출 래퍼.',
  whenToUse: '기능·문서 등 산출물이 생기는 과제를 제작과 검증을 분리한 공정으로 진행할 때. args={feature(필수), context?, constraints?, scale?=light|standard|full, skipExternalVerify?, ...}',
}

// 전역 정본이 `startsWith('/')`로 절대경로를 검사한다(정본 44행). Windows의 `C:/...`는 이 게이트를 통과하지 못하므로
// Git Bash 스타일 POSIX 절대경로로 적는다. Read/Write 도구와 Bash 도구 모두 이 형식을 받는다(PowerShell 도구는 못 받으니 셸은 Bash를 쓸 것).
const PROJECT_PATH = '/c/Projects/Projects/finsight'

// ── 외부검증 실행 파라미터 ────────────────────────────
// 이 머신에 Codex CLI가 없어 외부 도전을 Claude Code 헤드리스(`claude -p`)로 수행한다. 아래 EXTERNAL_CHALLENGE_HOWTO 참조.
const CHALLENGE_MODEL = 'sonnet'   // 제작자보다 약한 검증자를 두지 않는다. 다양성이 더 급하면 sonnet·fable로 바꿔라(같은 계열이라 blind spot을 공유하는 것이 이 방식의 약점이다)
const CHALLENGE_TIMEOUT = 900    // 초. 실측: sonnet이 파일 1개 적대검증에 220초
const CHALLENGE_TMP = '/c/tmp/sop'

// 정본 CODEX_SCHEMA_JSON(false)와 동일 스키마. verdict enum의 CODEX_INCONCLUSIVE는 이름을 바꾸지 마라 —
// 정본 isInc()가 이 문자열로 "외부 도전 판정 불가"를 감지한다(정본 1150행).
const CHALLENGE_SCHEMA_JSON = '{"verdict":"PASS|CONCERNS|FAIL|CODEX_INCONCLUSIVE","findings":[{"severity":"P0|P1|P2","title":"","evidence":"파일:라인","impact":"","recommendation":"","confidence":0.0}],"summary":""}'

// 정본의 CODEX_HOWTO를 대체한다(정본 573·575행 확장점). 설계검증·외부검증 두 단계가 같은 문자열을 쓴다.
// 도전 프레임(자세·공격 표면·발견의 자격·근거 규율)은 정본 원문을 그대로 계승했고, 호출 절차만 Claude Code로 갈았다.
const EXTERNAL_CHALLENGE_HOWTO = `
[외부 도전(Claude Code 헤드리스) — adversarial + JSON 강제 + hang 안전장치 (반드시 준수)]
0) 준비: Bash로 \`mkdir -p ${CHALLENGE_TMP}\` 실행 후 \`date +%s\`의 출력 숫자를 <TS>로 삼아라. 파일명에 \`$$\`·\`$(date)\` 같은 셸 확장 문자를 넣지 마라 —
   Write 도구의 /tmp(C:\\tmp)와 Bash의 /tmp(AppData\\Local\\Temp)가 서로 다른 곳을 가리키므로, 경로는 예외 없이 /c/ 로 시작하는 절대경로로 적는다.
1) 도전 자료를 Write 도구로 ${CHALLENGE_TMP}/challenge-<TS>.md 에 작성하라(프롬프트 + 대상 전문 또는 절대경로 목록 + 위 도메인 규칙 전문).
   검증자의 cwd는 프로젝트 밖이다 — 대상 파일은 반드시 ${PROJECT_PATH}/... 절대경로로 지목하라. 도전 프레임 필수:
   - 자세: "너의 임무는 이 변경의 신뢰를 깨는 것이다. 통과 확인이 아니다. 회의(skepticism)가 기본값 — 선의·부분 수정·후속 작업 예정에 점수 주지 마라. happy path에서만 작동하면 그것은 실결함이다."
   - 공격 표면(비싸고 위험하고 늦게 발견되는 것 우선): 권한·경계 침범 / 데이터 유실·중복·비가역 상태 / 롤백·재시도·부분 실패·멱등성 / race·순서 가정·stale 상태 / 빈값·timeout·의존 저하 / 버전·스키마 드리프트·마이그레이션 / 실패를 숨기는 관측성 공백. + 프리셋 도메인 규칙 최우선.
   - 발견의 자격(4문): 뭐가 잘못되나 / 왜 이 경로가 취약한가 / 영향은 / 구체적 완화는. 스타일·명명·추측성 지적 금지.
   - 근거 규율: 파일·라인·코드경로를 발명하지 마라. 추론 의존이면 그렇다고 명시하고 confidence(0~1)를 정직하게.
   - 교정 규율: 약한 발견 여러 개보다 강한 발견 1개. 필러로 희석 금지. 진짜 안전하면 발견 0으로 그렇게 말하라.
   - 실행 제약: 빌드·테스트 등 장시간 실행 금지 — 정적 분석 우선(timeout 실사고). 검증자에게는 쓰기·실행 도구가 없다(관찰만 한다).
   - 출력 규율(자료 맨 끝에 이 문장 그대로 포함): "설명·머리말·코드펜스 없이 아래 JSON 객체 하나만 출력하라: ${CHALLENGE_SCHEMA_JSON}"
2) 호출(구독 인증 보장 + hang 방지 + 프로젝트 훅 회피):
   cd ${CHALLENGE_TMP} && cat challenge-<TS>.md | env -u ANTHROPIC_API_KEY timeout ${CHALLENGE_TIMEOUT} claude -p --model ${CHALLENGE_MODEL} --output-format text --allowedTools "Read,Grep,Glob" --disallowedTools "Edit,Write,Bash,WebFetch,WebSearch" --permission-mode dontAsk --no-session-persistence --add-dir ${PROJECT_PATH} > out-<TS>.md 2>&1; echo "EXIT=$?"
   - cwd를 프로젝트 밖에 두는 이유: 프로젝트 Stop 훅이 lint+build+test를 돌려 검증 1회마다 수 분을 태운다. 읽기는 --add-dir로 연다(실측: 프로젝트 안 220초 → 밖 10초).
   - env -u ANTHROPIC_API_KEY: 구독 인증 보장(키가 있으면 API 과금으로 새는 것을 막는다). --disallowedTools: 검증자에게 쓰기·실행 권한을 주지 않는다. --no-session-persistence: 검증 세션이 이력에 쌓이지 않게 한다.
3) EXIT=124 이거나 출력에서 유효한 JSON(verdict 필드)을 못 찾으면 → 1회 재시도 → 재실패 시 verdict를 CODEX_INCONCLUSIVE로 명확히 반환. **빈 결과를 PASS로 위장 금지.**
4) 정상 시 JSON의 verdict/findings/summary를 그대로 너의 구조화 반환에 옮겨라(재해석 금지, 파일:라인 근거 보존).`

const PRESET = {
  // ── 프로젝트 신원 ─────────────────────────────────────
  slug: 'finsight',
  projectName: 'FinSight',
  projectPath: PROJECT_PATH,
  domainDesc: '카드 명세서(CSV/엑셀)를 AI가 사업경비/개인지출로 갈라주는 한국 프리랜서·1인 사업자용 SaaS — Next.js 16(App Router)/React 19/TS strict, Supabase(Auth+Postgres+RLS), Anthropic Claude API, Polar 결제',

  // ── 산출물 성격과 완료 기준 ───────────────────────────
  deliverableKind: 'code',
  doneCriteria: 'npm run lint · npm run build · npm run test 셋 다 통과(Stop 훅과 동일 기준) · 신규 기능은 테스트가 구현보다 먼저 작성돼 있을 것(TDD)',

  // ── 프로젝트 규칙 (검증자들이 지키는지 본다) ──────────
  constitutionRef: 'CLAUDE.md',
  domainRules: [
    '- 세무 조언 금지: "경비 처리 가능", "한도 초과" 같은 판단 문구를 프롬프트·UI 양쪽에서 만들지 않는다. 분류 결과에는 세무 대리인 상의 고지를 함께 노출한다',
    '- 분류에는 확신도를 함께 산출하고, 낮은 건은 "확인 필요"로 분리해 상단에 모은다',
    '- 금액 집계는 전부 코드가 한다. LLM은 거래별 분류 판단만. 금액은 원 단위 정수(bigint)로 다루고 parseFloat 금지',
    '- 서버는 클라이언트가 보낸 집계·tier·잔여 쿼터·분류 모드를 신뢰하지 않고 직접 재집계·재판정한다',
    '- Anthropic·Polar 키는 src/app/api/ 라우트에서만 쓴다. NEXT_PUBLIC_* 노출 금지. 환경변수는 모듈 로드 시점이 아니라 호출 시점에 읽는다(src/lib/env.ts)',
    '- 외부로 나가는 거래 데이터는 예외 없이 src/lib/redact.ts를 거친다. RedactedRow 캐스팅을 다른 파일로 복제하지 않는다. 카드번호는 어떤 컬럼에도 저장하지 않는다',
    '- 사용자 데이터 테이블에는 RLS 필수. SELECT뿐 아니라 INSERT·UPDATE에 WITH CHECK (owner_id = auth.uid())까지 건다. owner_id는 서버가 auth.uid()에서 채운다',
    '- service role 키는 Polar 구독 상태 갱신(웹훅·billing/sync)에서만. usage_counters·profiles의 tier·sample_used·polar_*는 security definer RPC(increment_usage·mark_sample_used)로만 갱신한다',
    '- 막힌 기능은 서버가 값을 안 보내는 방식으로 가린다. CSS 블러·display:none으로 가리지 않는다',
    '- 모든 AI 호출은 src/lib/quota.ts 검사를 통과한 뒤 실행한다. 거래내역은 프롬프트 캐시 프리픽스에 배치. user_rules 매칭 건은 AI로 보내지 않는다. 익명 세션은 표본(상위 20건)만',
    '- 원본 파일을 서버로 보내지 않는다(브라우저가 파싱한 정규화 배열만 JSON 전송). /api/analyze는 LLM을 호출하지 않는다. 읽기는 Server Component에서 직접 조회한다',
    '- 익명 세션은 파일 드롭 시점에 만든다. 귀속된 결과가 있으면 linkIdentity(), 없으면 signInWithOAuth()',
    '- lib/{ingest,mapping,analysis}·rules.ts·redact.ts는 I/O 없는 순수 함수. 거래 타입 3단계(NormalizedRow→IdentifiedRow→RedactedRow)를 합치지 않고, 분류 결과는 배열 index가 아니라 id로 되짚는다',
    '- Tailwind v4 CSS-first(@theme) — tailwind.config.js 금지, 색은 테마 토큰만, 라이트모드 고정. 엑셀 파싱은 ExcelJS(xlsx 금지)',
    '- 마이그레이션에 DROP TABLE 금지. 커밋 메시지는 conventional commits',
  ].join('\n'),

  // ── QA 레인 — 병렬 검증의 관점들 ──────────────────────
  // agentType은 general-purpose로 둔다. 이 리포의 review-* 서브에이전트는 "부모가 준 diff.patch·files.txt를 읽는다"는
  // /review-code 전용 계약이 프롬프트에 박혀 있어, SOP 레인에 그대로 꽂으면 첫 지시부터 어긋난다.
  // 보안 레인에 highRisk:true를 달면 설계검증이 강제 ON이 된다(정본 526행 — skipDesignReview로 못 끈다). 외부 도전이 살아난 지금은 켤 수 있지만, 매 실행에 검증 1겹이 더 붙는다.
  defaultLanes: [
    { key: '게이트', agentType: 'general-purpose', focus: 'CLAUDE.md 규칙 준수(세무 판단 문구·확신도·금액 정수·집계 주체·거래 타입 3단계) · 인터페이스 최소성 · npm run lint && npm run build && npm run test 실측 후 출력 원문 전사.' },
    { key: '보안', agentType: 'general-purpose', focus: 'RLS(SELECT뿐 아니라 INSERT·UPDATE의 WITH CHECK) · owner_id 서버 주입 · service role 사용 범위 · redact.ts 경유 여부 · 키의 클라이언트 노출 · 쿼터와 유료 게이팅의 서버 판정.' },
    { key: '회귀', agentType: 'general-purpose', focus: '기존 테스트 전체 통과 보존 · 신규 코드에 테스트가 선행됐는지 · 그 테스트가 형태만 맞춘 게 아니라 실제 동작을 검증하는지.' },
  ],

  // ── 외부 도전 — Codex 자리를 Claude Code 헤드리스로 대체 ─────
  // 정본은 externalChallenge.howto가 있으면 CODEX_HOWTO 대신 그것을 쓴다(정본 573·575행). 즉 `codex exec` 셸 호출 경로는 통째로 우회된다.
  // 주의: 설계검증·외부검증이 같은 howto를 공유한다. laborCapable(분업)을 켜면 정본이 labor용 스키마에 workPlanVerdict를 요구하는데
  //       이 howto에는 그 필드가 없다 — 분업을 쓸 거라면 스키마에 workPlanVerdict("PASS|FAIL")를 먼저 추가하라.
  externalChallenge: { howto: EXTERNAL_CHALLENGE_HOWTO, agentType: 'general-purpose' },

  // 정본이 "이름만 codex인" 필드로 외부검증 모델 지정을 강제한다(정본 346행 게이트). 실제 호출은 위 howto가 하므로
  // 이 값은 verdict 파일의 "도구·모델" 기록에만 쓰인다 — 그래서 실제로 도는 것을 그대로 적는다.
  codex: { model: `claude-code:${CHALLENGE_MODEL}`, timeout: CHALLENGE_TIMEOUT },

  // ── 기록 위치 — 공정 결과(verdict)가 남는 곳 ─────────
  // 주의: 이 리포의 하네스(scripts/execute.py)가 step마다 `git add -A`를 한다. 공정 기록을 커밋에 섞고 싶지 않으면 .gitignore에 ops/ 를 추가할 것.
  runDir: 'ops/run',

  // ── 선택: 역할별 모델 지정 (미설정 = 세션 모델 상속) ──
  // models: { design: 'opus', record: 'haiku' },
}

let call
try { call = (typeof args === 'string') ? JSON.parse(args || '{}') : (args || {}) }
catch (e) { throw new Error('sop 래퍼: args JSON 파싱 실패 — ' + e.message) }
// scriptPath는 PROJECT_PATH와 규칙이 다르다 — 이쪽은 워크플로우 런타임이 파일시스템에 그대로 넘기므로
// Windows 네이티브 경로여야 한다. `/c/...`로 적으면 상대경로로 해석돼 `C:\c\Users\...`를 찾다가 즉사한다(실측).
// POSIX 형식이 필요한 것은 정본의 startsWith('/') 게이트를 통과해야 하는 preset.projectPath뿐이다.
return await workflow({ scriptPath: 'C:/Users/thkim/.claude/workflows/sop.js' }, { preset: PRESET, call })
