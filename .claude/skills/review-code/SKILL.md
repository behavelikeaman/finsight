---
name: review-code
description: 변경 사항을 correctness·security·test coverage 세 축의 서브에이전트로 병렬 리뷰하고, 심각도 4단계와 판정(Approve/Changes Requested/Blocked)이 붙은 Harness 포맷으로 보고한다. "코드 리뷰", "리뷰해줘", "PR 리뷰" 요청에 사용한다.
allowed-tools: Bash, Read, Grep, Glob, Write, Agent
---

# /review-code

변경 사항을 세 축으로 나눠 서브에이전트가 **동시에** 훑고, 부모가 그 결과를 원본 코드로 검산·병합해 판정과 함께 보고한다.

> **스폰 권한**: 이 스킬이 호출된 것 자체가 서브에이전트 병렬 실행 요청이다. 아래 3단계에서 Agent 툴을 3회 호출하라. 사용자에게 다시 확인하지 마라.

---

## 심각도 4단계

| 심각도 | 배지 | 기준 |
|--------|------|------|
| `critical` | 🔴 | 프로덕션에서 데이터 유출·손상·과금 사고로 이어진다. CLAUDE.md의 CRITICAL 규칙 위반은 기본적으로 여기 |
| `major` | 🟠 | 명확한 버그. 특정 입력·상태에서 잘못된 결과나 크래시 |
| `minor` | 🟡 | 동작은 하지만 취약. 미처리 경계조건, 테스트 누락 |
| `nit` | ⚪ | 취향·가독성. 고치지 않아도 무방 |

**판정은 기계적으로 매긴다. 재량을 두지 마라.**

- `critical` ≥ 1 → **Blocked**
- `critical` = 0 이고 `major` ≥ 1 → **Changes Requested**
- 그 외 → **Approve**

집계는 6단계 검증 게이트를 통과한 finding만 센다.

---

## 1. 스코프 감지

`$ARGUMENTS`가 있으면 그대로 `git diff`의 인자로 넘긴다 (예: `HEAD~3..HEAD`, `main...feat-x`, `-- src/lib/`).

없으면 자동 감지한다.

```bash
git rev-parse --show-toplevel
git status --porcelain
```

- 출력이 있으면 → **워킹 트리 모드**
- 비어 있으면 → **브랜치 모드** (`git diff main...HEAD`)

브랜치 모드에서도 diff가 비면 **"리뷰할 변경이 없습니다"로 즉시 종료한다. 에이전트를 띄우지 마라.**

## 2. diff 스냅샷

시스템 프롬프트에 명시된 scratchpad 디렉토리 하위에 `review/`를 만들고 덤프한다. 없으면 `mktemp -d`로 대체한다. **레포 안에는 쓰지 마라.**

```bash
# 워킹 트리 모드
git diff HEAD > "$REVIEW_DIR/diff.patch"
git diff HEAD --name-only > "$REVIEW_DIR/files.txt"
git ls-files --others --exclude-standard   # untracked — files.txt에 [untracked] 표시로 덧붙인다

# 브랜치 모드
git diff main...HEAD > "$REVIEW_DIR/diff.patch"
git diff main...HEAD --name-only > "$REVIEW_DIR/files.txt"
```

untracked 파일은 diff에 안 잡히므로 `files.txt`에 `[untracked]`를 붙여 나열하고, 브리핑에서 "이 파일들은 전체를 Read하라"고 지시한다.

스냅샷을 뜨는 이유는 셋이다. ① 세 에이전트가 정확히 같은 대상을 본다 ② 각자 git을 다시 돌릴 필요가 없다 ③ 리뷰 도중 워킹 트리가 바뀌어도 결과가 흔들리지 않는다.

## 3. 병렬 스폰 — 한 메시지에서 Agent 3회

**동시 실행의 조건은 하나의 응답 블록에서 3개 호출을 함께 내보내는 것이다.** 순차로 내보내면 병렬성이 사라진다.

`subagent_type`은 각각 `review-correctness`, `review-security`, `review-tests`.

각 프롬프트에 아래 브리핑을 **그대로** 넣는다. `{dimension}`만 바꾼다.

````text
리뷰 대상 레포 루트: {repo_root}
diff: {REVIEW_DIR}/diff.patch
변경 파일 목록: {REVIEW_DIR}/files.txt
결과 출력 경로: {REVIEW_DIR}/findings-{dimension}.json

files.txt에서 [untracked]로 표시된 파일은 diff에 포함되지 않는다. 전체를 Read하라.

## 심각도 4단계 (축마다 다르게 해석하지 마라 — 집계가 무의미해진다)

- critical : 프로덕션에서 데이터 유출·손상·과금 사고로 이어진다. CLAUDE.md의 CRITICAL 규칙 위반은 기본적으로 여기
- major    : 명확한 버그. 특정 입력·상태에서 잘못된 결과나 크래시
- minor    : 동작은 하지만 취약. 미처리 경계조건, 테스트 누락
- nit      : 취향·가독성. 고치지 않아도 무방

## 출력 계약

아래 스키마를 정확히 지켜 결과 출력 경로에 JSON 파일을 Write 하라. 필드를 빼거나 추가하지 마라.

{
  "dimension": "{dimension}",
  "findings": [
    {
      "file": "src/app/api/analyze/route.ts",
      "line": 42,
      "severity": "critical",
      "title": "한 줄 제목. 무엇이 문제인지만",
      "tldr": "왜 문제인지 한 문장",
      "good": "이 지점에서 이미 잘 되어 있는 것 한 문장",
      "fix": "수정 코드. 언어 태그를 붙인 마크다운 코드블록 문자열",
      "confidence": "CONFIRMED"
    }
  ],
  "highlights": ["이 변경 전체에서 당신 축 기준으로 잘된 점. 0~2개"]
}

- line: diff의 줄이 아니라 **수정 후 파일의 실제 줄 번호**를 쓴다. 부모가 이 줄을 열어 검산한다
- confidence: 코드를 직접 읽고 확인했으면 "CONFIRMED", 추정이 섞였으면 "PLAUSIBLE"
- good: 억지 칭찬을 금지한다. 진짜로 잘된 게 없으면 그 코드의 의도를 정확히 요약하는 것으로 대체하고, 없는 장점을 지어내지 마라
- 발견이 없으면 findings를 빈 배열로 둔다. 개수를 채우려고 확신 없는 항목을 넣지 마라

ReportFindings를 호출하지 마라. 보고는 부모가 마크다운으로 한 번만 한다.
````

## 4. 병합 · 중복제거

세 JSON을 읽는다. 파싱에 실패한 축은 **빈 결과로 처리하고 최종 출력에 그 사실을 명시한다** — 조용히 넘어가면 사용자는 그 축이 통과한 줄로 오해한다.

- **dedupe** — 같은 `file`이고 `line` 차이가 3 이하면 한 건으로 합친다. 심각도가 갈리면 **높은 쪽을 채택**하고, 두 축의 관점을 `tldr`에 함께 담는다
- **정렬** — critical → major → minor → nit. 동급이면 CONFIRMED 우선, 그다음 파일 경로순

## 5. 검증 게이트

**병합된 각 finding의 `file:line`을 직접 Read해서 확인한다.** 건너뛰지 마라.

- 코드가 주장과 맞지 않으면 → **버린다.** 집계에서도 제외한다
- 맞으면 → `CONFIRMED`, 판단이 갈리면 → `PLAUSIBLE`
- **PLAUSIBLE인 `critical`은 `major`로 강등한다.** critical은 판정을 Blocked로 뒤집는 등급이므로, 추정만으로 브랜치를 막지 않는다

이 게이트가 없으면 병렬화는 노이즈만 세 배로 늘린다. Sonnet 세 개의 추정을 원본 코드로 검산하는 이 지점이 품질을 담보하는 유일한 장치다.

## 6. 출력

`ReportFindings`를 쓰지 마라. 아래 마크다운 두 종을 순서대로 출력한다. 판정을 먼저 보여주고 개별 지적을 뒤에 둔다.

### 6-1. PR 전체 요약 (1개)

```markdown
## 판정: Changes Requested

🔴 critical 0 · 🟠 major 2 · 🟡 minor 3 · ⚪ nit 1

### Walkthrough
{변경이 무엇을 하는지 2~3줄. 파일 나열이 아니라 의도 요약}

### 잘된 점
- {세 축의 highlights에서}

### 주요 지적
{critical·major만. minor·nit은 인라인에만 둔다}
- 🟠 `src/lib/quota.ts:88` — {title}

### 다음 액션
1. {가장 먼저 할 것}
2. ...
```

### 6-2. 인라인 코멘트 (라인별, 4줄)

파일별로 묶고, 파일 안에서는 라인 번호순으로 낸다.

````markdown
#### `src/app/api/analyze/route.ts`

**`:42` [critical] owner_id를 클라이언트 본문에서 받는다**
TL;DR: 요청 본문의 owner_id를 그대로 insert해 타인 소유로 행을 만들 수 있다.
✓ Good: 상위에서 세션 검증은 이미 통과시키고 있다.
→ Fix:
```ts
const { data: { user } } = await supabase.auth.getUser();
owner_id: user.id,
```
````

심각도 표기는 `[critical]` `[major]` `[minor]` `[nit]` 그대로 쓴다.

---

## 하지 않는 것

- **코드를 고치지 마라.** 이 스킬은 리뷰만 한다. 수정은 사용자가 따로 지시한다
- **`gh`로 PR에 코멘트를 달지 마라.** 포맷만 PR 리뷰를 따를 뿐, 출력은 터미널이다
- 발견이 0건이면 억지로 채우지 말고 `Approve`로 보고한다
