import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * 세션 쿠키 갱신.
 *
 * @supabase/ssr 은 미들웨어가 토큰을 갱신하는 것을 전제로 한다. 이게 없으면
 * Server Component가 만료된 세션을 보게 된다.
 *
 * 여기서 익명 로그인을 호출하지 마라. 이 파일은 모든 요청에 걸리므로 랜딩을
 * 스쳐간 크롤러까지 auth.users 행을 만든다. 세션 생성은 파일 드롭
 * 시점(src/lib/supabase/auth.ts 의 ensureSession)에만 한다.
 */
export async function proxy(request: NextRequest): Promise<NextResponse> {
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // 키가 없는 환경(빌드·프리뷰)에서 모든 요청을 500으로 만들지 않는다.
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        // 요청 쿠키를 반영한 응답을 새로 만든 뒤, 갱신된 쿠키를 응답에도 심는다.
        // 이 두 번째 심기를 빠뜨리면 브라우저가 갱신된 토큰을 받지 못한다.
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  await supabase.auth.getUser();

  return response;
}

export const config = {
  matcher: [
    // 정적 자산·이미지·favicon 제외
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
  ],
};
