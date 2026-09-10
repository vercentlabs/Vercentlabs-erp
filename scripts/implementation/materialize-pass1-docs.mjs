#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const root=process.cwd();
for (const relative of ["docs/erp-510/02-feature-specs", "docs/erp-510/05-uat", "docs/erp-510/04-test-evidence"]) fs.mkdirSync(path.join(root, relative), { recursive: true });
const scope=JSON.parse(fs.readFileSync(path.join(root,"docs/erp-510/PASS_1_SCOPE.json"),"utf8"));
const migrationDir=path.join(root,"database/tenant/migrations");
const pass1MigrationNames=fs.readdirSync(migrationDir).filter((name)=>/^\d+_pass1_f015_f114_operational_gaps(?:_v\d+)?\.sql$/.test(name)).sort();
if(pass1MigrationNames.length<1) throw new Error("Expected at least one Pass-1 migration.");
const latestPass1Migration=pass1MigrationNames.sort((a,b)=>Number(a.split("_",1)[0])-Number(b.split("_",1)[0])).at(-1);
const PASS1_MIGRATION=`database/tenant/migrations/${latestPass1Migration}`;
if(scope.pass!==1||scope.of!==5||scope.features?.length!==100)throw new Error("PASS_1_SCOPE.json must contain exactly F015-F114.");
const expected=Array.from({length:100},(_,i)=>`F${String(i+15).padStart(3,"0")}`);
if(scope.features.some((f,i)=>f.id!==expected[i]))throw new Error("Pass 1 feature IDs are not contiguous F015-F114.");

const evidenceByModule={
  CRM:["services/api/src/modules/crm/index.js","services/api/src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js","apps/web/src/app/(app)/crm/activities/page.tsx","apps/web/tests/crm-lead-experience-contract.test.mjs"],
  Sales:["services/api/src/modules/sales/index.js","services/api/src/modules/sales/order-governance.js","services/api/src/modules/sales/pass1-operations.js","apps/web/src/app/(app)/sales/operations/page.tsx"],
  Procurement:["services/api/src/modules/procurement/index.js","services/api/src/modules/procurement/governance.js","services/api/src/modules/procurement/pass1-operations.js","apps/web/src/app/(app)/procurement/operations/page.tsx"],
  Stock:["services/api/src/modules/stock/index.js","apps/web/src/app/(app)/stock/operations/page.tsx","apps/web/src/app/(app)/stock/availability/page.tsx","services/api/src/core/master-data.js",PASS1_MIGRATION],
};
const special={
  F015:[PASS1_MIGRATION,"services/api/src/modules/crm/seller-activity-and-follow-up-workspace/task-operations.js","apps/web/src/app/api/crm/tasks/[id]/history/route.ts","services/api/src/modules/crm/crm-data-operations-and-customization/offline-sync.js"],
  F016:["apps/web/src/orchestration/work/follow-ups.ts"],
  F034:["services/api/src/modules/sales/pass1-operations.js","apps/web/src/modules/sales/components/pass1-operations-workspace.tsx","tenant.price_list_items"],
  F035:["services/api/src/modules/sales/pass1-operations.js","apps/web/src/modules/sales/components/pass1-operations-workspace.tsx","tenant.sales_pricing_rules"],
  F045:["services/api/src/orchestration/sales-stock-reservation.js"],
  F046:["services/api/src/orchestration/sales-stock-reservation.js","services/api/src/modules/stock/index.js"],
  F052:["services/api/src/modules/sales/pass1-operations.js","tenant.sales_advance_payments"],
  F055:["services/api/src/modules/sales/pass1-operations.js","tenant.sales_credit_adjustment_requests"],
  F056:["services/api/src/modules/sales/pass1-operations.js","tenant.sales_drop_ship_requests"],
  F057:["services/api/src/modules/sales/pass1-operations.js","tenant.sales_commission_rules","tenant.sales_commission_entries"],
  F069:["apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx","services/api/src/modules/procurement/index.js","tenant.procurement_sourcing_events"],
  F070:["apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx","services/api/src/modules/procurement/index.js","tenant.procurement_sourcing_invitations"],
  F071:["apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx","services/api/src/modules/procurement/index.js","tenant.procurement_sourcing_bids"],
  F072:["apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx","services/api/src/modules/procurement/index.js","tenant.procurement_sourcing_evaluations"],
  F073:["services/api/src/modules/procurement/index.js","apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx"],
  F079:["services/api/src/modules/procurement/pass1-operations.js","apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx","tenant.procurement_supplier_prices"],
  F083:["services/api/src/modules/procurement/index.js","apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx","tenant.procurement_returns"],
  F089:["services/api/src/modules/procurement/index.js","apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx","tenant.procurement_supplier_scorecards"],
  F090:["services/api/src/modules/procurement/index.js","apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx","tenant.procurement_supplier_scorecards"],
  F087:["services/api/src/modules/procurement/pass1-operations.js","tenant.procurement_landed_costs"],
  F091:["services/api/src/modules/procurement/pass1-operations.js","tenant.procurement_supplier_lead_times"],
  F094:["services/api/src/orchestration/reorder-purchasing.js","tenant.procurement_reorder_requests"],
  F095:["services/api/src/modules/procurement/pass1-operations.js","tenant.procurement_subcontract_orders"],
  F100:["services/api/src/core/master-data.js","apps/web/src/core/master-data.ts","tenant.item_variants"],
  F102:["services/api/src/core/master-data.js","apps/web/src/core/master-data.ts","tenant.item_uom_conversions"],
  F108:["services/api/src/modules/stock/index.js","apps/web/src/modules/stock/components/operations-workspace.tsx","apps/web/src/app/api/stock/movements/route.ts"],
  F109:["services/api/src/modules/stock/index.js","apps/web/src/modules/stock/components/operations-workspace.tsx","apps/web/src/app/api/stock/movements/route.ts"],
  F110:["services/api/src/modules/stock/index.js","apps/web/src/modules/stock/components/operations-workspace.tsx","apps/web/src/app/api/stock/transfers/route.ts"],
  F111:["services/api/src/modules/stock/index.js","apps/web/src/modules/stock/components/operations-workspace.tsx","apps/web/src/app/api/stock/movements/route.ts"],
  F112:["services/api/src/modules/stock/index.js","apps/web/src/modules/stock/components/availability-workspace.tsx"],
  F113:["services/api/src/modules/stock/index.js","apps/web/src/modules/stock/components/availability-workspace.tsx"],
  F114:["services/api/src/modules/stock/index.js","services/api/src/orchestration/sales-stock-reservation.js"],
};
const purpose={
  CRM:"Complete the canonical CRM workflow while preserving the shared Activity, customer and opportunity records already used by adjacent CRM capabilities.",
  Sales:"Complete the governed quotation-to-order-to-fulfilment-to-invoice workflow without duplicating customer, item, pricing, tax or accounting systems of record.",
  Procurement:"Complete requisition-to-sourcing-to-PO-to-receipt-to-matching operations while preserving Procurement ownership of purchasing records and orchestration boundaries.",
  Stock:"Complete the inventory system-of-record foundations for item setup, warehouses, balances, movements, reservations and promiseable availability.",
};
function featureEvidence(f){return [...new Set([...(evidenceByModule[f.module]||[]),...(special[f.id]||[]),"apps/web/tests/pass1-f015-f114.test.mjs"])];}
function spec(f){const ev=featureEvidence(f);return `# ERP-${f.id.slice(1)} — ${f.name}\n\n## Status\n\n- Feature ID: ${f.id}\n- Module: ${f.module}\n- Feature: ${f.name}\n- Priority: P0\n- Status: TESTING\n- UAT: NOT_READY\n- Pass: 1/5 (F015-F114)\n\n## Business Purpose\n\n${purpose[f.module]} This specification tracks the canonical requirement **${f.id} — ${f.name}**.\n\n## Implementation Contract\n\n- Use the frozen modular-monolith boundaries; do not create one source directory per feature ID.\n- Server authorization is authoritative. Preserve organisation, module entitlement, company, branch and record scope where applicable.\n- Use existing canonical records and public module contracts before introducing new persistence.\n- Mutations must be transactional, auditable, actionable on failure and idempotent where retries can occur.\n- No feature is marked COMPLETE by Pass 1 automation; named-human UAT remains a separate acceptance gate.\n\n## Technical Evidence\n\n${ev.map(x=>`- \`${x}\``).join("\n")}\n\n## Verification\n\nPass 1 must pass architecture boundaries, database structure verification, focused Pass-1 tests, Web/API regression suites and production build under repository-pinned Node 24/pnpm.\n\n## Manual UAT\n\nSee \`../05-uat/${f.id}-UAT.md\`.\n\n## Final Gate\n\nTechnical implementation status: **TESTING**. UAT status: **NOT_READY** until a named human validates the workflow and isolation matrix.\n`;}
function uat(f){return `# ${f.id} — ${f.name} — UAT\n\n## Status\n\n- Module: ${f.module}\n- Technical status: TESTING\n- Human UAT: NOT_READY\n\n## Required acceptance\n\n1. Sign in as an authorised user and verify the ${f.name} workflow is reachable from the normal product UI, not only by direct API call.\n2. Create or execute the primary workflow and verify valid state transitions persist after refresh.\n3. Try invalid, missing and stale input; verify the operation is rejected without partial mutation and the error is actionable.\n4. Verify an unauthorised role cannot perform the mutation even by calling the endpoint directly.\n5. Switch organisation/company/branch context where applicable and verify records never leak across scope.\n6. Verify audit/history/outbox evidence for meaningful mutations and ensure sensitive customer data is not copied unnecessarily.\n7. Verify desktop, tablet and mobile layouts keep the primary action reachable with keyboard-visible focus and no blocking horizontal overflow.\n8. Re-run the relevant action where retry/idempotency applies and verify duplicate business effects are not created.\n\n## Sign-off\n\n- Tester: ____________________\n- Date: ____________________\n- Result: PASS / FAIL\n- Notes: ____________________\n`}
for(const f of scope.features){
  fs.writeFileSync(path.join(root,"docs/erp-510/02-feature-specs",`ERP-${f.id.slice(1)}.md`),spec(f));
  fs.writeFileSync(path.join(root,"docs/erp-510/05-uat",`${f.id}-UAT.md`),uat(f));
}
function csv(value){const s=String(value??"");return /[",\n]/.test(s)?`"${s.replaceAll('"','""')}"`:s;}
const registerPath=path.join(root,"docs/erp-510/FEATURE_REGISTER.csv");
let lines=fs.readFileSync(registerPath,"utf8").trimEnd().split(/\r?\n/);
const featureMap=new Map(scope.features.map(f=>[f.id,f]));
for(let i=1;i<lines.length;i++){
  const first=lines[i].split(",",1)[0];
  const match=/^(?:ERP-|F)(\d{3})$/.exec(first);
  if(!match)continue;
  const id=`F${match[1]}`;const f=featureMap.get(id);if(!f)continue;
  const evidence=featureEvidence(f).filter(x=>!x.startsWith("tenant.")).join("; ");
  lines[i]=[id,f.module,f.name,"P0","TESTING","NOT_READY","protected core foundation; Pass 1 implementation","02-feature-specs/ERP-"+match[1]+".md; 05-uat/"+id+"-UAT.md",evidence,"Pass 1 technical implementation/evidence established; named-human authorization/isolation, functional, responsive and visual UAT remains pending."].map(csv).join(",");
}
fs.writeFileSync(registerPath,lines.join("\n")+"\n");
const evidence=`# Pass 1/5 — F015-F114 technical evidence\n\nPass 1 contains exactly 100 canonical requirements: CRM F015-F030, Sales F031-F062, Procurement F063-F096 and Stock F097-F114.\n\nThe implementation reuses existing mature capability code and closes identified gaps with governed CRM Task lifecycle/history, Sales-to-Stock availability/reservation orchestration, Sales advance/credit/drop-ship/commission operations, Procurement landed-cost/lead-time/reorder/subcontract operations, item variants/UOM conversion master data and Stock reservation/ATP primitives.\n\nNo feature in this pass is automatically marked COMPLETE. All 100 remain TESTING / NOT_READY until named-human UAT.\n`;
fs.writeFileSync(path.join(root,"docs/erp-510/04-test-evidence/PASS-1-F015-F114.md"),evidence);
console.log(`Materialized Pass 1 docs/register for ${scope.features.length} features.`);
