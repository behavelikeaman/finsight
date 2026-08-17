#!/usr/bin/env node
/**
 * CLAUDE.md의 CRITICAL 규칙 중 **기계로 판정 가능한 것**만 검사한다.
 *
 * 같은 규칙을 pre-commit 훅(.githooks/pre-commit)과 CI(.github/workflows/review.yml)가
 * 함께 쓴다. AI 리뷰는 문맥 판단이 필요한 항목(값의 출처 추적, RLS WITH CHECK 유무)을 맡고,
 * 여기서는 정규식으로 확정할 수 있는 것만 본다 — 게이트는 결정론적이어야 한다.
 *
 * 사용법:
 *   node scripts/critical-rules.mjs              # staged 파일 (pre-commit)
 *   node scripts/critical-rules.mjs --range A...B  # 리비전 범위 (CI)
 *   node scripts/critical-rules.mjs --all          # 추적 중인 전체 파일
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** 내용을 검사할 경로. 문서·스킬·스크립트는 규칙 문구를 그대로 인용하므로 제외한다. */
const SCANNABLE = [/^src\//, /^supabase\/migrations\//];

/** 파일 경로만으로 판정하는 규칙. 내용과 무관하므로 스캔 대상 밖에도 적용한다. */
const PATH_RULES = [
  {
    id: "tailwind-config",
    match: (path) => /(^|\/)tailwind\.config\.(js|cjs|mjs|ts)$/.test(path),
    message: "Tailwind v4는 CSS-first @theme를 쓴다. tailwind.config.* 를 만들지 마라.",
  },
];

const CONTENT_RULES = [
  {
    id: "next-public-secret",
    pattern: /NEXT_PUBLIC_[A-Z0-9_]*(ANTHROPIC|POLAR|SERVICE_ROLE|SECRET)/,
    message: "비밀값을 NEXT_PUBLIC_* 로 두면 클라이언트 번들에 그대로 박힌다.",
  },
  {
    id: "service-role-key",
    pattern: /SUPABASE_SERVICE_ROLE_KEY/,
    allow: ["src/lib/env.ts", "src/lib/supabase/admin.ts"],
    exemptTests: true,
    message:
      "service role 키는 env.ts·admin.ts에서만 읽는다. 다른 곳에서 쓰면 RLS가 무력화된다.",
  },
  {
    id: "admin-client-import",
    pattern: /(from|require\(\s*)\s*["'][^"']*supabase\/admin["']/,
    allow: ["src/app/api/webhooks/polar/route.ts", "src/app/api/billing/sync/route.ts"],
    exemptTests: true,
    message:
      "admin(service role) 클라이언트는 Polar 웹훅과 billing/sync에서만 import한다.",
  },
  {
    id: "xlsx-import",
    pattern: /(from\s*["']xlsx["'])|(require\(\s*["']xlsx["']\s*\))/,
    message: "xlsx(SheetJS)는 금지다. 엑셀 파싱은 ExcelJS를 쓴다.",
  },
  {
    id: "parse-float",
    pattern: /\bparseFloat\s*\(/,
    only: /^src\//,
    message: "금액은 정수(원)로 다룬다. 통화에 부동소수점을 쓰지 마라.",
  },
  {
    id: "drop-table",
    pattern: /\bDROP\s+TABLE\b/i,
    only: /^supabase\/migrations\//,
    message: "마이그레이션에서 DROP TABLE을 쓰지 마라.",
  },
  {
    id: "redacted-row-cast",
    pattern: /\bas\s+(unknown\s+as\s+)?RedactedRow\b/,
    allow: ["src/lib/redact.ts"],
    exemptTests: true,
    message:
      "RedactedRow 캐스팅은 redact.ts만 한다. 복제하면 마스킹을 건너뛴 값이 외부로 나간다.",
  },
  {
    id: "route-formdata",
    pattern: /\.formData\s*\(/,
    only: /^src\/app\/api\/.*route\.ts$/,
    exemptTests: true,
    message:
      "원본 파일을 서버로 받지 마라. 브라우저가 파싱한 정규화 거래 배열만 JSON으로 받는다.",
  },
  {
    id: "client-secret-env",
    pattern: /process\.env\.(?!NEXT_PUBLIC_|NODE_ENV\b)[A-Z0-9_]+/,
    requiresClient: true,
    message:
      '"use client" 파일에서 서버 전용 환경변수를 읽는다. 번들에 값이 실려 나간다.',
  },
];

const normalize = (path) => path.replace(/\\/g, "/");
const isTest = (path) => /\.(test|spec)\.[a-z]+$/.test(path);

/** 내용 검사 대상인지. CLI가 파일을 읽을지 판단하는 데도 쓴다. */
export function isScannable(path) {
  return SCANNABLE.some((re) => re.test(normalize(path)));
}

/**
 * 파일 하나를 규칙에 통과시킨다.
 * @returns {{file: string, line: number, rule: string, message: string}[]} 줄 번호순
 */
export function scanFile(rawPath, content) {
  const file = normalize(rawPath);
  const findings = [];

  for (const rule of PATH_RULES) {
    if (rule.match(file)) {
      findings.push({ file, line: 1, rule: rule.id, message: rule.message });
    }
  }

  if (!isScannable(file)) {
    return findings;
  }

  const testFile = isTest(file);
  // "use client"는 파일 선두 지시문이다. 규칙마다 다시 훑지 않도록 한 번만 판정한다.
  const isClient = /^\s*["']use client["']/.test(content);

  const active = CONTENT_RULES.filter((rule) => {
    if (rule.only && !rule.only.test(file)) return false;
    if (rule.allow?.includes(file)) return false;
    if (rule.exemptTests && testFile) return false;
    if (rule.requiresClient && !isClient) return false;
    return true;
  });

  content.split(/\r?\n/).forEach((text, index) => {
    for (const rule of active) {
      if (rule.pattern.test(text)) {
        findings.push({ file, line: index + 1, rule: rule.id, message: rule.message });
      }
    }
  });

  return findings;
}

const git = (args) => execFileSync("git", ["-c", "core.quotepath=false", ...args], {
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});

const splitZ = (out) => out.split("\0").filter(Boolean);

function main(argv) {
  const rangeIndex = argv.indexOf("--range");
  const range = rangeIndex === -1 ? null : argv[rangeIndex + 1];
  const all = argv.includes("--all");

  // staged 모드는 워킹 트리가 아니라 **인덱스의 내용**을 본다.
  // 워킹 트리를 읽으면 `git add` 이후에 되돌린 위반을 놓친다.
  let files;
  let read;
  if (all) {
    files = splitZ(git(["ls-files", "-z"]));
    read = (path) => readFileSync(path, "utf8");
  } else if (range) {
    files = splitZ(git(["diff", "--name-only", "-z", "--diff-filter=ACMR", range]));
    read = (path) => readFileSync(path, "utf8");
  } else {
    files = splitZ(git(["diff", "--cached", "--name-only", "-z", "--diff-filter=ACMR"]));
    read = (path) => git(["show", `:${path}`]);
  }

  const findings = files.flatMap((path) =>
    scanFile(path, isScannable(path) ? read(path) : ""),
  );

  if (findings.length === 0) {
    console.log(`CRITICAL 규칙 검사 통과 (${files.length}개 파일)`);
    return 0;
  }

  console.error(`\nCRITICAL 규칙 위반 ${findings.length}건 — CLAUDE.md 참조\n`);
  for (const f of findings) {
    console.error(`  ${f.file}:${f.line}  [${f.rule}]`);
    console.error(`    ${f.message}\n`);
  }
  return 1;
}

if (process.argv[1] && normalize(process.argv[1]).endsWith("scripts/critical-rules.mjs")) {
  process.exit(main(process.argv.slice(2)));
}
