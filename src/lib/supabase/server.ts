import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

/**
 * 서버용 Supabase 클라이언트. Server Component와 라우트 핸들러 양쪽에서 쓴다.
 *
 * anon 키 + 사용자 쿠키로 동작하므로 RLS가 그대로 적용된다.
 * RLS를 넘어야 하는 경우는 admin.ts 하나뿐이고, 그 사용처는 웹훅으로 제한된다.
 */
export async function createServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL 또는 NEXT_PUBLIC_SUPABASE_ANON_KEY가 설정되지 않았습니다.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Component에서는 쿠키를 쓸 수 없다. 세션 갱신은 미들웨어가
          // 이미 하고 있으므로 여기서 실패해도 무시한다.
        }
      },
    },
  });
}
