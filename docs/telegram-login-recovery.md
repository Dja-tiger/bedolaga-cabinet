# Telegram login recovery

## Incident

On 2026-10-12 a Telegram WebView reused approximately 90-day-old initData.
The backend correctly rejected it against its 30-day age limit. Choosing the
newest bridge/SDK payload cannot help when both contain an expired launch.
Retrying that same signed payload is not a refresh.

## Recovery contract

- Try a usable existing cabinet session before Telegram login.
- Choose the newest bridge/SDK launch for the same Telegram account. If their
  user IDs disagree, do not substitute another account's cached SDK launch.
- Missing, malformed, expired or rejected launch data opens bot confirmation
  instead of repeatedly sending the same initData.
- Keep the QR code visible at 128 px on mobile and 160 px on desktop; place the
  bot button first. The manual command remains an emergency fallback.
- Use the existing one-time bot confirmation flow. Signature/age validation,
  explicit confirmation, token TTL and atomic consumption remain server-enforced.
- Poll serially with cancellation, transient-error backoff, Retry-After handling,
  a deadline and immediate checking when returning from Telegram. An expired
  link requires an explicit retry, not an endless stream of new tokens.
- Network failures, 429 and 5xx are not rejected credentials. Preserve refresh
  tokens and retry unfinished session bootstrap. Always stop its loader.
- Bound CloudStorage operations. Ignore refresh, login, cloud and authenticated
  API responses from a session that was logged out or replaced while awaiting.
- Treat browser persistence as best effort; blocked storage must not prevent
  a login within the current page. Persistence across reloads cannot be promised
  when the browser and Telegram refuse to store credentials.

## Verification and deployment

Run `npm test`, `npm run type-check`, `npm run lint`, `npm run format:check` and
`npm run build`. Regression tests cover expiry boundaries, account conflicts,
polling failures/cancellation, bootstrap retries, session races and blocked
storage. Browser verification must cover phone and desktop sizes, a 90-day-old
launch, a fresh launch, a server-rejected launch, offline polling, link renewal,
token-request retries and preservation of an existing session after 5xx.

Deploy only the cabinet for this change. Back up the current source/configuration
and image; build the reviewed commit with the production Compose arguments
before replacing the running container. Keep previous hashed assets alongside
new assets so already open pages can still fetch lazy chunks. Never overwrite
new assets with old files of the same name. HTML is served with `no-store`.
Verify current and retained assets, health, configuration and unchanged backend
container IDs; retain a rollback image. Test a real Telegram confirmation as a
separate check: mocked browser tests do not prove a live Telegram exchange.

Telegram, network or backend downtime can still prevent authentication. This
recovery removes the identified dead ends without bypassing authentication.
