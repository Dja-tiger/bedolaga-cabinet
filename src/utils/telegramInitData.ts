import { retrieveRawInitData } from '@telegram-apps/sdk-react';

const MAX_AUTH_AGE_SECONDS = 30 * 86400;
const MAX_CLOCK_SKEW_SECONDS = 300;

// This is a recovery hint, not authentication. The server still verifies the signature and age.
export function needsTelegramAuthRecovery(initData: string | null, now = Date.now()): boolean {
  if (!initData) return true;
  const params = new URLSearchParams(initData);
  const authDate = authDateOf(initData);
  const age = now / 1000 - authDate;
  return (
    !params.get('hash') ||
    !userIdOf(initData) ||
    !Number.isInteger(authDate) ||
    authDate <= 0 ||
    age > MAX_AUTH_AGE_SECONDS ||
    age < -MAX_CLOCK_SKEW_SECONDS
  );
}

// Telegram's bridge and the SDK can retain different launches in iOS/macOS
// WebViews. Select the freshest payload without modifying its signed contents.
export function getTelegramInitData(): string | null {
  if (typeof window === 'undefined') return null;

  const candidates = [fromTelegramBridge(), fromSdk()].filter((value): value is string =>
    Boolean(value),
  );
  if (candidates.length === 0) return null;

  // A cached SDK launch from another account must not win by timestamp.
  if (candidates.length === 2) {
    const bridgeUser = userIdOf(candidates[0]);
    const sdkUser = userIdOf(candidates[1]);
    if (bridgeUser && sdkUser && bridgeUser !== sdkUser) return candidates[0];
  }

  // Prefer the bridge when timestamps are equal or cannot be parsed.
  return candidates.reduce((best, candidate) =>
    authDateOf(candidate) > authDateOf(best) ? candidate : best,
  );
}

function fromTelegramBridge(): string | null {
  return window.Telegram?.WebApp?.initData || null;
}

function fromSdk(): string | null {
  try {
    return retrieveRawInitData() || null;
  } catch {
    return null;
  }
}

function authDateOf(initData: string): number {
  const raw = new URLSearchParams(initData).get('auth_date');
  const parsed = Number(raw);
  return raw && Number.isFinite(parsed) ? parsed : 0;
}

function userIdOf(initData: string): string | null {
  try {
    const raw = new URLSearchParams(initData).get('user');
    const id = raw ? JSON.parse(raw).id : null;
    return Number.isSafeInteger(id) && id > 0 ? String(id) : null;
  } catch {
    return null;
  }
}
