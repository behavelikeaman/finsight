import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // node 환경 단일. jsdom을 설정하지 않는다.
    environment: "node",
    // 테스트가 0개여도 통과시킨다. 없으면 Stop 훅이 실패해 세션이 종료되지 못한다.
    passWithNoTests: true,
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
