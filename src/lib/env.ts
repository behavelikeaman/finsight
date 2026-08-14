/**
 * 서버 전용 환경변수 접근자.
 *
 * 모듈 최상단에서 process.env를 읽지 마라. 로드 시점에 읽으면 키가 없는
 * CI/빌드 환경에서 빌드가 통째로 깨진다. 반드시 호출 시점에 읽는다.
 *
 * NEXT_PUBLIC_* 는 여기 두지 않는다 — 클라이언트에서 직접 참조한다.
 */
export type ServerEnvKey =
  | "SUPABASE_SERVICE_ROLE_KEY"
  | "ANTHROPIC_API_KEY"
  | "POLAR_ACCESS_TOKEN"
  | "POLAR_WEBHOOK_SECRET"
  | "POLAR_PRO_PRODUCT_ID"
  | "POLAR_SERVER";

export function serverEnv(key: ServerEnvKey): string {
  const value = process.env[key];

  if (value === undefined || value.trim() === "") {
    throw new Error(
      `환경변수 ${key}가 설정되지 않았습니다. .env.example을 참고해 .env.local에 값을 채우세요.`,
    );
  }

  return value;
}
