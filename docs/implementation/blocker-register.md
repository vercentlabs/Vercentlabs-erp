# Blocker register

| Id | Area | Status | Detail | Needed to unblock |
|---|---|---|---|---|
| B1 | Razorpay live/test checkout | BLOCKED_EXTERNAL | The test key pair supplied in chat was rejected by Razorpay ("Authentication failed"). `BILLING_CHECKOUT_ENABLED=false` in `apps/web/.env.local`. Adapter, signature checks, webhook, seat logic and tests exist; only live verification is missing. | A valid `rzp_test_` key id and secret from the Razorpay dashboard. Then: set both, run `node scripts/qa/razorpay-smoke.mjs`, set `BILLING_CHECKOUT_ENABLED=true`, restart, pay with a test card, register the webhook URL, schedule `/api/billing/retry`. |
| B2 | POS live payment providers | BLOCKED_EXTERNAL | Only the sandbox adapter is registered. No provider contract or credentials are available. Sandbox payments must stay labelled as sandbox. | Provider choice, merchant account, test keys, webhook secret. |
| B3 | Printers, scanners, bank and statutory interfaces | BLOCKED_EXTERNAL | Need physical devices or agency credentials. | Devices or approved test credentials. |
| B4 | Statutory payroll and tax correctness | NEEDS_PRODUCT_DECISION | Jurisdiction rules cannot be asserted from the UI or tests alone. | Verified rule tables from a compliance owner. |
| B5 | Secrets exposed in chat | ACTION_REQUIRED | The SMTP app password and Razorpay test secret were pasted into a conversation. | Rotate both. They are only in the gitignored `apps/web/.env.local`. |
