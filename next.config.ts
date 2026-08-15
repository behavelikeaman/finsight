import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // next dev가 CLAUDE.md를 자동으로 고쳐 쓰는 동작을 끈다.
  // 규칙 파일은 사람이 관리한다. 생성된 블록은 이미 커밋해 뒀다.
  agentRules: false,
};

export default nextConfig;
