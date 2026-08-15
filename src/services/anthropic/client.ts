import Anthropic from "@anthropic-ai/sdk";

import { serverEnv } from "@/lib/env";

/**
 * Anthropic 클라이언트 팩토리.
 *
 * 키는 호출 시점에 읽는다(serverEnv). 모듈 로드 시점에 읽으면 키가 없는
 * CI/빌드 환경에서 빌드가 통째로 깨진다.
 */
export function getClient(): Anthropic {
  return new Anthropic({ apiKey: serverEnv("ANTHROPIC_API_KEY") });
}
