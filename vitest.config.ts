import { defineConfig } from "vitest/config";
import tsconfigPaths from "vite-tsconfig-paths";

export default defineConfig({
  plugins: [tsconfigPaths()],
  test: {
    // node 환경 단일. jsdom을 설정하지 않는다.
    environment: "node",
    // 테스트가 0개여도 통과시킨다. 없으면 Stop 훅이 실패해 세션이 종료되지 못한다.
    passWithNoTests: true,
    // scripts/ 는 훅·CI가 직접 실행하는 게이트 스크립트다. 앱 코드는 아니지만
    // 오탐·미탐이 곧 보안 게이트의 구멍이므로 같은 러너로 검증한다.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.mjs"],
  },
});
