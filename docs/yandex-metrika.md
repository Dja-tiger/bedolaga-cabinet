# Yandex Metrika events

The counter ID is read from the branding API. `useAnalyticsCounters` initializes
the configured counter and sends a manual `hit` for the first page and each SPA
pathname change. `defer: true` suppresses the automatic initial view.

Existing Yandex ClientID caching/synchronization and landing-specific goals are
preserved. Google Ads initialization is unchanged.

## JavaScript goals

Configure each goal as a JavaScript event with the exact identifier below. The
tracking code does not create goals or dashboards; those are counter settings.

| Identifier | Trigger |
| --- | --- |
| `login_success` | Successful supported login response containing access/refresh tokens and user; excludes token refresh. |
| `registration_requested` | Standalone email registration accepted. |
| `registration_verified` | Email verification returns an authenticated user. |
| `trial_activated` | Trial API returns a trial subscription. |
| `subscription_purchased` | Classic or new tariff purchase returns `success: true`; excludes targeted tariff renewals. |
| `trial_converted` | Classic purchase also returns `was_trial_conversion: true`. |
| `subscription_renewed` | Renewal API returns the new end date, or a successful tariff purchase targets an existing `subscription_id` (excluding trial conversion). |
| `traffic_purchased` | Traffic purchase API returns added GB. |
| `devices_purchased` | Device purchase API returns `success: true`. |
| `support_ticket_created` | Ticket creation API returns an ID. |
| `topup_started` | Top-up API returns a payment link, or Stars API returns an invoice. |
| `topup_paid` | Payment status confirms payment, or Telegram Stars invoice callback reports `paid`. |
| `quick_purchase_started` | Landing purchase API returns a purchase token and payment link. |
| `quick_purchase_paid` | Landing status/activation reports `paid`, `delivered` or `pending_activation`. |
| `login_view` | `/login` viewed. |
| `subscription_purchase_view` | `/subscription/purchase` viewed. |
| `subscription_renew_view` | `/subscriptions/:id/renew` viewed. |
| `topup_view` | `/balance/top-up` viewed. |
| `connection_view` | Connection instructions viewed; does not prove VPN connectivity. |
| `quick_purchase_view` | `/buy/:slug` viewed; excludes success and gift-claim pages. |

Responses outside the explicit endpoint allowlist, failed HTTP responses and
`success: false` responses do not generate business events. API bodies and token
values are not sent as goal parameters.

## Counting and URL handling

Manual page views mask subscription/ticket IDs, purchase/gift/merge tokens and
remove queries except five constrained UTM fields. Admin paths are omitted from
manual page views. The existing Webvisor/link tracking settings remain enabled;
they are separate automatic collection mechanisms.

Page-view deduplication uses the original pathname locally, so different
subscription IDs or landing slugs still produce separate views even when their
sent URLs are identical. Only the masked URLs are sent as views and referrers.

Early events wait for the first page view, with a bounded queue and a 60-second
expiry. Payment confirmations are deduplicated using local SHA-256 identifiers;
raw identifiers and hashes are not sent as goal parameters. Deduplication is
per browser, not server-wide, and local records are pruned on subsequent writes.

Client events may be absent if the user closes the page, does not return from a
payment provider or blocks analytics. They are not the source of truth for
revenue. Top-ups and subscription purchases must not be summed as two revenues.
Check server-side/offline conversion configuration before combining it with
these new client goals.

## Validation and rollout

- `npm run test:analytics` runs the focused Vitest regression test.
- `npm test` includes it in the existing CI test suite.
- `npm run lint`, `npm run format:check` and `npm run build` cover CI checks.

After deploying the frontend, verify SPA navigation and supported actions on a
test account with the configured counter. Use confirmed real payment statuses
to reconcile goals with backend records; a created invoice is not a payment.
New goals collect only future events; old events cannot be backfilled by this
frontend change.
