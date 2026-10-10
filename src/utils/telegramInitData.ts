import { retrieveRawInitData } from '@telegram-apps/sdk-react';

// Telegram's bridge and the SDK can retain different launches in iOS/macOS
// WebViews. Select the freshest payload without modifying its signed contents.
export function getTelegramInitData(): string | null {
  if (typeof window === 'undefined') return null;

  const candidates = [fromTelegramBridge(), fromSdk()].filter((value): value is string =>
    Boolean(value),
  );
  if (candidates.length === 0) return null;

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
