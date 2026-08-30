# Point of Sale Capability Pack

Status: `SPECIFICATION_READY`

| Capability | Scope | Outcome |
|---|---|---|
| `POS-CAP-001` | Store, terminal and cashier control — F268;F269;F270;F271 | Trusted store/terminal/operator identity, session control and least-privilege cashier operation. |
| `POS-CAP-002` | Assortment, pricing, customer and cart — F272;F273;F274;F275;F276;F277;F278;F279;F280;F281 | Fast product/customer discovery and deterministic cart pricing, tax, discount, promotion and coupon evaluation. |
| `POS-CAP-003` | Tender and payment execution — F282;F283;F284;F285;F286 | Exactly-once tender truth across cash/card/UPI/digital/split/multi-tender with uncertain-outcome recovery. |
| `POS-CAP-004` | Transaction continuity and documents — F287;F288;F289;F290 | Hold/resume and receipt/invoice workflows preserve transaction identity, fiscal evidence and retry-safe output. |
| `POS-CAP-005` | Returns, refunds and exchanges — F291;F292;F293 | Original-sale-linked return/refund/exchange controls prevent over-return, duplicate refund and ungoverned stock/value effects. |
| `POS-CAP-006` | Inventory and offline continuity — F294;F295;F296;F297;F298 | Stock/lot/serial truth and conflict-safe offline operation converge through Stock public contracts without duplicate effects. |
| `POS-CAP-007` | Cash, shift, day-end and reconciliation — F299;F300;F301;F302;F303;F304;F305 | Opening float, cash movements, shift close, Z report, tender reconciliation and Accounting posting are auditable and balanced. |
| `POS-CAP-008` | Loyalty — F306 | Permission-safe loyalty earn/redeem/reversal follows completed transaction truth and never creates value twice. |
| `POS-CAP-009` | POS analytics — F307 | Permission-safe sales/tender/return/discount/shift analytics reconcile to POS transaction facts. |

## Cross-cutting controls
- exact transaction identity/idempotency across provider, Stock and Accounting effects
- deterministic price/tax/discount/promotion/coupon evaluation
- tenant/company/store/terminal/shift scope and override/SoD controls
- bounded encrypted offline mode and conflict-safe synchronization
- PCI-sensitive data minimization, payment uncertainty and reconciliation
- terminal/tablet/mobile, peripherals, WCAG 2.2 AA and failure recovery
