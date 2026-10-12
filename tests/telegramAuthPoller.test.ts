import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTelegramAuthPoller } from '../src/utils/telegramAuthPoller';

function httpError(status?: number, retryAfter?: string) {
  return {
    isAxiosError: true,
    response: status ? { status, headers: { 'retry-after': retryAfter } } : undefined,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(Date.UTC(2026, 9, 12));
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function setup(expiresInSeconds = 300) {
  const poll = vi.fn<(signal: AbortSignal) => Promise<void>>().mockRejectedValue(httpError(202));
  const onSuccess = vi.fn();
  const onExpired = vi.fn();
  const onError = vi.fn();
  const poller = createTelegramAuthPoller({
    expiresInSeconds,
    poll,
    onSuccess,
    onExpired,
    onError,
  });
  return { poller, poll, onSuccess, onExpired, onError };
}

describe('Telegram sign-in polling', () => {
  it('treats pending as pending, and finishes exactly once after confirmation', async () => {
    const s = setup();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.onSuccess).not.toHaveBeenCalled();
    s.poll.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(2500);
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.poll).toHaveBeenCalledTimes(2);
    expect(s.onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([undefined, 500, 502, 503])(
    'recovers from transport/server failure %s without losing the token',
    async (status) => {
      const s = setup();
      s.poll.mockRejectedValueOnce(httpError(status)).mockResolvedValue(undefined);
      await vi.advanceTimersByTimeAsync(2500);
      expect(s.onSuccess).toHaveBeenCalledTimes(1);
      expect(s.onError).not.toHaveBeenCalled();
    },
  );

  it('expires on the server deadline and never loops indefinitely while offline', async () => {
    const s = setup(10);
    s.poll.mockRejectedValue(httpError());
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.onExpired).toHaveBeenCalledTimes(1);
    expect(s.onError).not.toHaveBeenCalled();
    expect(s.poll.mock.calls.length).toBeLessThan(6);
  });

  it('allows a fresh independent attempt after the previous link expired', async () => {
    const old = setup();
    old.poll.mockRejectedValue(httpError(410));
    await vi.advanceTimersByTimeAsync(0);
    const fresh = setup();
    fresh.poll.mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(0);
    expect(old.onExpired).toHaveBeenCalledTimes(1);
    expect(fresh.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not overlap requests when online/focus/visibility events arrive together', async () => {
    const s = setup();
    let reject!: (value: unknown) => void;
    s.poll.mockImplementationOnce(
      () =>
        new Promise((_, r) => {
          reject = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    s.poller.resume();
    s.poller.resume();
    s.poller.resume();
    expect(s.poll).toHaveBeenCalledTimes(1);
    reject(httpError(202));
    await vi.advanceTimersByTimeAsync(0);
    expect(s.poll).toHaveBeenCalledTimes(2);
    s.poller.stop();
  });

  it('checks immediately when the user returns from Telegram', async () => {
    const s = setup();
    await vi.advanceTimersByTimeAsync(0);
    s.poll.mockResolvedValue(undefined);
    s.poller.resume();
    await vi.advanceTimersByTimeAsync(0);
    expect(s.onSuccess).toHaveBeenCalledTimes(1);
  });

  it('honors Retry-After even when focus events fire repeatedly', async () => {
    const s = setup();
    s.poll.mockRejectedValueOnce(httpError(429, '30')).mockResolvedValue(undefined);
    await vi.advanceTimersByTimeAsync(0);
    s.poller.resume();
    s.poller.resume();
    await vi.advanceTimersByTimeAsync(29999);
    expect(s.poll).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(s.onSuccess).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403])(
    'stops on terminal rejection %s without bypassing it',
    async (status) => {
      const s = setup();
      s.poll.mockRejectedValue(httpError(status));
      await vi.advanceTimersByTimeAsync(60000);
      expect(s.poll).toHaveBeenCalledTimes(1);
      expect(s.onError).toHaveBeenCalledTimes(1);
      expect(s.onSuccess).not.toHaveBeenCalled();
    },
  );

  it('aborts and ignores late results after unmount or a new sign-in attempt', async () => {
    const s = setup();
    let resolve!: () => void;
    s.poll.mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    await vi.advanceTimersByTimeAsync(0);
    const signal = s.poll.mock.calls[0][0];
    s.poller.stop();
    expect(signal.aborted).toBe(true);
    resolve();
    await vi.advanceTimersByTimeAsync(60000);
    expect(s.onSuccess).not.toHaveBeenCalled();
    expect(s.onExpired).not.toHaveBeenCalled();
  });
});
