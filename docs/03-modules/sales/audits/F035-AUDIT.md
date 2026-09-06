# F035 Customer-specific prices — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) by reading `upsertSalesCustomerPrice` in full (`services/api/src/modules/sales/pass1-operations.js:215-267`, already read for F034) and `tenant.sales_pricing_rules`' schema (`database/tenant/migrations/008_sales_module.sql:56-80`) for the columns this feature would need but doesn't have.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 | PASS | `upsertSalesCustomerPrice` creates/updates a `sales_pricing_rules` row scoped to one `party_id` with `adjustment_type='fixed_rate'`, consumed identically to any other pricing rule by `calculateLine`'s rule loop (already verified for F033/F034) — negotiated pricing flows through the same deterministic engine as list/quantity-break pricing, not a side path. |
| CAP-002 (validity windows, quantity breaks) | PASS | Same `validFrom<=validTo` and `minimumQuantity` validation already verified for F034's `upsertSalesPriceListItem`; `minimumQuantity` is part of the natural key so multiple quantity-break tiers for the same customer/item can coexist. |
| **CAP-002 (customer/group specificity) — GAP, recorded, not fixed this pass.** | FAIL | `sales_pricing_rules.party_id` targets exactly one `business_parties` row; there is no customer-*group* concept anywhere in the schema (confirmed: no `party_group`/`customer_group` table exists in any tenant migration). Negotiated pricing can only be set customer-by-customer, never for a named tier/segment of customers at once — the dossier explicitly names "customer/group specificity" as required coverage. |
| **CAP-002 (approval, override reasons) — GAP, recorded, not fixed this pass.** | FAIL | `upsertSalesCustomerPrice` requires only `sales.settings.manage` — no approval step, and `sales_pricing_rules` has no `reason`/`approval_status` column to capture why a negotiated rate was set. This is a real asymmetry within the same file: `calculateLine`'s *ad-hoc* manual price override on a single order line requires `sales.price.override` **and** a reason (verified for F033); a *permanent, reusable* negotiated customer price requires neither. The higher-blast-radius action (a standing rate applied to every future order) is less governed than the one-off override. |
| DATA-002/BR-002 (snapshot) | PASS | Same `pricing_trace` mechanism verified for F033/F034 — a quotation/order line records which rule actually applied, so later editing or deleting the customer-specific rate doesn't retroactively change historical documents. |
| SEC-001 (company scope) | PASS | Re-validates both the party's and item's `company_id` against `c.activeCompanyId` before accepting a rate (`:229-236`) — already noted for F034. |
| VAL-001/FLOW-002 | PASS | Row-locked upsert-by-natural-key, non-negative rate validation — already verified for F034. |
| FR-003/PERF-001 | Same class already recorded (no dedicated list endpoint for browsing existing customer-specific prices was found in this file beyond the general options aggregation). |
| AUTO-001 / APP-001 (beyond the finding above) / NOTIF-001 / REP-001 / AI-001 / INT-001/002 / UX-001-003 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 / SEC-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

Two real gaps found, both directly named by the dossier's own omission gate: no customer-group pricing tier (individual-customer only), and no approval/reason requirement for a standing negotiated price — a real governance asymmetry against the module's own precedent of requiring a reason for the much-lower-stakes single-line manual override. Both recorded for the Sales gap-closing pass.
