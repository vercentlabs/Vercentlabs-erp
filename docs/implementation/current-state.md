# Current state (measured)

Numbers come from `counts.json`; regenerate with `node scripts/ux/build-implementation-inventory.mjs`.

## Requirement inventory

| Register | Rows |
|---|---|
| Features | 510 |
| Semantic subcapabilities | 4,080 |
| Requirements | 18,870 |
| Flows | 5,100 |
| State transitions | 2,550 |
| Capability groups | 98 |
| Shared-platform rows | 2,088 |
| UX traceability rows | 20,958 (= 18,870 + 2,088, no orphans, no duplicate ids) |

UX relevance of the 20,958 rows: 7,962 direct UI, 7,614 affect UI state, 5,382 no direct UI.

## Routes

The navigation registry declares 360 entries (not the 294 in the spec snapshot): 350 AVAILABLE, 8 PLANNED, 2 admin-only.
Every AVAILABLE entry resolves to a real page (351 resolve overall). Catch-all `[page]` routes were checked against their page tables, so a slug missing from the table counts as unresolved.
The unresolved entries are the honest PLANNED ones: `/sales/availability`, `/manufacturing/resources`, `/hr/reports`, `/accounting/credit`, `/accounting/reconciliation`, `/accounting/tds-tcs`, `/accounting/prepayments`, `/accounting/revenue-schedules`, plus `/accounting/settings` (admin-only).

The specification's claim that ten module roots are still foundation pages is out of date for this repository: Sales, Procurement, Inventory, Manufacturing, Projects, Assets, Quality, Support, HR and Accounting all have routed workspaces and Playwright specs (58 spec files).

## Feature evidence (heuristic)

Source citing a feature id: 294 features cite web source, 104 cite only backend source, 112 are cited nowhere. This is a review queue, not a verdict. Zero features are `VERIFIED_COMPLETE`, because no acceptance run has been linked to a feature yet.

## Fixes made in this program (local commits, not pushed)

| Commit | Change | Evidence |
|---|---|---|
| f71c86e8 | TLS verification, byte-bounded body reader, scoped lead transition-graph key | superseded/strengthened below |
| cc612a7b | `core/db-ssl.ts` (production refuses `DATABASE_SSL_INSECURE`, honours `DATABASE_SSL_CA`), `core/body-limit.ts` (counts received bytes, 413), caches cleared on tenant switch and sign-out, `<html lang>` and formatting locale from the user's saved locale | 9 unit tests + 2 locale tests |
| 57003fda | POS offline seed recovery after a cold reload (wrapped under a non-extractable device key), wiped on sign-out and tenant switch | 6 unit tests |

## Known gaps

- The POS offline recovery is unit-tested against an in-memory store. It has not been exercised in a real browser reload (offline, reload, sell, reconnect).
- About 560 `queryKey` uses exist; a number are not built with `scopedQueryKey`. Clearing the whole client on switch and sign-out removes the leak, but a same-session company change that does not go through the switcher is still keyed by whatever each screen uses.
- Sales-availability, manufacturing resources, HR reports and five accounting pages are PLANNED.
- CRM UI/UX items still open: Lead Lifecycle, Custom Fields & Tags, Record Fields, Forecast.
- Razorpay: blocked, see `blocker-register.md`.
