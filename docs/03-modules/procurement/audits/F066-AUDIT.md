# F066 Supplier categories — Atomic requirement trace

Dossier wants: governed category/taxonomy classification of suppliers/spend,
hierarchy, effective dates, spend rollups, rename/merge, preferred-source
policy. Lifecycle: `DRAFT -> ACTIVE -> INACTIVE`.

`categories` is a real top-level resource (`RESOURCE_CONFIG.categories`,
`kind: "document"`, `INITIAL_DOCUMENT_STATUS.categories = "active"` — created
directly active, no draft workflow), with `code`+`name` fields
(`normalizeDocument`'s `"categories"` branch, `index.js:495-498`), gated by
`procurement.settings.manage`.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PARTIAL | The resource exists with real permission/audit/idempotency plumbing (shared engine), but categories have **no transition table at all** — `TRANSITIONS` has no `categories` entry, so there is no `activate`/`deactivate` action; a category can only ever be `active` (its fixed initial status) or edited while `draft`/`rejected` (impossible states for this resource per `INITIAL_DOCUMENT_STATUS`). Effectively categories can be created and edited but never deactivated through any governed action. |
| **CAP-002 — hierarchy/taxonomy.** | **GAP, confirmed.** `normalizeDocument`'s `categories` case only captures `name`/`code` — no `parentCategoryId` or hierarchy field of any kind. Flat list only, no taxonomy tree. |
| **CAP-002 — supplier/category many-to-many.** | **GAP, confirmed.** No column, child resource or join table linking a supplier to one or more categories was found anywhere in `procurement/index.js`'s `suppliers` handling or in the migrations reviewed. A supplier cannot actually be assigned a category. |
| **CAP-002 — spend rollups by category.** | **GAP.** `REPORTS` (the `getProcurementReport` set) has no category-grain report; `spend-analysis` groups by supplier only, not category (not independently re-verified against the exact report SQL this pass, but no `category` column reference was found in `getProcurementReport`'s query text during this trace). |
| UX | **GAP, confirmed.** No web UI anywhere manages categories — the Settings page (`apps/web/src/app/(app)/procurement/settings/page.tsx`) is a **static, hardcoded placeholder**: 6 fixed cards ("Supplier governance", "Controlled sourcing", etc.) each unconditionally showing the label "Governed" regardless of actual configuration, plus a static paragraph claiming the workspace is "connected to approvals, audit evidence, Accounting handoffs... and provider-neutral outbox delivery" — which is not true (see F063: outbox is never consumed). This is exactly the "static mock data" anti-pattern the completion brief explicitly warns against. Categories, catalogs, source rules and policies (matching tolerance, governance policy) all have real backend resources/tables but **zero real management UI** — only the generic `resources/[resource]` API. |
| BR-001/VAL-001 | PASS (thin) | Server-side create/update validation exists (code/name required, uppercased code) but there's essentially nothing else to validate given categories have no relationships to enforce yet. |
| SEC-001 | PASS | Gated by `procurement.settings.manage`, organization/company-scoped like every other resource. |
| E2E | GAP (module-wide) | See F063. |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

This is essentially **foundation-only, not a working feature**. A "category"
row can be created and read via direct API calls, but there is no hierarchy,
no way to actually classify a supplier into a category (no linking
mechanism exists), no spend rollup by category, and no UI at all —
Settings is decorative. The governance dashboard and reports don't
reference categories anywhere either. This is one of the largest gaps
found in the module so far, and it also exposes a **real, misleading
finding worth flagging as its own priority**: the Settings page's static
"Governed" labels are the kind of fabricated-looking UI state the
completion brief explicitly treats as a release blocker in its own right
(masquerading as a working control surface when there is none behind it).
