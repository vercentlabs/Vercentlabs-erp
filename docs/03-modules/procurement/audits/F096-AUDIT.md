# F096 Procurement dashboard — Atomic requirement trace

Dossier: work exceptions and decisions from a role-specific dashboard with
drilldown to authoritative records. Lifecycle: `DERIVED LIVE/SNAPSHOT VIEW;
no dashboard state may become an alternative source of transaction truth`.

Two real dashboards exist: `getProcurementDashboard` (`index.js:2312-2328`,
simple live counts) and `getProcurementGovernanceDashboard`
(`governance.js:555-598`, the richer exception/health-driven view, already
evidenced in F063's original reconnaissance and confirmed concurrency-safe
by `governance-dashboard-query-serialization.test.mjs`).

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001 | PASS | Both dashboards compute genuinely live counts/aggregates from real tables on every call (`SELECT count(*) FROM tenant.procurement_requisitions WHERE status IN (...)`, etc.) — no cached/stale dashboard state that could drift from the truth, satisfying the dossier's own "no alternative source of truth" requirement by construction (there's no persisted dashboard state to drift). |
| **Exception-working workflow.** | PASS (real, not decorative) | `upsertProcurementExceptionCase`/`bulkManageProcurementExceptions` (governance.js) provide a genuine status/priority/reason/owner/next-action workflow with real permission gating and a real `ON CONFLICT` upsert per entity — an operator can actually assign and track exceptions, not just view a static count. Bulk actions are capped at 200 records, a sane enterprise-scale guard. |
| Saved views | PASS | `listProcurementSavedViews`/`saveProcurementView`/`deleteProcurementSavedView` are real, per-user + shared, permission-gated for sharing. |
| **Drilldown to authoritative records.** | NOT INDEPENDENTLY VERIFIED (UI-level) | The governance dashboard's returned rows include `id`s for each entity; whether the actual rendered UI links each row to its real detail page was not confirmed by reading the governance dashboard's consuming page component this pass (only the backend was traced in depth). Flag for a direct browser check in the gap-closing pass. |
| CONCURRENCY | PASS, test-confirmed | `governance-dashboard-query-serialization.test.mjs` (pre-existing, run this session: 4/4 pass) specifically asserts `getProcurementGovernanceDashboard` never fires two `client.query()` calls concurrently on one connection — real regression protection against the exact class of bug found and fixed in CRM this session. |
| SEC-001 | PASS | `requireAnyPermission`/`permission` gates on every function. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

This is one of the strongest features in the module: two real, live,
concurrency-safe dashboards, a genuine exception-management workflow (not
just a read-only view), and saved views. The one open question is whether
the UI actually wires dashboard rows to their detail pages for drilldown —
worth a direct check, but not evidence of a defect on its own.
