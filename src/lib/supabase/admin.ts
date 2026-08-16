// 이 클라이언트는 RLS를 우회한다.
// 사용처는 두 곳뿐이다 — 둘 다 Polar 구독 상태를 profiles에 반영하는 경로다:
//   src/app/api/webhooks/polar/route.ts
//   src/app/api/billing/sync/route.ts
// 그 외 어디서도 import 하지 마라. 두 곳에서도 profiles의
// tier·current_period_end·polar_* 외의 컬럼·테이블은 건드리지 않는다.
import { createClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env";

/**
 * service role 클라이언트.
 *
 * 키는 모듈 로드 시점이 아니라 호출 시점에 읽는다 — 로드 시점에 읽으면
 * 키가 없는 CI/빌드 환경에서 빌드가 통째로 깨진다.
 */
export function createAdminSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;

  if (!url) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL이 설정되지 않았습니다.");
  }

  return createClient(url, serverEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
