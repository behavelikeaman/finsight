#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""SOP 현황판 — 공정이 남긴 기록을 읽어 터미널에 표시한다.

사용법:
    python3 sop_status.py [runDir]

runDir을 생략하면 현재 디렉터리 기준 ops/run 을 본다.

이 도구는 읽기 전용이다. 파일을 만들지도, 고치지도, 지우지도 않는다.
새 기록 형식을 요구하지도 않는다 — 이미 남아 있는 verdict md와 계획 상태
파일(plan-*.state.json)만 읽어 보여주는 표시층이다. 읽지 못한 기록은 조용히
버리지 않고 '파싱 불가'로 세어 화면에 남긴다.

Python3 표준 라이브러리만 쓴다. 외부 패키지·프로젝트 모듈 의존 0.
"""

import errno
import json
import os
import re
import stat
import sys
import unicodedata

WIDTH = 78
MAX_BYTES = 2 * 1024 * 1024

JUDGE = re.compile(r"\b(PASS|CONCERNS|FAIL|INCONCLUSIVE)\b", re.IGNORECASE)
SEV_TOKEN = re.compile(r"\bP\s?([0-2])\b", re.IGNORECASE)
SEV_WORD = (
    (re.compile(r"critical|blocker|치명", re.IGNORECASE), "P0"),
    (re.compile(r"major|중대", re.IGNORECASE), "P1"),
    (re.compile(r"minor|경미|사소", re.IGNORECASE), "P2"),
)
CLS_TOKEN = re.compile(r"(실질|위임|오탐·수용|오탐|수용)")
CLS_FIELD = re.compile(r"분류\W{0,4}[:：]\s*\**\s*(실질|위임|오탐·수용|오탐|수용)")
CONF_WORD = re.compile(r"\b(HIGH|MED|MEDIUM|LOW)\b")
CONF_NUM = re.compile(r"\b(0\.\d{1,3})\b")
HEADING = re.compile(r"^(#{1,6})\s+(.*\S)\s*$")
FENCE = re.compile(r"^(```+|~~~+)")
LEAD_NUM = re.compile(r"^\s*\d+[.)]\s*")
SEP_CELL = re.compile(r"^:?-{2,}:?$")
REPORT_NAME = re.compile(
    r"^sop-(?:(plan-reject|reject)-)?(\d{8})-(\d{6})-(.*)\.md$"
)
HEX64 = re.compile(r"\b([0-9a-f]{64})\b")
PLAN_ID_IN_DOC = re.compile(r"planId\s*=\s*([A-Za-z0-9._-]+)")
STATE_FILE_IN_DOC = re.compile(r"plan-([A-Za-z0-9._-]+)\.state\.json")
ENGINE_VER = re.compile(r"\bsop\s*v?\s*([0-9]+\.[0-9]+\.[0-9]+)", re.IGNORECASE)
SCALE_EQ = re.compile(r"scale\s*[=:]\s*([A-Za-z]+)")
SCALE_WORD = re.compile(r"\b(light|standard|full)\s*scale\b", re.IGNORECASE)
TASK_FIELD = re.compile(r"과제\s*[:：=]\s*(.+)")
TARGET_FIELD = re.compile(r"대상\W{0,4}[:：]\s*(.+)")

SEVERITIES = ("P0", "P1", "P2")


# ---------------------------------------------------------------------------
# L1 수집 — 파일 접근은 이 층에만 있다.
# ---------------------------------------------------------------------------

class DirSource(object):
    """runDir 안의 항목만 이름으로 연다.

    경로 문자열을 조립해 열지 않는다. 디렉터리 서술자를 한 번 잡고 그 안의
    이름으로만 여니, 검사와 열기 사이에 대상이 바뀌어도 다른 디렉터리로
    빠져나갈 수 없다(O_NOFOLLOW + 연 뒤 fstat 재확인).
    """

    def __init__(self, run_dir):
        self.run_dir = run_dir
        self.notes = []
        self._dirfd = None
        self._use_dirfd = hasattr(os, "O_NOFOLLOW") and (
            os.open in getattr(os, "supports_dir_fd", set())
        )
        if not hasattr(os, "O_NOFOLLOW"):
            self.notes.append("이 플랫폼은 링크 미추적 열기를 지원하지 않는다 — 전건 건너뜀")
        elif not self._use_dirfd:
            self.notes.append("이 플랫폼은 디렉터리 서술자 기준 열기를 지원하지 않는다 — 경로 기준으로 연다")

    def _dir(self):
        if self._dirfd is None:
            flags = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_CLOEXEC", 0)
            self._dirfd = os.open(self.run_dir, flags)
        return self._dirfd

    def names(self):
        return sorted(os.listdir(self.run_dir))

    def read(self, name):
        """(text, note) 를 돌려준다. 실패는 삼키지 않고 사유를 붙여 돌려준다."""
        if not hasattr(os, "O_NOFOLLOW"):
            return None, "링크 미추적 열기 미지원"
        if name in (".", "..") or os.sep in name or (os.altsep and os.altsep in name):
            return None, "이름에 경로 구분자 포함 — 건너뜀"
        flags = os.O_RDONLY | os.O_NOFOLLOW | getattr(os, "O_CLOEXEC", 0)
        try:
            if self._use_dirfd:
                fd = os.open(name, flags, dir_fd=self._dir())
            else:
                fd = os.open(os.path.join(self.run_dir, name), flags)
        except OSError as exc:
            return None, _errno_note(exc)
        try:
            st = os.fstat(fd)
            if not stat.S_ISREG(st.st_mode):
                return None, "정규 파일 아님 — 건너뜀"
            chunks = []
            total = 0
            while True:
                block = os.read(fd, 65536)
                if not block:
                    break
                total += len(block)
                if total > MAX_BYTES:
                    return None, "초대형(2MB 초과) — 읽지 않고 건너뜀"
                chunks.append(block)
        except OSError as exc:
            return None, _errno_note(exc)
        finally:
            try:
                os.close(fd)
            except OSError:
                pass
        return b"".join(chunks).decode("utf-8", "replace"), None

    def close(self):
        if self._dirfd is not None:
            try:
                os.close(self._dirfd)
            except OSError:
                pass
            self._dirfd = None


def _errno_note(exc):
    code = getattr(exc, "errno", None)
    if code is not None and code == getattr(errno, "ELOOP", -1):
        return "심볼릭 링크 — 건너뜀"
    return "열기 실패(%s)" % (getattr(exc, "strerror", None) or exc.__class__.__name__)


# ---------------------------------------------------------------------------
# L2 파싱 — 전부 순수함수(문자열 → 값). 디스크를 만지지 않는다.
# ---------------------------------------------------------------------------

class Section(object):
    __slots__ = ("level", "title", "body", "stop")

    def __init__(self, level, title, body):
        self.level = level
        self.title = title
        self.body = body
        self.stop = 0


def split_sections(text):
    """헤딩을 계층째 자른다.

    한 절의 본문은 '같은 레벨 이상의 다음 헤딩 직전'까지다. 즉 `## 발견 목록`의
    본문에는 그 아래 `### P1 …` 하위 절이 통째로 들어간다. 이 범위 정의가
    없으면 하위 절로 쓰인 발견이 0건으로 사라진다.
    """
    lines = text.split("\n")
    heads = []
    fence = None
    for idx, line in enumerate(lines):
        stripped = line.strip()
        match = FENCE.match(stripped)
        if match:
            token = match.group(1)[0] * 3
            if fence is None:
                fence = token
            elif stripped.startswith(fence):
                fence = None
            continue
        if fence is not None:
            continue
        head = HEADING.match(line)
        if head:
            heads.append((idx, len(head.group(1)), head.group(2).strip()))
    sections = []
    for pos, (idx, level, title) in enumerate(heads):
        end = len(lines)
        for later in range(pos + 1, len(heads)):
            if heads[later][1] <= level:
                end = heads[later][0]
                break
        sections.append(Section(level, title, "\n".join(lines[idx + 1:end])))
    for pos, sec in enumerate(sections):
        stop = len(sections)
        for later in range(pos + 1, len(sections)):
            if sections[later].level <= sec.level:
                stop = later
                break
        sec.stop = stop
    return sections


def direct_children(sections, pos):
    """pos 절의 바로 아래 단계 자식 절 인덱스 목록."""
    sec = sections[pos]
    inner = range(pos + 1, sec.stop)
    levels = [sections[i].level for i in inner]
    if not levels:
        return []
    child_level = min(levels)
    return [i for i in inner if sections[i].level == child_level]


def find_section(sections, pattern):
    for pos, sec in enumerate(sections):
        if re.search(pattern, sec.title, re.IGNORECASE):
            return pos
    return None


def judge_word(text):
    match = JUDGE.search(text or "")
    return match.group(1).upper() if match else None


def parse_name(name):
    """파일명 → (kind, ts_raw, ts_display, pid, slug). 실패하면 전부 None."""
    match = REPORT_NAME.match(name)
    if not match:
        return None
    reject, day, clock, tail = match.groups()
    kind = "reject" if reject else "run"
    pid, slug = (tail.split("-", 1) + [""])[:2] if tail else ("", "")
    ts_raw = day + clock
    display = "%s-%s-%s %s:%s" % (day[0:4], day[4:6], day[6:8], clock[0:2], clock[2:4])
    return {
        "kind": kind,
        "reject_kind": reject,
        "ts_raw": ts_raw,
        "ts_display": display,
        "pid": pid,
        "slug": slug,
    }


VERDICT_TITLE = re.compile(r"^[\s\d.)]*(verdict|판정)\b", re.IGNORECASE)


def parse_verdict(text, sections):
    """(verdict, 근거) — verdict 절 우선, 없으면 머리 불릿 줄.

    문서 제목(`# 검증 verdict — …`)은 절로 치지 않는다. 그 절의 본문은 문서
    전체라서, 어디선가 나온 판정어를 문서 verdict로 오독하게 된다.
    """
    for pos, sec in enumerate(sections):
        if sec.level < 2 or not VERDICT_TITLE.match(sec.title):
            continue
        head = [line for line in sec.body.split("\n") if line.strip()][:6]
        word = judge_word("\n".join(head))
        if word:
            return word, "절"
        break
    for line in text.split("\n"):
        if line.lstrip().startswith("|"):
            continue  # 표 안의 판정어는 항목별 평가지 문서 verdict가 아니다
        if re.search(r"verdict", line, re.IGNORECASE):
            word = judge_word(line)
            if word:
                return word, "줄"
    return None, None


def parse_amendment(sections):
    """재검증 추기 절이 있으면 (True, 뒤집힌 판정어)."""
    for sec in sections:
        if re.search(r"재검증\s*이력|추기", sec.title):
            explicit = re.search(
                r"최종\s*(?:verdict|판정)\s*[:：]?\s*\**\s*(PASS|CONCERNS|FAIL|INCONCLUSIVE)",
                sec.title + "\n" + sec.body,
                re.IGNORECASE,
            )
            if explicit:
                return True, explicit.group(1).upper()
            words = JUDGE.findall(sec.title + "\n" + sec.body)
            return True, words[-1].upper() if words else None
    return False, None


def parse_recheck(text, sections):
    """재검증 여부 = 최소필드 5 중 하나. 명시 필드가 없으면 미상으로 남긴다."""
    pos = find_section(sections, r"재검증\s*여부")
    body = sections[pos].body if pos is not None else None
    if body is None:
        for line in text.split("\n"):
            if "재검증 여부" in line:
                body = line.split("재검증 여부", 1)[1]
                break
    if body is None:
        return None
    if "초회" in body:
        return "초회"
    if "필요" in body:
        return "필요"
    if "재검증" in body:
        return "재검증"
    return "미상"


def parse_task(text, sections):
    for line in text.split("\n"):
        match = TASK_FIELD.search(line)
        if match:
            return _tidy(match.group(1))
    pos = find_section(sections, r"^\d*\.?\s*대상|검증\s*대상")
    if pos is not None:
        for line in sections[pos].body.split("\n"):
            cleaned = _tidy(line.lstrip("-* "))
            if cleaned:
                return cleaned
    for line in text.split("\n"):
        match = TARGET_FIELD.search(line)
        if match:
            return _tidy(match.group(1))
    for line in text.split("\n"):
        head = HEADING.match(line)
        if head:
            return _tidy(head.group(2))
    return None


def _tidy(value):
    value = value.replace("**", "").replace("`", "").strip()
    value = re.split(r"\s+/\s+", value)[0]
    return re.sub(r"\s+", " ", value).strip(" -—·:")


def norm_severity(cell):
    match = SEV_TOKEN.search(cell or "")
    if match:
        return "P" + match.group(1)
    for pattern, sev in SEV_WORD:
        if pattern.search(cell or ""):
            return sev
    return None


def norm_class(cell):
    match = CLS_TOKEN.search(cell or "")
    if not match:
        return None
    word = match.group(1)
    return "오탐·수용" if word in ("오탐", "수용", "오탐·수용") else word


def norm_conf(cell):
    match = CONF_WORD.search(cell or "")
    if match:
        return "MED" if match.group(1).upper() == "MEDIUM" else match.group(1).upper()
    match = CONF_NUM.search(cell or "")
    return match.group(1) if match else None


def finding(sev, cls, title, conf=None, where=None):
    return {
        "sev": sev,
        "cls": cls or "미분류",
        "title": _tidy(title or "") or "(제목 미상)",
        "conf": conf,
        "where": where,
    }


def _table_rows(body):
    """본문에서 심각도 열을 가진 첫 표를 찾아 (헤더, 행들)로 돌려준다."""
    lines = body.split("\n")
    for idx, line in enumerate(lines):
        if not line.strip().startswith("|"):
            continue
        header = _cells(line)
        if not any("심각도" in cell or "severity" in cell.lower() for cell in header):
            continue
        rows = []
        for follow in lines[idx + 1:]:
            if not follow.strip().startswith("|"):
                if follow.strip() == "":
                    continue
                break
            cells = _cells(follow)
            if cells and all(SEP_CELL.match(cell.replace(" ", "")) for cell in cells if cell):
                continue
            if not any(cell for cell in cells):
                continue
            rows.append(cells)
        return header, rows
    return None, None


def _cells(line):
    parts = line.strip().split("|")
    if parts and parts[0].strip() == "":
        parts = parts[1:]
    if parts and parts[-1].strip() == "":
        parts = parts[:-1]
    return [part.strip() for part in parts]


def _column(header, *keys):
    for idx, cell in enumerate(header):
        low = cell.lower()
        for key in keys:
            if key in low:
                return idx
    return None


def parse_findings_table(body):
    header, rows = _table_rows(body)
    if not rows:
        return None
    sev_at = _column(header, "심각도", "severity")
    cls_at = _column(header, "분류", "kind")
    title_at = _column(header, "제목", "발견", "내용", "title")
    conf_at = _column(header, "conf", "신뢰도")
    where_at = _column(header, "위치", "출처", "파일")
    entries = []
    for cells in rows:
        get = lambda at: cells[at] if at is not None and at < len(cells) else ""
        title = get(title_at)
        if not title:
            spare = [
                cell for idx, cell in enumerate(cells)
                if idx not in (sev_at, cls_at, conf_at) and len(cell) > 6
            ]
            title = max(spare, key=len) if spare else ""
        entries.append(
            finding(norm_severity(get(sev_at)), norm_class(get(cls_at)), title,
                    norm_conf(get(conf_at)), get(where_at) or None)
        )
    return entries or None


def _strip_finding_title(raw):
    text = LEAD_NUM.sub("", raw.strip())
    bracket = re.match(r"^\[([^\]]*)\]\s*(.*)$", text)
    if bracket and SEV_TOKEN.search(bracket.group(1)):
        text = bracket.group(2)
    text = re.sub(
        r"^P\s?[0-2]\s*(?:\([^)]*\))?\s*"
        r"(?:실질|위임|오탐·수용|오탐|수용|미분류)?\s*"
        r"(?:\[[^\]]*\])?\s*(?:\([^)]*\))?\s*[—–\-·:]*\s*",
        "",
        text,
        flags=re.IGNORECASE,
    )
    text = LEAD_NUM.sub("", text)
    return text.strip(" *·—–-")


def parse_findings_headings(sections, pos):
    """헤딩형 — `### P1 실질 — 제목` 과 `### P1 (필수 정정)` → `#### 1. 제목` 양형."""
    entries = []
    for child in direct_children(sections, pos):
        sec = sections[child]
        sev = norm_severity(sec.title)
        if sev is None:
            continue
        grandchildren = direct_children(sections, child)
        leafy = [g for g in grandchildren if norm_severity(sections[g].title) is None]
        if grandchildren and len(leafy) == len(grandchildren):
            for leaf in grandchildren:
                sub = sections[leaf]
                entries.append(_heading_finding(sev, sub.title, sub.body))
        else:
            entries.append(_heading_finding(sev, sec.title, sec.body))
    return entries or None


def _heading_finding(sev, raw_title, body):
    title = _strip_finding_title(raw_title)
    prefix = raw_title[:raw_title.find(title)] if title and title in raw_title else raw_title
    cls = norm_class(prefix)
    if cls is None:
        match = CLS_FIELD.search(body)
        cls = norm_class(match.group(1)) if match else None
    conf = norm_conf(_line_with(body, "confidence") or _line_with(body, "신뢰도") or "")
    where = _line_with(body, "파일") or _line_with(body, "위치")
    return finding(sev, cls, title, conf, _tidy(where) if where else None)


def _line_with(body, key):
    for line in body.split("\n"):
        if key in line:
            return line.strip("-* ").strip()
    return None


def parse_findings_numbered(body):
    """번호목록형 — 반려 리포트(`## 발견 목록(N건)` + `1. …`)가 이 형태다."""
    entries = []
    for line in body.split("\n"):
        if not LEAD_NUM.match(line):
            continue
        text = LEAD_NUM.sub("", line.strip())
        if not text:
            continue
        entries.append(finding(norm_severity(text), norm_class(text), _strip_finding_title(text)))
    return entries or None


def parse_findings_bullets(body):
    entries = []
    for line in body.split("\n"):
        stripped = line.strip()
        if not re.match(r"^[-*]\s+", stripped):
            continue
        sev = norm_severity(stripped)
        if sev is None:
            continue
        entries.append(
            finding(sev, norm_class(stripped), _strip_finding_title(stripped[1:].strip()),
                    norm_conf(stripped))
        )
    return entries or None


ZERO_MARK = re.compile(r"(0\s*건|없음|없다|해당\s*없음|N/A)", re.IGNORECASE)


def _explicit_zero(sec, declared):
    """0건 단정은 명시 근거가 있을 때만.

    근거로 치는 것: ① 절 제목의 선언이 0건이거나 ② 절 내용의 첫 의미 줄
    자체가 0건 선언이고, 절 어디에도 결함 항목의 흔적(P0~P2 토큰)이 없을 때.
    '없음' 같은 문구가 제목이나 본문 어딘가 스치기만 해도 0건으로 접으면,
    형식 변형으로 파싱에 실패한 실제 결함이 '발견 0건'으로 위장된다 —
    파싱 실패와 진짜 0건의 구분이 무너지는 정직 보고 계약 위반이다.
    """
    if declared is not None:
        return declared == 0
    if SEV_TOKEN.search(sec.title) or SEV_TOKEN.search(sec.body):
        return False
    for line in sec.body.split("\n"):
        stripped = line.strip().strip("-*•>_ ").strip()
        if not stripped:
            continue
        return ZERO_MARK.match(stripped) is not None
    return ZERO_MARK.search(sec.title) is not None


def parse_findings(sections, kind):
    """(entries, fmt, declared, note).

    entries 가 None 이면 '읽어내지 못했다'는 뜻이지 '결함 0건'이 아니다. 공정은
    verdict md에 발견 목록을 최소필드로 요구하므로, 절이 아예 없거나 항목을
    하나도 인식하지 못한 경우를 0건으로 뭉뚱그리면 P0/P1이 조용히 사라진다.
    """
    pos = find_section(sections, r"발견")
    if pos is None:
        return None, None, None, "발견 목록 절 없음(최소필드 결손 또는 헤딩 변형)"
    sec = sections[pos]
    declared = None
    count = re.search(r"(\d+)\s*건", sec.title)
    if count:
        declared = int(count.group(1))
    for fmt, entries in (
        ("표", parse_findings_table(sec.body)),
        ("헤딩", parse_findings_headings(sections, pos)),
        ("번호", parse_findings_numbered(sec.body) if kind == "reject" or declared is not None else None),
        ("불릿", parse_findings_bullets(sec.body)),
    ):
        if entries:
            return entries, fmt, declared, None
    if _explicit_zero(sec, declared):
        return [], "명시0", declared, None
    return None, None, declared, "발견 절은 있으나 항목을 인식하지 못함(형식 변형)"


def parse_plan_binding(text):
    """문서 안의 계획 결속 흔적. 문자열만 본다 — 여기서 얻은 경로는 열지 않는다."""
    plan_id = None
    match = PLAN_ID_IN_DOC.search(text)
    if match:
        plan_id = match.group(1)
    state_id = None
    match = STATE_FILE_IN_DOC.search(text)
    if match:
        state_id = match.group(1)
    plan_hash = None
    match = HEX64.search(text)
    if match:
        plan_hash = match.group(1)
    return {
        "plan_id": plan_id or state_id,
        "state_id": state_id,
        "plan_hash": plan_hash,
    }


def parse_engine(text):
    version = ENGINE_VER.search(text)
    scale = SCALE_EQ.search(text) or SCALE_WORD.search(text)
    return (version.group(1) if version else None), (scale.group(1).lower() if scale else None)


def parse_report(name, text):
    meta = parse_name(name)
    if meta is None:
        return {"name": name, "ok": False, "note": "파일명 규약 불일치"}
    sections = split_sections(text)
    verdict, verdict_src = parse_verdict(text, sections)
    amended, amended_verdict = parse_amendment(sections)
    entries, fmt, declared, note = parse_findings(sections, meta["kind"])
    binding = parse_plan_binding(text)
    version, scale = parse_engine(text)
    notes = []
    if note:
        notes.append(note)
    if verdict is None:
        notes.append("verdict 판정어 미인식")
    recheck = parse_recheck(text, sections)
    if recheck is None:
        notes.append("재검증 여부 필드 없음")
    if entries is not None and declared is not None and declared != len(entries):
        notes.append("발견 수 선언 %d건 vs 파싱 %d건" % (declared, len(entries)))
    report = {
        "name": name,
        "ok": True,
        "kind": meta["kind"],
        "reject_kind": meta["reject_kind"],
        "ts_raw": meta["ts_raw"],
        "ts_display": meta["ts_display"],
        "slug": meta["slug"],
        "pid": meta["pid"],
        "verdict": verdict,
        "verdict_src": verdict_src,
        "amended": amended,
        "amended_verdict": amended_verdict,
        "recheck": recheck,
        "findings": entries,
        "findings_fmt": fmt,
        "declared": declared,
        "task": parse_task(text, sections),
        "plan_id": binding["plan_id"],
        "plan_hash": binding["plan_hash"],
        "engine": version,
        "scale": scale,
        "replaced": "�" in text,
        "notes": notes,
    }
    report["counts"] = count_severities(entries)
    return report


def count_severities(entries):
    if entries is None:
        return None
    counts = {"P0": 0, "P1": 0, "P2": 0, "미상": 0}
    for item in entries:
        key = item["sev"] if item["sev"] in counts else "미상"
        counts[key] += 1
    return counts


def parse_state(name, text):
    """plan-*.state.json → 체인. 연결만 본다. 지문 재계산은 하지 않는다."""
    plan_id = name[len("plan-"):-len(".state.json")]
    try:
        data = json.loads(text)
    except ValueError as exc:
        return {"name": name, "plan_id": plan_id, "ok": False,
                "note": "JSON 판독 불가(%s)" % str(exc).split("\n")[0][:60]}
    if not isinstance(data, dict):
        return {"name": name, "plan_id": plan_id, "ok": False, "note": "최상위가 객체가 아님"}
    plan_id_field = data.get("planId")
    if plan_id_field is not None and not isinstance(plan_id_field, str):
        # fail-soft: 이 파일만 '상태 판독 불가(사유)'로 계상하고 계속 간다.
        # 비문자열 planId를 그대로 흘리면 집계·정렬·표시에서 전체가 죽는다.
        return {"name": name, "plan_id": plan_id, "ok": False,
                "note": "planId가 문자열이 아님(%s)" % type(plan_id_field).__name__}
    records_raw = data.get("stateRecords")
    if not isinstance(records_raw, list):
        return {"name": name, "plan_id": plan_id, "ok": False, "note": "stateRecords 결손"}
    plan_hash = data.get("planHash") if isinstance(data.get("planHash"), str) else None
    prev = plan_hash
    records = []
    for idx, raw in enumerate(records_raw):
        if not isinstance(raw, dict):
            records.append({"seq": idx, "run_state": "(항목 형식 오류)", "at": None,
                            "link": "확인 불가", "seq_note": None, "evidence": None})
            prev = None
            continue
        seq = raw.get("seq")
        digest = raw.get("digest") if isinstance(raw.get("digest"), str) else None
        prev_digest = raw.get("prevDigest") if isinstance(raw.get("prevDigest"), str) else None
        if prev is None:
            link = "확인 불가"
        elif prev_digest is None:
            link = "prevDigest 결손"
        elif prev_digest == prev:
            link = "연결 OK"
        else:
            link = "연결 불일치"
        records.append({
            "seq": seq if seq is not None else idx,
            "run_state": raw.get("runState") or "(runState 결손)",
            "at": raw.get("at"),
            "link": link,
            "seq_note": None if seq == idx else "seq 불연속(기록 %s번째에 seq=%s)" % (idx, seq),
            "evidence": raw.get("evidence") if isinstance(raw.get("evidence"), dict) else None,
        })
        prev = digest
    return {
        "name": name,
        "plan_id": plan_id_field or plan_id,
        "plan_hash": plan_hash,
        "records": records,
        "ok": True,
        "note": None,
    }


# ---------------------------------------------------------------------------
# L3 집계
# ---------------------------------------------------------------------------

def collect(source):
    coverage = {
        "reports": 0, "unreadable": 0, "unnamed": 0, "other": 0,
        "replaced": 0, "verdict_ok": 0, "findings_ok": 0,
        "problems": [], "source_notes": list(getattr(source, "notes", [])),
    }
    reports = []
    states = []
    plan_files = set()
    state_ids = set()
    for name in source.names():
        if name.startswith("plan-") and name.endswith(".state.json"):
            text, note = source.read(name)
            if text is None:
                coverage["unreadable"] += 1
                coverage["problems"].append((name, note))
                continue
            if "�" in text:
                coverage["replaced"] += 1  # md 경로와 동일 기준 — 치환 발생을 숨기지 않는다
            state = parse_state(name, text)
            state_ids.add(state["plan_id"])
            if not state["ok"]:
                coverage["problems"].append((name, state["note"]))
            states.append(state)
            continue
        if name.startswith("plan-") and name.endswith(".json") and not name.endswith(".meta.json"):
            plan_files.add(name[len("plan-"):-len(".json")])
            coverage["other"] += 1
            continue
        if not (name.startswith("sop-") and name.endswith(".md")):
            coverage["other"] += 1
            continue
        coverage["reports"] += 1
        text, note = source.read(name)
        if text is None:
            coverage["unreadable"] += 1
            coverage["problems"].append((name, note))
            continue
        report = parse_report(name, text)
        if not report.get("ok"):
            coverage["unnamed"] += 1
            coverage["problems"].append((name, report.get("note")))
            continue
        if report["replaced"]:
            coverage["replaced"] += 1
        if report["verdict"]:
            coverage["verdict_ok"] += 1
        if report["findings"] is not None:
            coverage["findings_ok"] += 1
        for note in report["notes"]:
            coverage["problems"].append((name, note))
        reports.append(report)
    reports.sort(key=lambda r: (r["ts_raw"], r["name"]), reverse=True)
    states.sort(key=lambda s: s["plan_id"])
    return {
        "reports": reports,
        "states": states,
        "coverage": coverage,
        "orphan_plans": sorted(plan_files - state_ids),
    }


def attention(reports):
    """실질 P0/P1 집계. (rows, delegated, unclassified, unparsed) 를 돌려준다.

    같은 planId 런이 여럿이면 '발견을 읽어낸' 최신 것만 센다(옛 런은 대체된
    것으로 본다). 발견 판독에 실패한 런은 대표 자격이 없다 — 실패 런을
    대표로 선등록하면 과거 런의 실질 결함이 이 목록에서 무음 소실된다
    (과소보고는 이 화면에서 비가역). 대신 실패 사실을 unparsed 로 돌려줘
    화면에 명시한다(안전 방향 = 과대보고).
    planId 없는 런은 서로 대체 관계를 알 수 없으므로 각자 남긴다.
    """
    seen = set()
    warned = set()
    rows = []
    unparsed = []
    delegated = 0
    unclassified = 0
    for report in reports:
        key = report["plan_id"]
        if report["findings"] is None:
            if key and key in seen:
                continue  # 더 최신의 판독 성공 런이 이미 대표다 — 옛 실패는 대체됨
            wkey = key or report["name"]
            if wkey not in warned:
                warned.add(wkey)
                unparsed.append(report)
            continue
        if key:
            if key in seen:
                continue
            seen.add(key)
        for item in report["findings"] or []:
            if item["sev"] not in ("P0", "P1"):
                continue
            if item["cls"] == "실질":
                rows.append((report, item))
            elif item["cls"] == "위임":
                delegated += 1
            elif item["cls"] == "미분류":
                unclassified += 1
                rows.append((report, item))
    rows.sort(key=lambda pair: (pair[1]["sev"], pair[0]["ts_raw"]))
    return rows, delegated, unclassified, unparsed


# ---------------------------------------------------------------------------
# L4 표시
# ---------------------------------------------------------------------------

def dwidth(text):
    total = 0
    for char in text:
        if unicodedata.combining(char):
            continue
        total += 2 if unicodedata.east_asian_width(char) in ("W", "F") else 1
    return total


def trunc(text, limit):
    text = re.sub(r"\s+", " ", text or "")
    if dwidth(text) <= limit:
        return text
    out = ""
    room = limit - 1
    for char in text:
        step = 0 if unicodedata.combining(char) else (
            2 if unicodedata.east_asian_width(char) in ("W", "F") else 1)
        if dwidth(out) + step > room:
            break
        out += char
    return out + "…"


def cell(text, limit):
    text = trunc(text, limit)
    return text + " " * max(0, limit - dwidth(text))


def rule(char="-"):
    return char * WIDTH


def fmt_counts(report):
    counts = report["counts"]
    if counts is None:
        return "?/?/?"
    body = "%d/%d/%d" % (counts["P0"], counts["P1"], counts["P2"])
    if counts["미상"]:
        body += "+%d?" % counts["미상"]
    return body


def fmt_verdict(report):
    base = report["verdict"] or "?"
    if report["amended"]:
        base += "→" + (report["amended_verdict"] or "?")
    return base


def render_runs(reports):
    lines = ["[1] 런 목록 — %d건 (최신순)" % len(reports), rule()]
    if not reports:
        lines.append("  표시할 런이 없다.")
        return lines
    lines.append(
        "  " + cell("시각", 16) + " " + cell("과제", 23) + " " + cell("verdict", 13)
        + " " + cell("P0/P1/P2", 9) + " " + cell("재검증", 6) + " " + "계획"
    )
    for report in reports:
        label = report["plan_id"] or report["task"] or report["slug"] or "(미상)"
        mark = "결속" if report["plan_id"] else "-"
        if report["kind"] == "reject":
            label = "[반려] " + label
        lines.append(
            "  " + cell(report["ts_display"], 16)
            + " " + cell(label, 23)
            + " " + cell(fmt_verdict(report), 13)
            + " " + cell(fmt_counts(report), 9)
            + " " + cell(report["recheck"] or "미상", 6)
            + " " + mark
        )
    lines.append("  ※ P0/P1/P2 = 그 런이 남긴 발견 수.")
    lines.append("  ※ `?`는 결함 0건이 아니라 읽어내지 못했다는 뜻이다(커버리지 참조).")
    return lines


def render_detail(report):
    lines = ["[2] 최근 런 상세", rule()]
    if report is None:
        lines.append("  표시할 런이 없다.")
        return lines
    lines.append("  파일: " + trunc(report["name"], WIDTH - 8))
    lines.append("  과제: " + trunc(report["task"] or "(미상)", WIDTH - 8))
    engine = report["engine"] or "?"
    scale = report["scale"] or "?"
    lines.append("  공정: " + trunc(
        "sop v%s · scale=%s · verdict %s · 재검증 %s"
        % (engine, scale, fmt_verdict(report), report["recheck"] or "미상"), WIDTH - 8))
    if report["amended"]:
        lines.append("  ※ 재검증 추기 있음 — 본문 판정이 뒤집혔다. 원문 확인 요.")
    if report["findings"] is None:
        lines.append("  발견: 읽어내지 못했다 — " + (report["notes"][0] if report["notes"] else "사유 미상"))
        return lines
    if not report["findings"]:
        lines.append("  발견: 0건(문서가 명시)")
        return lines
    lines.append("  발견 %d건 (형식=%s)" % (len(report["findings"]), report["findings_fmt"]))
    for item in report["findings"]:
        lines.append(
            "    " + cell(item["sev"] or "P?", 3) + cell(item["cls"], 11)
            + trunc(item["title"], WIDTH - 18)
        )
        detail = []
        if item["conf"]:
            detail.append("conf " + item["conf"])
        if item["where"]:
            detail.append(item["where"])
        if detail:
            lines.append(" " * 18 + trunc(" · ".join(detail), WIDTH - 19))
    return lines


def render_chain(states, orphan_plans, reports):
    lines = ["[3] 계획 결속 — 상태 파일 %d건" % len(states), rule()]
    by_plan = {}
    for report in reports:
        if report["plan_id"] and report["plan_id"] not in by_plan:
            by_plan[report["plan_id"]] = report["name"]
    if not states:
        lines.append("  계획 결속 상태 파일이 없다.")
    for state in states:
        if not state["ok"]:
            lines.append("  %s — 상태 판독 불가: %s" % (state["plan_id"], state["note"]))
            continue
        head = "  %s" % trunc(state["plan_id"], 40)
        if state["plan_hash"]:
            head += "  지문 %s…" % state["plan_hash"][:12]
        lines.append(head)
        run_name = by_plan.get(state["plan_id"])
        if run_name:
            lines.append("    런: " + trunc(run_name, WIDTH - 9))
        for record in state["records"]:
            mark = "" if record["link"] == "연결 OK" else "<!> "
            lines.append(
                "    seq %s  " % cell(str(record["seq"]), 2)
                + cell(str(record["run_state"]), 24)
                + " " + cell(str(record["at"] or "-"), 21)
                + trunc(mark + record["link"], 20)
            )
            if record["seq_note"]:
                lines.append("      <!> " + trunc(record["seq_note"], WIDTH - 11))
        final = state["records"][-1]["evidence"] if state["records"] else None
        if final:
            bits = []
            for key in ("triageVerdict", "defectCount", "qaLanes", "codexInconclusive"):
                if key in final:
                    bits.append("%s=%s" % (key, final[key]))
            if bits:
                lines.append("    증거: " + trunc(" · ".join(bits), WIDTH - 12))
    if orphan_plans:
        lines.append("  상태 기록 없는 계획 %d건: %s"
                     % (len(orphan_plans), trunc(", ".join(orphan_plans), WIDTH - 24)))
    lines.append("  ※ 체인 연결만 확인한다. 해시 재계산·계획 무결성 검증은 공정(엔진) 소관이다.")
    return lines


def render_attention(reports):
    rows, delegated, unclassified, unparsed = attention(reports)
    lines = ["[4] 사람 판단 필요 — 실질 P0/P1 %d건" % len(rows), rule()]
    lines.append("  ※ 같은 planId 런이 여럿이면 발견을 읽어낸 최신 것만 센다.")
    lines.append("  ※ 최신 런 기준 미처분 추정 — 처분(수리·수용·기각) 기록은 SOP 공정 밖이라")
    lines.append("    이 화면은 알지 못한다. 이미 정리된 건이 남아 있을 수 있다.")
    if not rows and not unparsed:
        lines.append("  실질 P0/P1로 잡힌 발견이 없다.")
    for report, item in rows:
        tag = report["plan_id"] or "%s %s" % (report["ts_display"][5:], report["slug"] or "?")
        if report["amended"]:
            tag += " [추기 %s]" % (report["amended_verdict"] or "?")
        if item["cls"] == "미분류":
            tag += " [분류 미상]"
        lines.append("  " + cell(item["sev"], 3) + cell(tag, 34) + " "
                     + trunc(item["title"], WIDTH - 40))
    for report in unparsed:
        tag = report["plan_id"] or "%s %s" % (report["ts_display"][5:], report["slug"] or "?")
        lines.append("  <!> " + cell(tag, 30) + " "
                     + trunc("발견 판독 불가 — 결함 유무 미상", WIDTH - 38))
    extra = []
    if delegated:
        extra.append("위임 분류 P0/P1 %d건" % delegated)
    if unclassified:
        extra.append("분류 미상 P0/P1 %d건(위 목록에 포함)" % unclassified)
    if extra:
        lines.append("  (참고) " + " · ".join(extra))
    return lines


def render_coverage(data):
    coverage = data["coverage"]
    total = coverage["reports"]
    lines = ["[커버리지] 읽은 것과 못 읽은 것", rule()]
    lines.append("  sop-*.md 대상 %d건 · 읽기 실패 %d건 · 파일명 규약 불일치 %d건 · 대상 외 %d건"
                 % (total, coverage["unreadable"], coverage["unnamed"], coverage["other"]))
    parsed = len(data["reports"])
    lines.append("  verdict 파싱 %d/%d · 발견 목록 파싱 %d/%d · 인코딩 치환 %d건"
                 % (coverage["verdict_ok"], parsed, coverage["findings_ok"], parsed,
                    coverage["replaced"]))
    for name, note in coverage["problems"]:
        lines.append("  - %s — %s" % (trunc(name, 42), trunc(note or "사유 미상", WIDTH - 49)))
    for note in coverage["source_notes"]:
        lines.append("  - 수집 환경: " + trunc(note, WIDTH - 15))
    rejects = [r for r in data["reports"] if r["kind"] == "reject"]
    if rejects:
        lines.append("  ※ 반려 리포트 %d건 — 표시 형식은 공정 코드 템플릿 기준이다" % len(rejects))
        lines.append("    (반려 실물 표본 대조는 미검증).")
    return lines


def render(data, run_dir):
    reports = data["reports"]
    out = []
    out.append("SOP 현황판 — " + trunc(run_dir, WIDTH - 14))
    out.append("읽기 전용 표시층 · 기록을 만들지도 고치지도 않는다")
    out.append(rule("="))
    out.append("")
    out.extend(render_runs(reports))
    out.append("")
    out.extend(render_detail(reports[0] if reports else None))
    out.append("")
    out.extend(render_chain(data["states"], data["orphan_plans"], reports))
    out.append("")
    out.extend(render_attention(reports))
    out.append("")
    out.extend(render_coverage(data))
    return "\n".join(out)


# ---------------------------------------------------------------------------
# L0 CLI
# ---------------------------------------------------------------------------

USAGE = """SOP 현황판 — 공정 기록을 읽어 터미널에 표시한다 (읽기 전용).

사용법:
  python3 sop_status.py            현재 디렉터리 기준 ops/run 을 본다
  python3 sop_status.py <runDir>   지정한 기록 디렉터리를 본다
  python3 sop_status.py -h         이 도움말

표시:
  [1] 런 목록  [2] 최근 런 상세  [3] 계획 결속 체인  [4] 사람 판단 필요
  [커버리지] 읽지 못한 기록을 숨기지 않고 사유와 함께 센다."""


def main(argv, out=None):
    out = out if out is not None else sys.stdout
    args = list(argv[1:])
    if any(arg in ("-h", "--help") for arg in args):
        out.write(USAGE + "\n")
        return 0
    if len(args) > 1:
        out.write("인자는 runDir 하나만 받는다.\n\n" + USAGE + "\n")
        return 2
    run_dir = os.path.abspath(args[0] if args else os.path.join("ops", "run"))
    if not os.path.isdir(run_dir):
        out.write("기록 디렉터리를 찾지 못했다: %s\n\n" % run_dir)
        out.write("SOP 공정 기록(sop-*.md)이 있는 디렉터리를 인자로 지정하라.\n\n" + USAGE + "\n")
        return 2
    source = DirSource(run_dir)
    try:
        try:
            data = collect(source)
        except OSError as exc:
            out.write("기록 디렉터리를 읽지 못했다: %s (%s)\n"
                      % (run_dir, getattr(exc, "strerror", None) or exc.__class__.__name__))
            return 2
    finally:
        source.close()
    if not data["reports"] and not data["states"]:
        out.write("SOP 현황판 — %s\n" % run_dir)
        out.write("런 기록 0건 — 이 디렉터리에 sop-*.md 도 plan-*.state.json 도 없다.\n")
        out.write("다른 기록 디렉터리를 인자로 지정하라: python3 sop_status.py <runDir>\n")
        if data["coverage"]["problems"]:
            out.write("\n" + "\n".join(render_coverage(data)) + "\n")
        return 0
    out.write(render(data, run_dir) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
