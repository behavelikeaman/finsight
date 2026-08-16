/**
 * Polar(Merchant of Record) 래퍼. ADR-005·ADR-020.
 *
 * 라우트 핸들러는 SDK를 직접 다루지 않고 이 파일만 호출한다.
 * 토큰·상품 ID·서버 구분은 모듈 로드 시점이 아니라 **호출 시점**에 읽는다
 * (src/lib/env.ts) — 로드 시점에 읽으면 키가 없는 빌드 환경이 통째로 깨진다.
 */
import { Polar } from "@polar-sh/sdk";

import { serverEnv } from "@/lib/env";

interface SubscriptionState {
  status: string;
  /** ISO 8601. 구독이 기간을 갖지 않으면 null */
  currentPeriodEnd: string | null;
}

function getClient(): Polar {
  // production 이외의 값은 전부 sandbox로 닫는다. 오타 하나로 운영 결제가
  // 샌드박스로 새거나 그 반대가 되는 것보다, 명시적으로 적었을 때만 여는 편이 낫다.
  const server = serverEnv("POLAR_SERVER") === "production" ? "production" : "sandbox";

  return new Polar({ accessToken: serverEnv("POLAR_ACCESS_TOKEN"), server });
}

/**
 * 체크아웃 세션을 만든다.
 *
 * metadata.userId 를 반드시 넣는다 — 웹훅에는 사용자 세션이 없으므로 이 값이
 * 어느 사용자의 결제인지 판정하는 1차 근거가 된다.
 */
export async function createCheckout(params: {
  userId: string;
  email?: string;
  successUrl: string;
}): Promise<{ url: string }> {
  const checkout = await getClient().checkouts.create({
    products: [serverEnv("POLAR_PRO_PRODUCT_ID")],
    successUrl: params.successUrl,
    customerEmail: params.email ?? null,
    metadata: { userId: params.userId },
  });

  return { url: checkout.url };
}

interface CheckoutState {
  status: string;
  customerId: string | null;
  /** 첫 결제 직후에는 아직 비어 있을 수 있다. */
  subscriptionId: string | null;
  /** 체크아웃을 만든 사용자. 소유자 검증의 근거다. */
  userId: string | null;
}

/**
 * 체크아웃 하나를 조회한다.
 *
 * 결제 복귀 직후에는 profiles에 polar_* 가 아직 비어 있다 — 그 값은 웹훅이
 * 채우기 때문이다. 그래서 첫 결제는 체크아웃 자체를 근거로 삼아야 한다.
 *
 * userId는 우리가 createCheckout에서 심은 metadata다. 호출부는 이 값이 세션
 * 사용자와 같은지 반드시 확인해야 한다 — 확인 없이 쓰면 남의 체크아웃 ID로
 * 자기 계정을 Pro로 만들 수 있다.
 */
export async function fetchCheckout(
  checkoutId: string,
): Promise<CheckoutState> {
  const checkout = await getClient().checkouts.get({ id: checkoutId });

  const userId = checkout.metadata?.["userId"];

  return {
    status: checkout.status,
    customerId: checkout.customerId ?? null,
    subscriptionId: checkout.subscriptionId ?? null,
    userId: typeof userId === "string" && userId !== "" ? userId : null,
  };
}

/**
 * 고객 포털 세션을 만든다. 반환 URL에는 1회용 토큰이 박혀 있다.
 *
 * 해지·카드 교체·영수증은 전부 이 포털에서 처리한다. 결제 수단을 우리가
 * 다루지 않는 것이 Merchant of Record를 쓰는 이유다(ADR-005).
 * URL은 토큰을 포함하므로 저장하거나 로그에 남기지 마라.
 */
export async function createCustomerPortalSession(
  customerId: string,
): Promise<{ url: string }> {
  const session = await getClient().customerSessions.create({ customerId });

  return { url: session.customerPortalUrl };
}

/** 구독 ID를 아는 경우. billing/sync 가 Polar의 최신 상태를 직접 확인한다. */
export async function fetchSubscription(
  subscriptionId: string,
): Promise<SubscriptionState> {
  const subscription = await getClient().subscriptions.get({
    id: subscriptionId,
  });

  return {
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
  };
}

/**
 * 구독 ID는 모르고 고객 ID만 아는 경우.
 * 활성 구독만 조회한다 — 만료·해지 완료된 과거 구독으로 Pro를 열면 안 된다.
 */
export async function fetchCustomerSubscription(
  customerId: string,
): Promise<(SubscriptionState & { subscriptionId: string }) | null> {
  const page = await getClient().subscriptions.list({
    customerId,
    active: true,
  });

  const subscription = page.result.items[0];
  if (!subscription) return null;

  return {
    subscriptionId: subscription.id,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
  };
}
