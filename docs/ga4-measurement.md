# GA4 measurement contract

The cabinet loads its GA4 measurement ID from `/cabinet/branding/analytics`.
Google Analytics and Google Ads use separate IDs (`G-…` versus `AW-…`).
Business events target the GA4 property; an enabled Google Ads tag does not receive them automatically.

## Events and interpretation

| Area | Events | Meaning |
| --- | --- | --- |
| Acquisition | `page_view`, `login_view`, `quick_purchase_view` | Masked SPA page views; administrative routes are excluded from manual tracking. |
| Account | `login_success`, `registration_requested`, `registration_verified` | Successful API responses for the supported authentication flows. |
| Trial | `trial_activated`, `trial_converted` | Trial creation and a paid purchase whose response explicitly indicates trial conversion. |
| Subscription | `subscription_purchase_view`, `subscription_renew_view`, `subscription_purchased`, `subscription_renewed` | Purchase/renewal views and successful balance purchases. Server `purchase_type` takes precedence; request `subscription_id` remains a fallback for older servers. |
| Landing checkout | `purchase_click`, `quick_purchase_started`, `quick_purchase_paid` | Submission, generated payment, and a paid/delivered status observed by the client. |
| Balance | `topup_view`, `topup_started`, `topup_paid` | Top-up view, generated payment/invoice and payment confirmation observed by the client. |
| Payment link | `payment_link_ready`, `payment_link_opened`, `payment_link_copied` | Generated URL/invoice, opening attempt and successful copy. None of these implies payment success. Repeated opening attempts count separately. |
| Device connection | `connection_view`, `connection_platform_selected`, `connection_app_selected`, `connection_download_clicked`, `connection_import_clicked`, `connection_link_copied`, `connection_qr_opened` | Instructions and user interactions. A download click is not a verified installation; an import click is not a verified VPN connection. |
| Add-ons/support | `traffic_purchased`, `devices_purchased`, `support_ticket_created` | Successful supported API responses. |

Device interactions carry only allowlisted `connection_platform` and `connection_app` categories; unknown/custom names become `other`. They never contain subscription URLs, QR contents, import links or app configuration. Manual page views mask private paths and strip query parameters other than supported campaign attribution parameters.

## GA4 property configuration

For PROOTY-TY property 558475181 / stream 16108106172:

- Measurement ID: `G-JLDW8X4W2B`; currency RUB; timezone Europe/Moscow.
- Event and user retention: 14 months; reset on new activity enabled.
- Key events: `subscription_purchased`, `subscription_renewed`, `quick_purchase_paid` (once per event), plus the standard `purchase` event reserved for future ecommerce integration.
- Event custom dimensions: `connection_platform`, `connection_app`.
- Enhanced measurement: scroll/video enabled; automatic history page changes, outbound links, forms, file downloads and site search disabled. Automatic history events previously included unmasked administrative/subscription routes; manual SPA tracking provides the masked views instead. Changing this setting does not remove previously collected history.
- Published report collection: **PROOTY-TY Cabinet**. Four overviews (business, acquisition, devices, retention), five custom event reports (purchases/renewals, top-ups, connections, registration/trials, add-ons/support) and standard acquisition/pages/technology reports.

## Coverage limits

This is browser analytics, not an accounting ledger. Payment confirmation depends on the browser observing a paid response or Telegram invoice callback. Closing the cabinet before confirmation, blockers, network failures and browser storage resets can lose or duplicate observations. Local payment polling deduplication is not server-wide exactly-once delivery. The Stars callback uses an invoice identity while payment detail polling uses a payment identity; these are not a shared server transaction key.

GA4 ecommerce revenue, refunds and server-side recurring charges are not integrated. The code does not send ecommerce `purchase` payloads with a stable `transaction_id`, `value`, `currency` and items. Balance top-ups must not also be counted as subscription revenue. A future server integration should use payment webhooks/committed subscription transactions, link consented client/session attribution, deduplicate retries and distinguish purchase, renewal, top-up and refund events.

The filtered event reports compare counts; they do not establish a sequential, user-level funnel. Retention cohorts require enough elapsed history. Custom dimensions and processed reports may take time to become available. The stream cannot reconstruct visits before installation.

## Validation

Run `npm test`, `npm run build`, `npm run lint` and `npm run format:check`. In production, verify the configured measurement ID and fresh events in GA4 Realtime/DebugView using ordinary navigation; do not manufacture successful payment events. Actual end-to-end purchase verification requires a real payment/balance change and is outside the non-transactional audit.

Google documents processing delays of up to 24–48 hours: https://support.google.com/analytics/answer/11198161 . A warning about no received data may lag behind verified realtime/report data. “Connected: 0” refers to additional connected tags, not whether the primary GA4 tag is installed; a Measurement Protocol secret is only needed for a server sender.
