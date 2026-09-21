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

## Work delivered

See `session-handoff.md` for the list and `test-evidence.md` for commands and counts. Headline: API 1,119 / integration 688 / web 45 / worker 102 tests pass; type check, lint, production build and all repository gates pass except the toolchain gate (this machine runs Node 26); 55 accessibility checks and 39 responsive checks pass; browser specs pass one file at a time except two that need server settings this machine lacks.

## Known gaps

- Zero requirements are `VERIFIED_COMPLETE`: no acceptance run is linked to a requirement id.
- Six navigation entries are still PLANNED (see the handoff).
- The browser CI workflow has not been run on GitHub.
- Cold offline reload for POS is not supported (no service worker).
- Razorpay and live POS payments are blocked on credentials.
- Home and My work draw only on CRM and approvals.
