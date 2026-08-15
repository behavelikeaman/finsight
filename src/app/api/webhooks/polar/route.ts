/**
 * POST /api/webhooks/polar — 구독 상태를 profiles에 반영한다.
 *
 * 1. **서명 검증이 최우선이다.** 검증 없이 처리하면 누구나 요청을 보내
 *    자신을 Pro로 만들 수 있다. 실패하면 401을 반환하고 아무것도 하지 않는다.
 * 2. **멱등하게 쓴다.** 이벤트의 최신 상태를 그대로 덮어쓰기만 하고,
 *    카운터를 올리거나 이벤트를 누적하지 않는다 — 중복 수신이 사고가 된다.
 * 3. **취소를 즉시 free로 내리지 않는다.** Polar는 해지 예약 상태에서도
 *    status를 active로 유지한다. 기간 만료 판정은 effective_tier DB 함수가
 *    current_period_end로 한다. 그래서 current_period_end를 null로 덮지 않는다.
 *
 * 웹훅에는 사용자 세션이 없으므로 service role 클라이언트를 쓴다.
 * 이 라우트와 billing/sync 외의 어떤 파일에서도 admin을 import 하지 마라.
 */
import { validateEvent } from "@polar-sh/sdk/webhooks";
import { NextResponse, type NextRequest } from "next/server";

import { serverEnv } from "@/lib/env";
import { createAdminSupabase } from "@/lib/supabase/admin";

/** 이 상태에서만 Pro 권리를 준다. */
const ENTITLED_STATUSES = new Set(["active", "trialing"]);

interface SubscriptionData {
  id: string;
  status: string;
  currentPeriodEnd: Date | null;
  customerId: string;
  metadata: Record<string, unknown>;
}

type AdminClient = ReturnType<typeof createAdminSupabase>;

export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = await request.text();

  const headers: Record<string, string> = {};
  request.headers.forEach((value, key) => {
    headers[key] = value;
  });

  let event: unknown;
  try {
    event = validateEvent(body, headers, serverEnv("POLAR_WEBHOOK_SECRET"));
  } catch {
    // 위조·변조·시크릿 미설정 — 어느 쪽이든 처리하지 않는다.
    return NextResponse.json({ ok: false }, { status: 401 });
  }

  const subscription = subscriptionFromEvent(event);
  if (!subscription) {
    // 구독과 무관한 이벤트는 조용히 ack 한다. 재전송을 유발할 이유가 없다.
    return NextResponse.json({ ok: true });
  }

  const admin = createAdminSupabase();
  const userId = await resolveUserId(admin, subscription);
  if (!userId) {
    return NextResponse.json({ ok: true });
  }

  const update: Record<string, string> = {
    tier: ENTITLED_STATUSES.has(subscription.status) ? "pro" : "free",
    polar_customer_id: subscription.customerId,
    polar_subscription_id: subscription.id,
  };

  // 이벤트가 기간을 실어 보낼 때만 쓴다. 없다고 null로 덮으면 이미 낸 기간의
  // 권리가 사라진다.
  const periodEnd = subscription.currentPeriodEnd;
  if (periodEnd) {
    update.current_period_end = periodEnd.toISOString();
  }

  await admin.from("profiles").update(update).eq("id", userId);

  return NextResponse.json({ ok: true });
}

const SUBSCRIPTION_EVENTS = new Set([
  "subscription.created",
  "subscription.active",
  "subscription.updated",
  "subscription.canceled",
  "subscription.uncanceled",
  "subscription.revoked",
]);

function subscriptionFromEvent(event: unknown): SubscriptionData | null {
  if (typeof event !== "object" || event === null) return null;

  const { type, data } = event as { type?: unknown; data?: unknown };
  if (typeof type !== "string" || !SUBSCRIPTION_EVENTS.has(type)) return null;
  if (typeof data !== "object" || data === null) return null;

  return data as SubscriptionData;
}

/**
 * 체크아웃 metadata.userId 가 1차 근거다. 없으면 polar_customer_id 로 찾는다
 * (갱신·해지 이벤트는 체크아웃을 거치지 않아 metadata가 비어 올 수 있다).
 */
async function resolveUserId(
  admin: AdminClient,
  subscription: SubscriptionData,
): Promise<string | null> {
  const fromMetadata = subscription.metadata?.["userId"];
  if (typeof fromMetadata === "string" && fromMetadata !== "") {
    return fromMetadata;
  }

  const { data } = await admin
    .from("profiles")
    .select("id")
    .eq("polar_customer_id", subscription.customerId)
    .maybeSingle();

  return (data as { id: string } | null)?.id ?? null;
}
