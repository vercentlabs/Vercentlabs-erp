# Web Frontend Architecture

Status: `FROZEN_FOR_IMPLEMENTATION`

## Permanent boundaries

`apps/web/src/` is organized as:

```text
app/      Next.js routing/composition only
core/     ERP web-platform capabilities: auth/access/context/shell/navigation/search/approvals/etc.
modules/  12 business modules organized by real capability groups
shared/   governed design system plus generic hooks/http/formatting/types/utilities
```

## Business organization

The web does **not** create F001-F510 source folders. The 510 features map into the 98 approved capability groups below. F-IDs remain traceability metadata in manifests/tests/docs.

### `crm`
- `prospect-and-relationship-master-data/` — CRM-CAP-001 — F001;F002;F003;F004;F008
- `lead-lifecycle-qualification-and-prioritization/` — CRM-CAP-002 — F005;F006;F007;F027
- `opportunity-and-pipeline-governance/` — CRM-CAP-003 — F009;F010;F011;F012;F026
- `seller-activity-and-follow-up-workspace/` — CRM-CAP-004 — F013;F014;F015;F016;F017;F018;F019
- `sales-organization-and-coverage/` — CRM-CAP-005 — F020
- `crm-data-operations-and-customization/` — CRM-CAP-006 — F021;F028;F029
- `crm-conversion-and-sales-handoff/` — CRM-CAP-007 — F022;F023
- `pipeline-analytics-and-forecasting/` — CRM-CAP-008 — F024;F025;F030

### `sales`
- `customer-catalog-and-pricing-foundation/` — SALES-CAP-001 — F031;F032;F033;F034;F035
- `quotation-and-commercial-governance/` — SALES-CAP-002 — F036;F037;F038;F039;F040;F041
- `sales-order-governance/` — SALES-CAP-003 — F042;F043;F044
- `availability-and-fulfilment-coordination/` — SALES-CAP-004 — F045;F046;F047;F048;F049
- `billing-advances-credit-and-returns/` — SALES-CAP-005 — F050;F051;F052;F053;F054;F055;F058
- `alternative-fulfilment-and-compensation/` — SALES-CAP-006 — F056;F057
- `order-visibility-analytics-and-profitability/` — SALES-CAP-007 — F059;F060;F061;F062

### `procurement`
- `supplier-identity-onboarding-and-segmentation/` — PROC-CAP-001 — F063;F064;F065;F066
- `requisition-and-spend-approval/` — PROC-CAP-002 — F067;F068
- `competitive-sourcing-and-award/` — PROC-CAP-003 — F069;F070;F071;F072;F073
- `purchase-order-agreement-and-supplier-pricing-governance/` — PROC-CAP-004 — F074;F075;F076;F077;F078;F079
- `receiving-rejection-and-supplier-returns/` — PROC-CAP-005 — F080;F081;F082;F083
- `supplier-invoice-matching-and-landed-cost-control/` — PROC-CAP-006 — F084;F085;F086;F087;F088
- `supplier-performance-and-procurement-intelligence/` — PROC-CAP-007 — F089;F090;F091;F092;F093;F096
- `replenishment-and-subcontract-purchasing-orchestration/` — PROC-CAP-008 — F094;F095

### `stock`
- `item-identity-variants-and-uom/` — STOCK-CAP-001 — F097;F098;F099;F100;F101;F102
- `warehouse-network-and-location-model/` — STOCK-CAP-002 — F103;F104;F105
- `perpetual-ledger-availability-and-reservation/` — STOCK-CAP-003 — F106;F107;F108;F109;F110;F111;F112;F113;F114
- `traceability-expiry-and-barcode-execution/` — STOCK-CAP-004 — F115;F116;F117;F118;F119
- `counting-replenishment-and-negative-stock-policy/` — STOCK-CAP-005 — F120;F121;F122;F123;F124;F125;F126
- `inventory-costing-and-valuation/` — STOCK-CAP-006 — F127;F128;F129;F130;F131
- `inventory-intelligence-and-reporting/` — STOCK-CAP-007 — F132;F133;F134;F143;F144
- `warehouse-fulfilment-and-returns/` — STOCK-CAP-008 — F135;F136;F137;F138
- `inventory-exception-quality-hold-and-genealogy/` — STOCK-CAP-009 — F139;F140;F141;F142

### `manufacturing`
- `product-structures-and-engineering-definition/` — MFG-CAP-001 — F145;F146;F147;F148;F149
- `process-operations-and-production-resources/` — MFG-CAP-002 — F150;F151;F152;F153;F154
- `production-orders-shop-floor-work-and-scheduling/` — MFG-CAP-003 — F155;F156;F157;F168;F169;F170;F171
- `mrp-material-control-and-wip-output/` — MFG-CAP-004 — F158;F159;F160;F161;F162;F163;F164;F165;F166;F167
- `loss-genealogy-and-production-strategies/` — MFG-CAP-005 — F172;F173;F174;F175;F176;F177;F178;F179;F180
- `production-quality-and-hold-control/` — MFG-CAP-006 — F181;F182
- `manufacturing-costing-and-operational-performance/` — MFG-CAP-007 — F183;F184;F185;F186;F187;F188;F189
- `engineering-change-and-production-intelligence/` — MFG-CAP-008 — F190;F191;F192

### `projects`
- `project-setup-type-template-and-lifecycle/` — PRJ-CAP-001 — F193;F194;F195;F196;F204
- `work-planning-wbs-schedule-and-progress/` — PRJ-CAP-002 — F197;F198;F199;F200;F201;F203;F205;F206;F207;F228
- `staffing-availability-and-time/` — PRJ-CAP-003 — F202;F208;F209;F210
- `project-cost-materials-procurement-and-budgets/` — PRJ-CAP-004 — F211;F212;F213;F214;F215;F216;F223
- `revenue-billing-invoices-and-profitability/` — PRJ-CAP-005 — F217;F218;F219;F220;F221;F222
- `issues-risks-documents-and-collaboration/` — PRJ-CAP-006 — F224;F225;F226;F227
- `project-intelligence-and-reporting/` — PRJ-CAP-007 — F229;F230

### `assets`
- `asset-master-identity-and-organization/` — AST-CAP-001 — F231;F232;F233;F234;F235;F236
- `acquisition-and-capitalization/` — AST-CAP-002 — F237;F238
- `asset-value-and-depreciation/` — AST-CAP-003 — F242;F243;F244;F245;F246;F247;F248;F249;F250;F251
- `assignment-transfer-and-movement-history/` — AST-CAP-004 — F239;F240;F241
- `maintenance-and-reliability/` — AST-CAP-005 — F252;F253;F254;F255;F256;F257
- `inspection-calibration-and-physical-control/` — AST-CAP-006 — F258;F259;F260;F261
- `disposal-and-retirement/` — AST-CAP-007 — F262;F263;F264;F265;F266
- `asset-analytics-and-reporting/` — AST-CAP-008 — F267

### `point-of-sale`
- `store-terminal-and-cashier-control/` — POS-CAP-001 — F268;F269;F270;F271
- `assortment-pricing-customer-and-cart/` — POS-CAP-002 — F272;F273;F274;F275;F276;F277;F278;F279;F280;F281
- `tender-and-payment-execution/` — POS-CAP-003 — F282;F283;F284;F285;F286
- `transaction-continuity-and-documents/` — POS-CAP-004 — F287;F288;F289;F290
- `returns-refunds-and-exchanges/` — POS-CAP-005 — F291;F292;F293
- `inventory-and-offline-continuity/` — POS-CAP-006 — F294;F295;F296;F297;F298
- `cash-shift-day-end-and-reconciliation/` — POS-CAP-007 — F299;F300;F301;F302;F303;F304;F305
- `loyalty/` — POS-CAP-008 — F306
- `pos-analytics/` — POS-CAP-009 — F307

### `quality`
- `standards-specifications-and-quality-planning/` — QUALITY-CAP-001 — F308;F309;F310;F311
- `inspection-sampling-and-deterministic-evaluation/` — QUALITY-CAP-002 — F312;F313;F314;F315;F316;F317;F318;F319
- `defect-ncr-and-quality-hold-control/` — QUALITY-CAP-003 — F320;F321;F322;F323;F324
- `disposition-and-containment-execution/` — QUALITY-CAP-004 — F325;F326;F327;F328;F329
- `root-cause-and-capa/` — QUALITY-CAP-005 — F330;F331;F332;F333
- `supplier-and-customer-quality/` — QUALITY-CAP-006 — F334;F335
- `metrology-audits-coa-traceability-and-documents/` — QUALITY-CAP-007 — F336;F337;F338;F339;F340
- `quality-cost-and-performance-intelligence/` — QUALITY-CAP-008 — F341;F342

### `support`
- `ticket-identity-customer-context-and-lifecycle/` — SUPPORT-CAP-001 — F343;F344;F345;F346;F347;F348;F349
- `queues-assignment-and-routing/` — SUPPORT-CAP-002 — F350;F351;F352;F364
- `omnichannel-intake-and-conversation/` — SUPPORT-CAP-003 — F353;F354;F355;F356;F357;F358
- `sla-escalation-and-service-control-lifecycle/` — SUPPORT-CAP-004 — F359;F360;F361;F362;F363;F365;F366;F367;F368
- `knowledge-and-guided-resolution/` — SUPPORT-CAP-005 — F369;F370
- `customer-self-service-and-connected-service-context/` — SUPPORT-CAP-006 — F371;F372;F373;F374;F375
- `experience-feedback-and-operational-performance/` — SUPPORT-CAP-007 — F376;F377;F378;F379
- `audit-privacy-and-service-evidence/` — SUPPORT-CAP-008 — F380

### `hr-payroll`
- `employee-and-organization-master/` — HR-CAP-001 — F381;F382;F383;F384;F385;F386;F387;F388
- `employment-lifecycle-and-self-service/` — HR-CAP-002 — F389;F390;F391;F392;F393;F394;F395;F396
- `recruitment-and-conversion/` — HR-CAP-003 — F397;F398;F399;F400;F401;F402
- `workforce-scheduling-and-attendance/` — HR-CAP-004 — F403;F404;F405;F406;F407;F408;F409
- `leave-and-absence/` — HR-CAP-005 — F410;F411;F412;F413;F414;F415;F416;F417
- `compensation-configuration/` — HR-CAP-006 — F418;F419;F420;F421;F422
- `payroll-processing-and-settlement/` — HR-CAP-007 — F423;F424;F425;F426;F427;F428;F429;F430;F431;F432;F433;F434;F435;F436;F437;F438
- `india-statutory-payroll-and-compliance/` — HR-CAP-008 — F439;F440;F441;F442;F443;F444;F445;F446;F447
- `performance-skills-and-learning/` — HR-CAP-009 — F448;F449;F450;F451;F452

### `accounting`
- `ledger-foundation-calendars-and-dimensions/` — ACC-CAP-001 — F453;F454;F455;F456;F457;F458;F459;F460;F461;F462
- `accounts-receivable-and-credit-control/` — ACC-CAP-002 — F463;F464;F465;F466;F467;F468;F469;F470
- `accounts-payable-and-supplier-settlement/` — ACC-CAP-003 — F471;F472;F473;F474;F475
- `cash-bank-and-payment-reconciliation/` — ACC-CAP-004 — F476;F477;F478;F479;F480
- `tax-configuration-and-compliance-reporting/` — ACC-CAP-005 — F481;F482;F483;F484;F485;F486;F487
- `planning-schedules-accruals-and-revenue/` — ACC-CAP-006 — F488;F489;F490;F491;F492;F493
- `currency-intercompany-and-consolidation/` — ACC-CAP-007 — F494;F495;F496;F497;F498;F499
- `financial-close-and-control/` — ACC-CAP-008 — F500
- `financial-reporting-dashboards-and-audit/` — ACC-CAP-009 — F501;F502;F503;F504;F505;F506;F507;F508;F509;F510

## Capability internal vocabulary

Create only the directories a capability genuinely needs:

```text
<capability>/
├── index.ts
├── screens/       route-facing workspaces / Server Components
├── components/    domain-specific composed UI
├── data/          queries/mutations/loaders/mappers
├── model/         UI types/schemas/view models/constants
├── config/        columns/filters/tabs/actions/display configuration
└── styles/        CSS Modules only when local styling is needed
```

Do not generate empty boilerplate.

## Design-system rule

**Superseded 2026-09-14 by `docs/01-standards/TECH_STACK_ADR_002_FRONTEND_REWRITE.md`
and `docs/01-standards/TECH_STACK_ADR_003_PRIMITIVE_LIBRARY_CORRECTION.md`**
(owner-authorized full frontend rewrite). The design authority is now
`packages/design-system` (React Aria Components + Tailwind v4, shadcn-style
open-code ownership — ADR-003 corrected this from an earlier Base UI/
`packages/ui-web` choice), fed by `packages/design-tokens`, per those ADRs.
The rule itself is unchanged in spirit — new module code composes the
canonical system's primitives, enterprise components and archetypes; do
not create a second button/table/form/state system inside a module — only
the implementation stack changed. `apps/web` (including the old Experience
Kernel CSS Modules referenced by an earlier version of this note) was
deleted outright as part of the rewrite, not migrated incrementally — see
`docs/frontend-rebuild/README.md` for the archive point and contract
inventory, and `docs/ux/UI_REWRITE_TRACKER.md` for current rebuild status.

## Rendering rule

Server Components are the default. Use Client Components only for real interaction boundaries such as editable forms, drag/drop, local dialogs/drawers, command menus and rich controls.

## Business-authority boundary

The web may preflight/explain validation and permissions, but server/domain/database layers remain authoritative. Cross-module transactional orchestration does not live in React.

## Route rule

URLs follow user jobs/workspaces, not F-ID numbers. A feature gets a standalone route only when its user journey requires a distinct entry point. Rules such as duplicate detection, tax calculation, double-entry enforcement or SLA breach handling normally appear inside capability experiences rather than as artificial pages.
