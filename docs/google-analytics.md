# Google Analytics 4

Deploy the backend with the `google_analytics_id` branding setting before enabling GA4 in the cabinet. The backend stores it as `CABINET_GOOGLE_ANALYTICS_ID` in the existing system settings table; no migration or API secret is needed. Older backend responses without this field leave GA4 disabled.

In **Admin → Settings → Analytics → Google Analytics 4**, enter the web stream's Measurement ID (`G-…`). For PROOTY-TY Cabinet this is `G-JLDW8X4W2B`; `16108106172` is the numeric stream ID and cannot be used here. Google Ads uses its own `AW-…` setting. Clear the GA4 field to disable GA4; Yandex Metrika can run alongside it or be disabled separately.

## Web stream settings

In Google Analytics → Admin → Data streams → your web stream → Enhanced measurement → Page views → advanced settings, disable **Page changes based on browser history events**. The cabinet sends its own initial and SPA page views with masked routes. `send_page_view: false` disables the initial config view but does not disable enhanced history tracking; leaving that enabled can produce duplicate views with original URLs. For strict control of all collected URLs and parameters, disable Enhanced measurement entirely: automatic outbound-click and form events can contain original links/fields that the cabinet's masking does not cover.

See [Google's manual page-view guidance](https://developers.google.com/analytics/devguides/collection/ga4/views).

## Events

Business events follow successful API responses, rather than button clicks. Purchases and renewals use separate event names:

| Event | Meaning |
| --- | --- |
| `subscription_purchased` | New subscription or conversion from a trial |
| `subscription_renewed` | Renewal, including tariff purchase with `subscription_id` |
| `trial_activated`, `trial_converted` | Trial lifecycle |
| `topup_started`, `topup_paid` | Payment link/invoice created and payment confirmed |
| `quick_purchase_started`, `quick_purchase_paid` | Landing checkout created and paid |
| `traffic_purchased`, `devices_purchased` | Add-ons purchased |
| `registration_requested`, `registration_verified`, `login_success` | Authentication funnel |
| `support_ticket_created` | Ticket created |

Page funnel events: `login_view`, `subscription_purchase_view`, `subscription_renew_view`, `topup_view`, `connection_view`, `quick_purchase_view`.

Events are explicitly routed to the current GA4 Measurement ID, using the same Google tag loader as Ads. Repeated payment polling is deduplicated locally per browser and GA4 property. Tokens and payment identities are hashed only for local deduplication; neither those tokens nor their hashes are sent as event parameters. Manual page views exclude admin routes and mask purchase tokens, landing slugs and numeric subscription/ticket IDs. Only the five allowlisted UTM query fields are retained.

These are custom events, not GA4 ecommerce `purchase` events. No revenue or transaction IDs are fabricated, and browser events do not cover payments made entirely through the Telegram bot or backend offline conversions.

## Verify after deployment

1. Save the Measurement ID, reload the cabinet and inspect **Realtime** in GA4.
2. Navigate between cabinet screens; expect one manual `page_view` per route visit, including visits to distinct subscriptions whose IDs are masked.
3. Verify a new purchase and a renewal produce their respective events. A failed response must produce neither.
4. Mark the desired business events as key events in GA4. Build separate purchase and renewal funnels using the event names above.
5. For request-level checks, use Google Tag Assistant or browser network tools and confirm event destination, masked URL and absence of authentication/payment tokens.

Tests: `npm run test:analytics` covers the Yandex and Google adapters and the shared response rules. Browser blockers or missing analytics settings must not interrupt checkout.
