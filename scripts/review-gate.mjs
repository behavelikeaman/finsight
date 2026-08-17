#!/usr/bin/env node
/**
 * /review-code가 낸 판정(verdict.json)을 CI 동작으로 옮긴다.
 *
 *   critical·major ≥ 1  → block   : 승인도 머지도 없다. job 실패
 *   minor ≥ 1           → approve : 승인까지만. 머지는 사람이 판단한다
 *   그 외(nit만·무결)    → merge   : 자동 머지를 예약한다
 *
 * 자동 머지는 되돌리기 어려운 경로이므로 조건을 넓게 잡지 않는다.
 * 판정을 조금이라도 믿을 수 없으면(파일 없음·형식 깨짐·숫자와 판정 불일치) block이다.
 *
 * 사용법: node scripts/review-gate.mjs <verdict.json 경로>
 */
import { appendFileSync, readFileSync } from "node:fs";

const SEVERITIES = ["critical", "major", "minor", "nit"];

/** 스킬 §심각도의 판정 규칙과 같은 식. 숫자가 판정과 맞는지 검산하는 데 쓴다. */
function verdictFromCounts(counts) {
  if (counts.critical > 0) return "Blocked";
  if (counts.major > 0) return "Changes Requested";
  return "Approve";
}

const block = (reason) => ({ action: "block", reason });

/**
 * @param {{verdict: string, counts: Record<string, number>} | null} report
 * @returns {{action: "block" | "approve" | "merge", reason: string}}
 */
export function decide(report) {
  if (!report) {
    return block("판정 파일이 없거나 읽을 수 없다 — 리뷰가 완주하지 못했다");
  }

  const counts = report.counts;
  if (!counts || typeof counts !== "object") {
    return block("counts가 없다");
  }

  for (const key of SEVERITIES) {
    const n = counts[key];
    if (typeof n !== "number" || !Number.isInteger(n) || n < 0) {
      return block(`counts.${key}가 0 이상의 정수가 아니다: ${JSON.stringify(n)}`);
    }
  }

  const expected = verdictFromCounts(counts);
  if (report.verdict !== expected) {
    return block(
      `판정과 개수가 어긋난다 — verdict="${report.verdict}", 개수로는 "${expected}"`,
    );
  }

  if (counts.critical > 0 || counts.major > 0) {
    return block(`critical ${counts.critical}건 · major ${counts.major}건`);
  }

  if (counts.minor > 0) {
    return {
      action: "approve",
      reason: `minor ${counts.minor}건 — 승인은 하되 머지는 사람이 판단한다`,
    };
  }

  return {
    action: "merge",
    reason: counts.nit > 0 ? `nit ${counts.nit}건뿐이다` : "발견 없음",
  };
}

function main(path) {
  let report = null;
  try {
    report = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    report = null;
  }

  const { action, reason } = decide(report);
  console.log(`판정 처리: ${action} — ${reason}`);

  if (process.env.GITHUB_OUTPUT) {
    appendFileSync(process.env.GITHUB_OUTPUT, `action=${action}\n`);
  }

  if (action === "block") {
    console.log(`::error::머지를 차단한다 — ${reason}`);
    return 1;
  }
  return 0;
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/review-gate.mjs")) {
  process.exit(main(process.argv[2]));
}
