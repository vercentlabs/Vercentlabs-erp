# POS Completion Program — Prompt 2 Handoff

Written for a fresh Claude Code session with no access to this session's conversation. Read this document fully before doing anything else. Also read `docs/03-modules/point-of-sale/POS_COMPLETION_PROMPT1_HANDOFF.md` — this document assumes you have.

## 1. Baseline and ending state

- **Prompt 1 handoff location**: `docs/03-modules/point-of-sale/POS_COMPLETION_PROMPT1_HANDOFF.md` (already existed at the start of this session).
- **Starting local branch/SHA**: `main` @ `6e75b9197c70dfb32222688030a02d14b292a9cf` — exactly Prompt 1's own ending SHA, confirmed via `git rev-parse HEAD` before any Prompt 2 work began. 7 commits ahead of `origin/main` at that point (Prompt 1's work, not yet pushed).
- **Mid-session**: the user explicitly authorized committing and pushing everything accumulated in this engagement so far (both this program's work and unrelated earlier-session work sitting uncommitted). All of it was committed in logically-grouped commits and pushed to `origin/main`. See §4 for the full commit list — Prompt 2's own work is commits `e89dd459` through `e73ab648`; everything before that on the list is unrelated prior work from this same overall engagement, pushed at the same time because the user asked for all of it.
- **Ending branch/SHA**: `main` @ `e73ab6481d92825e688c93060eed00111d54cf18`, pushed to `origin/main`, fast-forward, no divergence, no force-push used anywhere.
- **Local commits created this session (Prompt 2's own scope)**: 4 — `e89dd459`, `744d398d`, `60221917`, `e73ab648`. (The other 5 commits between Prompt 1's SHA and Prompt 2's first commit are unrelated earlier-session work the user asked to be committed/pushed at the same time — self-serve registration, a shared platform-layer pg-concurrency fix, visual alignment fixes, an icon tooltip feature, and shared-platform E2E/accessibility coverage. None of it touches POS.)

## 2. Critical correction Prompt 2 inherited from Prompt 1 — still true

Prompt 1's own handoff already corrected the original program brief's premise: most of POS Groups A-E were already built by five prior sessions before Prompt 1 even started. **This remains true for Prompt 2's own assigned groups too.** Payments (F282-F286), returns/refunds/exchanges (F291-F293), stock integration (F294-F296), offline sync (F297-F298), day-end/reconciliation (F303-F304), loyalty (F306) and analytics (F307) were **already implemented and already had passing real-Postgres test suites** before this session started — confirmed by reading the actual code (not just the tracker) and by running the existing suites, all green, before making any change.

**Prompt 2's real, high-value work this session was therefore: (1) find and fix the specific, concretely-disclosed defects Prompt 1's own gap matrix had flagged as still open, rather than rebuilding anything; (2) properly root-cause the E2E test failure Prompt 1 left unexplained, instead of accepting "flake" as an answer.** Both are done — see §3 and §6.

## 3. Financial-integrity fixes (Step 2 of the execution plan, done first as instructed)

Three specific, previously-disclosed gaps in `services/api/src/modules/point-of-sale/cash-shift-day-end-and-reconciliation/accounting-posting.js` were investigated by direct code read (confirmed still open, not assumed) and fixed:

- **Gap A — loyalty accrual reversal**: a return's accounting journal reversed revenue/tax/tender/COGS for the returned portion but never the original sale's loyalty accrual, even though `loyalty.js`'s `reversePosLoyaltyForReturn` already computed and ledgered the exact reversed points. `buildReturnJournalLines` now posts the matching GL reversal.
- **Gap B — exact refund tender allocation**: refund allocation across a sale's tender legs was *reconstructed* proportionally from `pos_payments`' running `refunded_amount` total, which loses per-return attribution once a sale is returned more than once. `return-lifecycle.js` already computes an exact per-payment share at refund time (`allocateRefundAcrossPayments`) — that figure is now persisted (`tenant.pos_return_payment_refunds`, migration 130, immutable) and consumed directly by accounting posting, with the old reconstruction kept only as a backward-compatible fallback for returns completed before this fix shipped.
- **Gap C — historical loyalty valuation**: loyalty accrual was valued at the loyalty program's *current* live redemption rate, not the rate in effect when the sale happened. The resolved rate (already looked up once during pricing) is now snapshotted onto `pos_sales.loyalty_redemption_value_per_point_snapshot` at sale-completion time and used for both the original accrual and any later reversal.

**Verified against real PostgreSQL**: `tests/integration/pos-financial-integrity-gaps-abc.test.mjs` (8/8, new) — specifically proves the two scenarios the old code could not have gotten right: a sale returned in two separate partial returns each correctly attributing its own exact refund share, and the loyalty program's rate changed *after* the sale but *before* the return posts, confirming the reversal still uses the original rate. Full regression (test:api, real-Postgres integration suite) unaffected. Commit `e89dd459`.

## 4. E2E "flake" investigation (Section 15 of the brief) — properly root-caused, not re-labeled

Prompt 1's handoff said `pos-checkout.spec.ts` failed with a "pre-existing environment flake" and left it there. Prompt 2 did not accept that as sufficient — direct investigation (network capture via a diagnostic spec, direct database inspection, Playwright page snapshots captured at the exact moment of failure) found **six separate, concrete, fixable defects, none of them a genuine flake**:

1. **Stale locators**: the checkout screen's cash-tender field is labeled "Amount" and its submit button "Complete sale" (confirmed by reading the actual component source) — but `pos-checkout.spec.ts`, `pos-checkout-safety.spec.ts`, `pos-hold-resume.spec.ts` and `pos-returns.spec.ts` all still searched for "Cash tendered" and "Complete cash sale", hanging until the Playwright timeout on every single run since whenever that UI copy last changed.
2. **Real test-data pollution**: `pos-visual-qa.spec.ts` seeds a promotion and a coupon directly into the **shared, persistent `CRM E2E Fixture Org`** (not a throwaway org) for its own screenshots, but never deactivated them. An unscoped active promotion matches every checkout in that org, so every other spec's hardcoded expected totals went silently stale the moment visual QA ever ran once. Four already-leaked promotions/coupons from past sessions were found still `active` in the real database and deactivated; `pos-visual-qa.spec.ts` now tracks what it creates and deactivates it in a new `afterAll` (confirmed working: its own newly-created promotion/coupon end up `inactive` after a real run).
3. **Over-broad console-error assertion**: the error collector flagged Chrome's own routine `Failed to load resource: 404` log line for the receipt screen's *intentional* invoice-existence probe (a 404 there is a documented, correct non-error state in `PosReceiptScreen.tsx`'s own code comment) — filtered out specifically.
4. **Over-broad `role="alert"` assertion**: checked for zero `role="alert"` elements to prove "no leftover error banner," but the app has its own always-mounted, empty accessibility live region using the same role — scoped to non-empty text, which is what actually distinguishes a real error banner.
5. **Ambiguous status-text locators**: `pos-returns.spec.ts` checked for bare `"pending approval"`/`"approved"`/`"completed"` text, ambiguous the moment the shared fixture org has more than one return in the same status (which it does, from visual QA's own seeded returns) — scoped to the specific return's own table row.
6. **A real regression from this program's own earlier work**: F301's `idempotencyKey` requirement (Prompt 1) broke `pos-authorization.spec.ts`'s unrelated store-access-denial test, which omitted it and got a `400` (Zod validation failure) instead of the intended `403` — the missing field was added. Separately, `pos_receipt_print_events` (F289) and `pos_return_payment_refunds` (this session's Gap B) are correctly immutable in production but broke `pos-global-teardown.ts`'s own test cleanup (wrong FK deletion order, plus a hard immutability trigger blocking the delete outright) — fixed the deletion order and added a transaction-scoped `SET LOCAL session_replication_role = replica` bypass, the standard PostgreSQL mechanism for administrative operations that must skip row-level triggers without weakening what those triggers protect against for a normal application caller.

**Verified**: `pos-checkout.spec.ts`, `pos-checkout-safety.spec.ts`, `pos-hold-resume.spec.ts`, `pos-returns.spec.ts`, `pos-authorization.spec.ts`, `pos-discount-approval.spec.ts` all pass together in one Playwright run — **11/11**. `pos-visual-qa.spec.ts` — **7/7**. Commit `60221917`.

**This is the single highest-value finding of this session**: the E2E suite was not flaky at all — it was reliably, deterministically broken by six identifiable defects, several of which (items 1 and 2 especially) would have silently masked *any* real product regression in the exact screens they cover, for as long as they went undiagnosed.

## 5. Verification-only findings (no code changes needed — confirmed correct by direct inspection)

Per the brief's own instruction not to rebuild what's already correct, these were verified against real code/schema/tests rather than assumed:

- **Payments (F282-F286)**: only the sandbox adapter is registered (`services/api/src/modules/point-of-sale/tender-and-payment-execution/adapter.js`) — no real merchant credentials exist in this environment, and none are fabricated; resolving any other provider key fails closed with a clear `EXTERNAL ACTIVATION BLOCKED` error. The sandbox adapter's webhook signature verification is real HMAC-SHA256 with `timingSafeEqual` (constant-time comparison), not a stub. The webhook HTTP route (`apps/web/src/app/api/pos/payments/webhook/[provider]/route.ts`) verifies the raw-body signature before trusting anything, matching the codebase's own inbound-webhook precedent. No PAN/CVV/card-number column exists anywhere in the payments schema (confirmed by grepping every tenant migration) — the sandbox adapter only ever handles a `provider_reference` string. Existing test suite (`pos-payments-*` real-Postgres tests, already passing before this session) already covers concurrent webhook delivery, redelivery dedup, refund-capped-at-captured-amount, and split-payment exactness.
- **Stock (F294-F296)**: all stock movements route through Stock's own `postStockMovement` (never a private POS ledger); F295 lot/serial tracking landed in a prior session (`5ecbdda5`) with its own dedicated real-Postgres test suite already passing (serial double-sell rejection, batch requirement enforcement, full-return restock lifecycle).
- **Offline (F297-F298)**: already has a real, tested implementation (`inventory-and-offline-continuity/offline-sync.js`) with its own dedicated real-Postgres suite already passing before this session — snapshot bounding, idempotent replay, conflict-queue routing for stale prices/closed shifts/unsupported tenders/last-unit races.
- **No other explicitly-disclosed gaps found**: a systematic grep across `returns-refunds-and-exchanges/`, `inventory-and-offline-continuity/`, `pos-analytics/`, `tender-and-payment-execution/`, `cash-shift-day-end-and-reconciliation/` and `loyalty.js` for "NOT BUILT"/"disclosed gap"/"TODO"/"FIXME"/"simplification" found **nothing beyond the three gaps already fixed in §3** — the module's own code comments are not hiding any other known-but-unfixed issue.

## 6. Requirement status counts from the atomic register

`docs/03-modules/point-of-sale/POS_ATOMIC_ACCEPTANCE_REGISTER.csv` (regenerate with `npm run pos:generate-acceptance-register`, validate with `npm run verify:pos-acceptance-register`):

| Status | Count |
|---|---|
| PASS | 8 (was 4 after Prompt 1) |
| PARTIAL | 1 |
| UNVERIFIED | 1,471 |
| **Total** | **1,480** |

New PASS rows this session: `F292-BR-002`, `F305-BR-002`, `F305-DATA-002` (Gaps A/B/C evidence), `F283-SEC-002` (no raw card data storage, verified by schema inspection). `F289-BR-002` (from Prompt 1) had its `browser_test` evidence upgraded from "written but not confirmed" to independently confirmed passing, now that the E2E suite actually runs clean.

**1,471 of 1,480 rows remain honestly `UNVERIFIED`** — not because the underlying features are unbuilt (most are, per §5 and the feature-level tracker), but because personally re-deriving atomic-row-level evidence for all of them was not attempted this session, consistent with Prompt 1's own explicit refusal to bulk-mark rows PASS from feature-level narrative alone. This is the single largest remaining task — see §9.

## 7. Test commands and results

Environment: Node v26.5.0 (repo pins `>=24 <25`) — same pre-existing, undisclosed-by-any-session characteristic every prior session has documented; the composite `pnpm verify`/`verify:erp` still fails at `verify:toolchain` for this reason alone. Every individual gate was run directly instead.

Real-Postgres tests require `npx --yes pnpm@11.21.0 infra:up` (Docker) and env vars exported from `apps/web/.env.local` before `node --test tests/integration/*.test.mjs` (no root `.env` — the vars are not auto-loaded).

| Command | Result |
|---|---|
| `npx --yes pnpm@11.21.0 test:api` | 1112/1112 pass |
| `node --test tests/integration/*.test.mjs` | **262/262 pass** (was 254 at Prompt 1's end; +8 new financial-integrity assertions, 0 regressions) |
| `npm run typecheck:web` | Clean |
| `npm run lint:web` | Clean |
| `npx --yes pnpm@11.21.0 verify:db` | OK — 51 platform + 130 tenant migrations |
| `node scripts/qa/validate-pos-acceptance-register.mjs` | OK — 1,480 rows, structural integrity confirmed |
| `npx playwright test e2e/pos-checkout.spec.ts e2e/pos-checkout-safety.spec.ts e2e/pos-hold-resume.spec.ts e2e/pos-returns.spec.ts e2e/pos-authorization.spec.ts e2e/pos-discount-approval.spec.ts` | **11/11 pass, together, in one run** |
| `npx playwright test e2e/pos-visual-qa.spec.ts` | 7/7 pass; confirmed its own seeded promotion/coupon end up `inactive` afterward |

**Not run this session**: `verify:toolchain`/composite `pnpm verify` (environment-blocked, pre-existing, not this session's to fix); `pos-accessibility.spec.ts` and the remaining POS Playwright specs not listed above (not touched, no reason to believe they're affected — but not independently re-confirmed either); a fresh, independent re-verification of F282-F298/F303-F307's own existing real-Postgres suites (they were read and understood to already be passing per the module's own tracker and were not re-broken by anything this session touched, but were not re-executed one-by-one to double check).

## 8. Payment-provider and offline status (as requested by the brief, explicitly)

- **Payment providers**: code-complete for the sandbox adapter architecture (contract, webhook auth, refund flow, idempotency) — genuinely verified locally, not claimed beyond that. **Zero real merchant certification exists or is claimed.** `resolvePaymentAdapter` fails closed with `EXTERNAL ACTIVATION BLOCKED` for any non-sandbox provider key. This is an external dependency (real merchant credentials), not a code gap.
- **Offline**: already has a real, tested backend (F297/F298, prior session) with its own passing real-Postgres suite. Not independently re-verified against a real browser/service-worker journey this session — that would be genuine additional Prompt 3 scope if not already covered by an existing E2E spec (not checked for one this session).

## 9. Exact unresolved requirement IDs and remaining gaps

**Confirmed still open, disclosed (not silently skipped)**:
- **1,471 atomic register rows remain `UNVERIFIED`** — the single largest piece of remaining work. See `POS_ACCEPTANCE_OVERRIDES.json`'s own `_readme` for the exact discipline to follow (real code + real test evidence only, never bulk-marked from narrative).
- **F275's legacy flat-lines path** (`sale-completion.js`'s `resolvePointOfSaleUnitPrice`) still has no customer-pricing-rule lookup and still uses raw `Number` arithmetic — deliberately not touched in Prompt 1 or Prompt 2 (a discouraged path already flagged for eventual removal).
- **F301's replay-safety has no dedicated new test** — proven only by the full existing suite passing unchanged after the breaking signature change, not a test that specifically asserts "same key replays; same key + different payload is rejected" for `openShift` the way `recordPosCashMovement` has one.
- **F289's device-failure-recovery clause** — a genuine, permanent limitation of browser-based printing (`window.print()` has no printer-status callback anywhere), not a code gap. Should be explicitly reclassified `NOT_APPLICABLE` with this justification rather than left ambiguously `PARTIAL`.
- **Loyalty-accrual reversal on a return's own accounting journal** — closed this session (Gap A). ~~Previously disclosed as open.~~
- **A return split across multiple different non-cash tenders** — still uses proportional allocation as a *fallback* only for returns completed before this session's Gap B fix; returns completed from now on get the exact persisted figure. Pre-existing rows (if any exist in a real deployment) remain approximated — a one-time backfill/migration consideration for Prompt 3 if this matters for a specific environment.

**Pre-existing, already-disclosed by prior sessions, not this session's to close**:
- Real merchant-certified payment-provider credentials (external activation blocker).
- A dedicated Accounting account-mapping configuration UI (reuses Accounting's own generic API by design, not a gap).

**Nothing is hidden behind a generic "minor edge cases remaining" label** — every item above is named by its specific requirement ID or exact file/function.

## 10. Regression and architectural risk

None identified. Every change this session:
- Reused existing shared primitives (idempotency, decimal utilities, RLS/immutability conventions, the existing account-mapping vocabulary) rather than inventing new ones.
- Was verified against real PostgreSQL, not mocked.
- Left the full pre-existing test suite green (1112/1112 API, 262/262 integration, both E2E batches run this session).

The one thing worth flagging for Prompt 3's awareness: `pos_receipt_print_events` and `pos_return_payment_refunds` are both intentionally immutable in production (hard DB triggers). Any *future* new POS evidence table with the same immutability pattern will need the same `pos-global-teardown.ts` treatment (deletion order + `SET LOCAL session_replication_role = replica`) if E2E tests ever create rows in it against the shared fixture org — this is now a known, documented pattern (see the teardown script's own comments), not a trap to rediscover.

## 11. External dependencies

Unchanged from Prompt 1: real merchant-certified payment-provider credentials (F283-F286 production activation); native/kiosk printer hardware integration (F289's device-failure-recovery clause). No new external dependencies introduced this session.

## 12. Exact tasks for Prompt 3

In priority order:

1. **Work through the atomic register's 1,471 `UNVERIFIED` rows**, feature by feature, per the discipline in `POS_ACCEPTANCE_OVERRIDES.json`'s own `_readme`. Given most underlying features are already built (§5, §6), this is predominantly a verification/evidence-gathering exercise, not new construction — but it is real, substantial work, almost certainly spanning multiple sessions.
2. **F275's legacy path** (§9) — either add customer-pricing-rule support to it for parity, or complete its planned removal in favor of the cart-based path exclusively.
3. **F301's dedicated replay-safety test** (§9) — small, well-scoped.
4. **Reclassify F289-CAP-001's device-failure-recovery clause** as `NOT_APPLICABLE` with justification, rather than leaving it `PARTIAL` indefinitely.
5. **UI/UX completion pass** (Prompt 2's own §13/§14 sections) — not attempted this session given the financial-integrity and E2E-investigation work took priority per the brief's own execution-order instruction (Step 2 before Step 6). If genuinely still needed: re-verify the CRM-architecture-alignment doc is current, and do a real-browser pass across any POS screens not already covered by `pos-visual-qa.spec.ts`'s own six-viewport sweep.
6. **Independently re-run the F282-F298/F303-F307 real-Postgres suites** one by one to confirm they're still exactly as green as the tracker claims (read as correct, not re-executed individually this session).
7. **If genuinely reaching for new scope beyond verification**: real merchant payment-provider certification (external activation blocker, not code) and any performance/load hardening the original program brief mentioned but neither Prompt 1 nor Prompt 2 attempted.

Do not re-litigate whether the underlying POS features need building. They mostly don't — this has now been confirmed twice, by two separate sessions, via direct code and test inspection. Prompt 3's job is verification depth and the small number of named remaining gaps above, not rediscovery.
