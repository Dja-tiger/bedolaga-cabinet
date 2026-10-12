import { isAxiosError } from 'axios';

interface TelegramAuthPollerOptions {
  expiresInSeconds: number;
  poll: (signal: AbortSignal) => Promise<void>;
  onSuccess: () => void;
  onExpired: () => void;
  onError: () => void;
}

export function createTelegramAuthPoller(options: TelegramAuthPollerOptions) {
  const controller = new AbortController();
  const ttl =
    Number.isFinite(options.expiresInSeconds) && options.expiresInSeconds > 0
      ? options.expiresInSeconds
      : 300;
  const expiresAt = Date.now() + ttl * 1000;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;
  let inFlight = false;
  let resumeRequested = false;
  let failures = 0;
  let blockedUntil = 0;

  const stop = () => {
    stopped = true;
    clearTimeout(timer);
    controller.abort();
  };

  const expire = () => {
    stop();
    options.onExpired();
  };

  const schedule = (delay: number) => {
    clearTimeout(timer);
    timer = setTimeout(() => void poll(), Math.min(delay, Math.max(0, expiresAt - Date.now())));
  };

  const poll = async () => {
    if (stopped) return;
    if (inFlight) {
      resumeRequested = true;
      return;
    }
    if (Date.now() >= expiresAt) {
      expire();
      return;
    }
    if (Date.now() < blockedUntil) {
      schedule(blockedUntil - Date.now());
      return;
    }
    clearTimeout(timer);
    inFlight = true;
    let delay: number | undefined;
    try {
      await options.poll(controller.signal);
      if (!stopped) {
        stop();
        options.onSuccess();
      }
    } catch (error) {
      if (stopped) return;
      const status = isAxiosError(error) ? error.response?.status : undefined;
      if (status === 410 || Date.now() >= expiresAt) {
        expire();
      } else if (status === 202) {
        failures = 0;
        delay = 2500;
      } else if (isAxiosError(error) && (!status || status === 429 || status >= 500)) {
        failures += 1;
        const retryAfter = Number(error.response?.headers?.['retry-after']);
        delay =
          status === 429
            ? Math.max(5000, Number.isFinite(retryAfter) ? retryAfter * 1000 : 15000)
            : Math.min(15000, 2500 * 2 ** Math.min(failures - 1, 3));
        if (status === 429) blockedUntil = Date.now() + delay;
      } else {
        stop();
        options.onError();
      }
    } finally {
      inFlight = false;
      if (!stopped && delay !== undefined) {
        schedule(resumeRequested && failures === 0 ? 0 : delay);
        resumeRequested = false;
      }
    }
  };

  schedule(0);
  return { stop, resume: () => void poll() };
}
