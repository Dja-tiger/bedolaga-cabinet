// Only canonical page names reach analytics providers. Auth/payment tokens, ids and queries do not.
export function analyticsPath(pathname: string): string | null {
  if (pathname.startsWith('/admin')) return null;
  return pathname
    .replace(/\/buy\/success\/[^/]+/g, '/buy/success/_purchase')
    .replace(/\/buy\/gift\/[^/]+/g, '/buy/gift/_gift')
    .replace(/\/buy\/[^/]+/g, (path) =>
      ['/buy/success', '/buy/gift'].includes(path) ? path : '/buy/_landing',
    )
    .replace(/\/merge\/[^/]+/g, '/merge/_account')
    .replace(/\/(subscriptions|subscription|support(?:\/tickets)?)\/\d+/g, '/$1/_item');
}

export function safeReferrer(referrer: string): string {
  try {
    const url = new URL(referrer);
    return url.origin + (analyticsPath(url.pathname) ?? '/');
  } catch {
    return '';
  }
}

export const pageGoals: [RegExp, string][] = [
  [/^\/login$/, 'login_view'],
  [/^\/subscription\/purchase$/, 'subscription_purchase_view'],
  [/^\/subscriptions\/_item\/renew$/, 'subscription_renew_view'],
  [/^\/balance\/top-up$/, 'topup_view'],
  [/^\/connection(?:\/|$)/, 'connection_view'],
  [/^\/buy\/_landing$/, 'quick_purchase_view'],
];

export function analyticsUrl(path: string): string {
  const query = new URLSearchParams();
  const input = new URLSearchParams(location.search);
  for (const key of ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term']) {
    const value = input.get(key);
    if (value && /^[\p{L}\p{N}_ .-]{1,100}$/u.test(value)) query.set(key, value);
  }
  return location.origin + path + (query.size ? '?' + query.toString() : '');
}
