# F039 Discounts — Atomic requirement trace

Verified against `SUBREQUIREMENT_REGISTER.csv` (37 rows) largely by re-examining evidence already gathered for F033 (`calculateLine`'s discount handling) and F036 (`submitQuotation`'s approval-threshold engine), plus reading `tenant.sales_quotation_charges`' schema (`database/tenant/migrations/008_sales_module.sql:200-214`) specifically to check for a header-level discount mechanism.

| ID | Verdict | Evidence |
|---|---|---|
| CAP-001/FR-001 (line discount) | PASS | `calculateLine` validates `discountPercent` is between 0-100, computes `discountAmount = roundMoney(percent(gross, discountPercent), decimalPlaces)`, and a requested price below the calculated (list × pricing-rule) price requires `sales.price.override` **and** a mandatory reason (all verified for F033). |
| **CAP-002 (header discount) — GAP, recorded, not fixed this pass.** | FAIL | `tenant.sales_quotation_charges` — the only document-level adjustment mechanism — is constrained to `charge_type IN ('freight','handling','insurance','packing','other')` with `value >= 0` and `amount >= 0`: strictly additive charges, never a discount, and there is no separate header-discount column anywhere on `sales_quotation_versions`/`sales_order_versions`. A discount can only be applied line-by-line; there is no way to apply one negotiated discount across an entire document total. |
| CAP-002 (stacking/precedence) | PASS | Already verified for F034: price-list rate establishes the base, `sales_pricing_rules` then apply in `ORDER BY priority,id` — deterministic, not ambiguous. |
| CAP-002 (thresholds, approval) | PASS | Already verified for F036: `submitQuotation` requires approval when `maximum_discount_percent > sales_settings.quotation_approval_discount` — a real, configurable discount threshold gate, not a hardcoded cutoff. |
| CAP-002 (margin floors) | PASS | Same `submitQuotation` gate also triggers mandatory approval when `version.margin_percent < sales_settings.minimum_margin_percent` — a discount that erodes margin below the configured floor cannot silently bypass review. |
| CAP-002 (permissions, reasons) | PASS | Already verified for F033: `sales.price.override` + non-empty `manualPriceReason` required for any line where the requested price differs from the calculated one. |
| VAL-001 | PASS | `discountPercent < 0 || > 100` throws a stable `400` before any calculation proceeds. |
| DATA-002 | PASS | Every line snapshots its own `discount_percent`/`discount_amount` at creation (already verified for F033/F037) — a later pricing-rule change can't retroactively alter a historical document's discount. |
| AUTO-001 / NOTIF-001 / REP-001 / AI-001 / INT-001/002 / UX-001-003 / API-001/002 / OBS-001 / E2E-001-002 / UAT-001-002 / SEC-002 | NOT INDEPENDENTLY VERIFIED | Not traced this pass. |

## Net assessment (2026-09-06)

One clean, singular gap: no header/document-level discount exists anywhere, only per-line discounts. Everything else the dossier asks for (thresholds, approval, margin floors, permission-gated overrides with mandatory reasons, deterministic precedence) is real and already verified across F033/F034/F036. Recorded for the Sales gap-closing pass.
