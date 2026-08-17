import { describe, expect, it } from "vitest";

import { scanFile } from "./critical-rules.mjs";

/** 위반 id 목록만 뽑는다. 줄 번호·메시지는 개별 테스트에서 따로 본다. */
function ids(path, content) {
  return scanFile(path, content).map((f) => f.rule);
}

describe("스캔 대상 판별", () => {
  it("src/ 와 supabase/migrations/ 만 내용을 검사한다", () => {
    const bad = `const k = process.env.SUPABASE_SERVICE_ROLE_KEY;`;

    expect(ids("src/app/api/analyze/route.ts", bad)).toContain("service-role-key");
    // 문서·스킬·스크립트는 규칙 문구를 그대로 인용한다. 검사하면 자기 자신이 걸린다.
    expect(ids("CLAUDE.md", bad)).toEqual([]);
    expect(ids("docs/ARCHITECTURE.md", bad)).toEqual([]);
    expect(ids(".claude/agents/review-security.md", bad)).toEqual([]);
    expect(ids("scripts/critical-rules.mjs", bad)).toEqual([]);
  });

  it("경로 규칙은 스캔 대상 밖에서도 적용된다", () => {
    expect(ids("tailwind.config.js", "")).toContain("tailwind-config");
    expect(ids("tailwind.config.ts", "")).toContain("tailwind-config");
    expect(ids("postcss.config.mjs", "")).toEqual([]);
  });
});

describe("next-public-secret", () => {
  it("비밀값을 NEXT_PUBLIC_ 으로 노출하면 잡는다", () => {
    expect(ids("src/lib/env.ts", "NEXT_PUBLIC_ANTHROPIC_API_KEY")).toContain(
      "next-public-secret",
    );
    expect(ids("src/lib/env.ts", "NEXT_PUBLIC_POLAR_ACCESS_TOKEN")).toContain(
      "next-public-secret",
    );
  });

  it("공개해도 되는 NEXT_PUBLIC 변수는 통과시킨다", () => {
    const clean = `
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const site = process.env.NEXT_PUBLIC_SITE_URL;
    `;
    expect(ids("src/lib/supabase/browser.ts", clean)).toEqual([]);
  });
});

describe("service-role-key / admin-client-import", () => {
  it("허용된 두 파일 밖에서 service role 키를 읽으면 잡는다", () => {
    const src = `const key = serverEnv("SUPABASE_SERVICE_ROLE_KEY");`;

    expect(ids("src/app/api/analyze/route.ts", src)).toContain("service-role-key");
    expect(ids("src/lib/env.ts", src)).toEqual([]);
    expect(ids("src/lib/supabase/admin.ts", src)).toEqual([]);
  });

  it("admin 클라이언트를 웹훅·billing/sync 밖에서 import하면 잡는다", () => {
    const src = `import { createAdminSupabase } from "@/lib/supabase/admin";`;

    expect(ids("src/app/api/analyses/[id]/classify/route.ts", src)).toContain(
      "admin-client-import",
    );
    expect(ids("src/app/api/webhooks/polar/route.ts", src)).toEqual([]);
    expect(ids("src/app/api/billing/sync/route.ts", src)).toEqual([]);
  });

  it("테스트 파일은 두 규칙에서 면제한다 — 그 코드를 검증하려면 참조해야 한다", () => {
    const src = `
      import { createAdminSupabase } from "@/lib/supabase/admin";
      vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "test-key");
    `;
    expect(ids("src/lib/supabase/admin.test.ts", src)).toEqual([]);
    expect(ids("src/proxy.test.ts", src)).toEqual([]);
  });
});

describe("금지된 의존성·API", () => {
  it("xlsx import를 잡는다", () => {
    expect(ids("src/lib/ingest/excel.ts", `import * as XLSX from "xlsx";`)).toContain(
      "xlsx-import",
    );
    expect(ids("src/lib/ingest/excel.ts", `const x = require('xlsx');`)).toContain(
      "xlsx-import",
    );
    // exceljs는 허용된 파서다. 부분 문자열로 오탐하면 안 된다.
    expect(ids("src/lib/ingest/excel.ts", `import ExcelJS from "exceljs";`)).toEqual([]);
  });

  it("parseFloat 호출을 잡되, 금지 사실을 설명하는 주석은 통과시킨다", () => {
    expect(ids("src/lib/mapping/normalize.ts", `const n = parseFloat(raw);`)).toContain(
      "parse-float",
    );
    expect(
      ids("src/lib/mapping/normalize.ts", ` * parseFloat을 쓰지 않는 이유는 통화를`),
    ).toEqual([]);
  });

  it("마이그레이션의 DROP TABLE을 잡는다", () => {
    expect(ids("supabase/migrations/0006_x.sql", "DROP TABLE analyses;")).toContain(
      "drop-table",
    );
    expect(ids("supabase/migrations/0006_x.sql", "drop table if exists t;")).toContain(
      "drop-table",
    );
    expect(ids("supabase/migrations/0006_x.sql", "CREATE TABLE analyses ();")).toEqual([]);
  });
});

describe("데이터 흐름 규칙", () => {
  it("redact.ts 밖의 RedactedRow 캐스팅을 잡는다", () => {
    const cast = `return { ...row } as RedactedRow;`;

    expect(ids("src/app/api/analyses/[id]/classify/route.ts", cast)).toContain(
      "redacted-row-cast",
    );
    expect(ids("src/lib/redact.ts", cast)).toEqual([]);
  });

  it("라우트 핸들러가 FormData로 파일을 받으면 잡는다", () => {
    const form = `const body = await req.formData();`;

    expect(ids("src/app/api/analyze/route.ts", form)).toContain("route-formdata");
    // 라우트 핸들러가 아닌 곳의 formData는 이 규칙 대상이 아니다.
    expect(ids("src/components/UploadDropzone.tsx", form)).toEqual([]);
  });
});

describe("클라이언트 컴포넌트의 서버 환경변수", () => {
  it('"use client" 파일에서 서버 전용 env를 읽으면 잡는다', () => {
    const src = `"use client";\nconst key = process.env.ANTHROPIC_API_KEY;`;
    expect(ids("src/components/Chat.tsx", src)).toContain("client-secret-env");
  });

  it("NEXT_PUBLIC_·NODE_ENV는 클라이언트에서 읽어도 된다", () => {
    const src = `"use client";
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const dev = process.env.NODE_ENV === "development";`;
    expect(ids("src/components/Chat.tsx", src)).toEqual([]);
  });

  it("서버 파일에서는 서버 env를 읽어도 된다", () => {
    const src = `const key = process.env.ANTHROPIC_API_KEY;`;
    expect(ids("src/app/api/analyses/[id]/classify/route.ts", src)).toEqual([]);
  });
});

describe("finding 형식", () => {
  it("줄 번호는 1부터 세고, 규칙 id와 메시지를 함께 낸다", () => {
    const src = `const a = 1;\nconst b = 2;\nconst n = parseFloat(x);`;
    const [finding, ...rest] = scanFile("src/lib/mapping/normalize.ts", src);

    expect(rest).toEqual([]);
    expect(finding.file).toBe("src/lib/mapping/normalize.ts");
    expect(finding.line).toBe(3);
    expect(finding.rule).toBe("parse-float");
    expect(finding.message).toBeTruthy();
  });

  it("한 파일의 여러 위반을 모두 낸다", () => {
    const src = `import * as XLSX from "xlsx";\nconst n = parseFloat(x);`;
    expect(ids("src/lib/ingest/excel.ts", src)).toEqual(["xlsx-import", "parse-float"]);
  });
});
