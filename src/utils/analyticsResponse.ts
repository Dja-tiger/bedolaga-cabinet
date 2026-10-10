import { trackGoal, trackGoalOnce } from './metrika';
import { isPaidStatus } from './paymentStatus';

interface AnalyticsResponse {
  status: number;
  config: { url?: string; method?: string; data?: unknown };
  data: unknown;
}

function isTariffRenewal(requestData: unknown): boolean {
  // Axios serializes JSON bodies before the response interceptor runs.
  try {
    const body: unknown = typeof requestData === 'string' ? JSON.parse(requestData) : requestData;
    if (!body || typeof body !== 'object' || !('subscription_id' in body)) return false;
    return (
      typeof body.subscription_id === 'number' &&
      Number.isSafeInteger(body.subscription_id) &&
      body.subscription_id > 0
    );
  } catch {
    return false;
  }
}

// Explicit endpoint allowlist. Never forward request bodies or response objects to analytics.
export function trackAnalyticsResponse(response: AnalyticsResponse): void {
  if (response.status < 200 || response.status >= 300) return;
  const path = response.config.url?.split('?')[0] ?? '';
  const method = response.config.method?.toLowerCase();
  const data = response.data as Record<string, unknown> | null;
  if (!data || typeof data !== 'object' || data.success === false) return;
  const post = method === 'post';
  const authPath =
    /^\/cabinet\/auth\/(telegram(?:\/widget|\/oidc)?|email\/login|email\/verify|oauth\/[^/]+\/callback|deeplink\/poll|login\/auto)$/;
  if (post && authPath.test(path) && data.access_token && data.refresh_token && data.user) {
    trackGoal('login_success');
    if (path.endsWith('/email/verify')) trackGoal('registration_verified');
  }
  if (
    post &&
    path === '/cabinet/auth/email/register/standalone' &&
    typeof data.requires_verification === 'boolean'
  )
    trackGoal('registration_requested');
  if (post && path === '/cabinet/subscription/trial' && data.id && data.is_trial === true)
    trackGoal('trial_activated');
  if (
    post &&
    ['/cabinet/subscription/purchase', '/cabinet/subscription/purchase-tariff'].includes(path) &&
    data.success === true
  ) {
    const renewal =
      path === '/cabinet/subscription/purchase-tariff' &&
      isTariffRenewal(response.config.data) &&
      data.was_trial_conversion !== true;
    trackGoal(renewal ? 'subscription_renewed' : 'subscription_purchased');
    if (data.was_trial_conversion === true) trackGoal('trial_converted');
  }
  if (post && path === '/cabinet/subscription/renew' && data.new_end_date)
    trackGoal('subscription_renewed');
  if (post && path === '/cabinet/subscription/traffic' && typeof data.gb_added === 'number')
    trackGoal('traffic_purchased');
  if (post && path === '/cabinet/subscription/devices/purchase' && data.success === true)
    trackGoal('devices_purchased');
  if (post && path === '/cabinet/tickets' && data.id) trackGoal('support_ticket_created');
  if (
    post &&
    path === '/cabinet/balance/topup' &&
    data.payment_id &&
    (data.payment_url || data.invoice_url)
  )
    trackGoal('topup_started');
  if (post && path === '/cabinet/balance/stars-invoice' && data.invoice_url)
    trackGoal('topup_started');
  if (
    post &&
    /^\/cabinet\/landing\/[^/]+\/purchase$/.test(path) &&
    data.purchase_token &&
    data.payment_url
  )
    trackGoal('quick_purchase_started');
  if (/^\/cabinet\/balance\/pending-payments\/[^/]+\/(?:\d+|latest)(?:\/check)?$/.test(path)) {
    const payment = (data.payment ?? data) as Record<string, unknown>;
    if (
      payment.id &&
      (payment.is_paid === true ||
        (typeof payment.status === 'string' && isPaidStatus(payment.status)))
    ) {
      void trackGoalOnce(
        'topup_paid',
        'topup:' + String(payment.method) + ':' + String(payment.id),
      );
    }
  }
  if (
    /^\/cabinet\/landing\/(?:purchase|activate)\/[^/]+$/.test(path) &&
    ['paid', 'delivered', 'pending_activation'].includes(String(data.status))
  ) {
    void trackGoalOnce('quick_purchase_paid', path.split('/').pop() ?? '');
  }
}
