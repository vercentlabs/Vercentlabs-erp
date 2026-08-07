# Buyer Role Map

## Why roles, not role pages

The governing prompt for this phase explicitly asked to support buyer-role perspectives "woven into existing pages, not necessarily new dedicated indexable pages." `packages/landing-content/src/buyer-roles.js`'s `BUYER_ROLES` (6 entries) is a shared registry, not a page-per-role IA tier — rendered via the `RolePerspective` component on industry pages (2-3 roles each, selected per `industry.buyerRoleSlugs`).

## The 6 roles

Grounded in `icp-and-buyer-map.md`'s real buying-committee descriptions across all 3 ICPs, plus `product-intelligence.md`'s per-module "Best marketing angle" evidence for each role's `proofPoint`:

| Role | Concern | Proof point cites |
|---|---|---|
| CEO / Owner | Margin, control, adoption risk | Time-bound/scoped role assignments (Shared Platform) |
| COO / Operations Director | Real-time operational truth | Manufacturing/POS race-safe stock movements |
| CFO / Finance Head | Costing accuracy, audit defensibility | Immutable, database-trigger-enforced audit log |
| Sales Leader | Pipeline evidence, fast quote conversion | Public hashed-link quote acceptance with typed signature |
| Plant / Operations Manager | Shop-floor adoption, real material control | Work-order release blocked on proven component availability |
| HR Leader | Payroll defensibility, one employee record | Payroll maker-checker (different preparer/approver required) |

## Where each role currently appears

- **Manufacturing industry**: CEO/Owner, Plant Manager, CFO.
- **Distribution industry**: COO, CEO/Owner, CFO.
- **Retail industry**: COO, CEO/Owner.
- **Professional Services industry**: CEO/Owner, CFO, HR Leader.

Workflow pages do not currently render `RolePerspective` (industry pages carry the role-perspective load this phase, keeping workflow pages focused on the sequence itself) — a reasonable scope boundary given time, not an oversight; noted as a real option for Phase 6 if role-specific workflow framing becomes a priority.

## Evidence discipline

Every `proofPoint` is a real, cited capability already used elsewhere in the content architecture (module FAQs, evidence highlights) — no role-specific claims were invented. `primaryConcerns` phrasing is grounded directly in `icp-and-buyer-map.md`'s "Buying committee" and "Evaluation criteria" fields for the corresponding ICP.
