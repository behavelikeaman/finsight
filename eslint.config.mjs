import js from "@eslint/js";
import tseslint from "typescript-eslint";
import next from "eslint-config-next";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      "coverage/**",
      "next-env.d.ts",
      // 디자인 시스템 프로토타입 — 빌드 대상이 아닌 참조 자산이다.
      "docs/design-system/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...next,
);
