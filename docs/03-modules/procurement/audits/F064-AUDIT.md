# F064 Supplier contacts and addresses — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` by reading
`services/api/src/modules/procurement/index.js`'s `supplier-sites` resource
config (`RESOURCE_CONFIG["supplier-sites"]`, `CHILDREN.suppliers`,
`CHILD_PARENT_EDITABLE_STATES["supplier-sites"]`), the generic child
create/update path (`createProcurementRecord`/`updateProcurementRecord`,
`kind === "child"` branch), and the web supplier detail page.

Procurement models this as a `supplier-sites` **child resource** of
`suppliers` (`tenant.procurement_supplier_sites`), not a dedicated
contacts/addresses entity — "site" is the generic container for
ordering/ship-from/remit-to/service locations per the dossier's own scope.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PASS (structurally) | `supplier-sites` is a real child resource: create (`procurement.suppliers.manage`), list (`procurement.suppliers.view`), update with optimistic version check. Editable while the parent supplier is `draft/submitted/qualified/active/suspended` (`CHILD_PARENT_EDITABLE_STATES`), locked once `blocked`/`cancelled`. |
| CAP-002 — **GAP: no distinct site "type"/"role" taxonomy.** | **GAP, recorded.** The `procurement_supplier_sites` table stores an arbitrary `data` jsonb blob with no server-enforced `siteType` enum (ordering/ship-from/remit-to/service) — nothing prevents a caller from omitting a type or using inconsistent free-text values. The dossier explicitly requires "purpose-specific" sites; the code treats all sites identically. |
| CAP-002 — **GAP: no distinct "contact" sub-entity.** | **GAP, recorded.** Only "sites" exist as a child resource — there is no separate `supplier-contacts` resource for named individuals (phone/email/role) distinct from a physical site/address. If contact fields are meant to live inside a site's `data` blob, that's undocumented and unenforced. |
| DATA-002 (historical snapshot) | **GAP, recorded.** No evidence that a site/address used on a historical document (PO, receipt) is snapshotted at the time of use — `procurement_purchase_orders` etc. don't appear to persist a site/address snapshot, only a live parent `supplier_id` reference. A later edit to a site's address would silently change what a stale historical document "shows" if the UI re-joins live site data. Not independently verified against every consuming query this pass. |
| SEC-001/002 | PASS | Same permission gates as the parent supplier resource (`procurement.suppliers.view`/`.manage`); no separate sensitive-field set for sites was found, but sites don't appear to hold bank/tax data (that stays on the parent supplier). |
| VAL-001, BR-001 | PASS (generic) | Goes through the same `normalizeChild`/`validateChildParent` path as every other child resource — company-match check against parent, lifecycle-lock check. |
| CONCURRENCY/IDEMPOTENCY | PASS (generic) | Optimistic version check on child update (`version=$7` in WHERE), `ON CONFLICT DO NOTHING` + idempotency-key fallback on create — same as every document/child resource. |
| UX-001-003 | **GAP, confirmed.** `apps/web/src/app/(app)/procurement/suppliers/[id]/page.tsx` has zero references to "sites" — there is no UI anywhere to create, view or edit a supplier site/address. The only path is a direct API call to `resources/supplier-sites`. Fails the "complete list/detail/create/edit UI" bar outright. |
| E2E | **GAP.** No Procurement browser E2E exists at all (repo-wide, confirmed in F063's trace). |
| UAT | PENDING HUMAN UAT | |

## Net assessment (2026-09-14)

The generic child-resource engine gives F064 real create/update/list/permission/
concurrency plumbing "for free," but the feature-specific requirements the
dossier actually cares about — a real site-type taxonomy (ordering/ship-from/
remit-to/service), a distinct named-contact entity, and historical
snapshotting of the address actually used on a PO — are not evidenced in the
code. Treat this as **foundation-only**, not complete. UI coverage needs a
direct browser check in the gap-closing pass.
