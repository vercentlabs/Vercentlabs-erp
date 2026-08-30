import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root=path.resolve(import.meta.dirname,"../../..");
const read=(file)=>fs.readFileSync(path.join(root,file),"utf8");
const exists=(file)=>fs.existsSync(path.join(root,file));
const scope=JSON.parse(read("docs/erp-510/PASS_1_SCOPE.json"));

function pass1MigrationPath(){
  const dir=path.join(root,"database/tenant/migrations");
  const matches=fs.readdirSync(dir).filter((name)=>/^\d+_pass1_f015_f114_operational_gaps(?:_v\d+)?\.sql$/.test(name)).sort();
  assert.ok(matches.length>=1,`Expected at least one Pass-1 operational-gaps migration, found ${matches.length}`);
  const latest=matches.sort((a,b)=>Number(a.split("_",1)[0])-Number(b.split("_",1)[0])).at(-1);
  return `database/tenant/migrations/${latest}`;
}
const PASS1_MIGRATION=pass1MigrationPath();

function ids(start,end){return Array.from({length:end-start+1},(_,i)=>`F${String(start+i).padStart(3,"0")}`)}

test("Pass 1 scope is exactly the canonical contiguous F015-F114 block",()=>{
  assert.equal(scope.pass,1);assert.equal(scope.of,5);assert.equal(scope.features.length,100);
  assert.deepEqual(scope.features.map((f)=>f.id),ids(15,114));
  assert.deepEqual([...new Set(scope.features.map((f)=>f.module))],["CRM","Sales","Procurement","Stock"]);
});

test("module feature catalogues preserve permanent IDs and exact pass-1 counts",()=>{
  const crm=read("apps/web/src/modules/crm/scope.ts"),sales=read("apps/web/src/modules/sales/scope.ts"),proc=read("apps/web/src/modules/procurement/scope.ts"),stock=read("apps/web/src/modules/stock/scope.ts");
  for(const f of scope.features){const source=f.module==="CRM"?crm:f.module==="Sales"?sales:f.module==="Procurement"?proc:stock;assert.match(source,new RegExp(`\\[\\"${f.id}\\",\\s*\\"${f.name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")}\\"\\]`),`${f.id} missing from ${f.module} catalogue`)}
});

test("F015 Tasks has a dedicated governed lifecycle over crm_activities",()=>{
  const task=read("services/api/src/modules/crm/task-operations.js");const migration=read(PASS1_MIGRATION);const offline=read("services/api/src/modules/crm/offline-sync.js");
  for(const token of ["createCrmTask","updateCrmTask","startCrmTask","completeCrmTask","cancelCrmTask","listCrmTaskHistory","crm.task.created"])assert.match(task,new RegExp(token));
  assert.match(task,/activity_type='task'/);assert.match(migration,/crm_task_events/);assert.match(migration,/crm_task_events_immutable_f015/);assert.match(migration,/FORCE ROW LEVEL SECURITY/);
  assert.match(offline,/createCrmTask/);assert.match(offline,/completeCrmTask/);
  for(const file of ["apps/web/src/app/api/crm/tasks/[id]/start/route.ts","apps/web/src/app/api/crm/tasks/[id]/cancel/route.ts","apps/web/src/app/api/crm/tasks/[id]/history/route.ts"])assert.ok(exists(file),file);
});

test("F016-F030 remain backed by the existing mature CRM workspaces and services",()=>{
  const enterprise=read("apps/web/tests/crm-lead-suite-enterprise.test.mjs");const crm=read("services/api/src/modules/crm/index.js");const comm=read("services/api/src/modules/crm/communications.js");const follow=read("apps/web/src/orchestration/work/follow-ups.ts");const detail=read("apps/web/src/modules/crm/components/lead-detail-workspace.tsx");
  assert.match(follow,/listMyFollowUps/);assert.match(detail,/Complete lead timeline/);assert.match(comm,/crm_communications/);
  for(const token of ["crm_opportunities","crm_activities","getCrmDashboard","getCrmReport","convertCrmLead","findCrmDuplicates"])assert.match(crm,new RegExp(token));
  assert.match(read("apps/web/src/app/api/crm/leads/[id]/notes/route.ts"),/crm_notes/);
  for(const id of ["F016","F017","F019","F020","F021","F022","F023","F025","F026","F027","F028","F029","F030"])assert.match(enterprise,new RegExp(id));
  assert.ok(exists("apps/web/src/app/api/crm/leads/[id]/attachments/route.ts"));assert.ok(exists("apps/web/src/app/api/crm/leads/[id]/notes/route.ts"));
});

test("Sales F031-F044 and F047-F051/F053-F054/F058-F062 retain governed document/order foundations",()=>{
  const sales=read("services/api/src/modules/sales/index.js");const governance=read("services/api/src/modules/sales/order-governance.js");const migration=read("database/tenant/migrations/008_sales_module.sql");
  for(const token of ["sales_quotations","sales_quotation_versions","sales_orders","sales_order_versions","sales_order_lines","sales_order_line_progress","sales_fulfillment_requests","sales_invoice_requests"])assert.match(migration,new RegExp(token));
  for(const token of ["createQuotation","confirmSalesOrder","createFulfillmentRequest","createInvoiceRequest"])assert.match(sales,new RegExp(token));
  for(const token of ["reserveSalesOrderLines","createSalesReturnRequest","evaluateSalesOrderHealth"])assert.match(governance,new RegExp(token));
});

test("F045-F046 use Sales-to-Stock orchestration rather than foreign-table DML",()=>{
  const orchestration=read("services/api/src/orchestration/sales-stock-reservation.js");const stock=read("services/api/src/modules/stock/index.js");
  for(const token of ["checkSalesOrderLineAvailability","reserveSalesOrderLineFromStock","getStockAvailability","reserveStock","reserveSalesOrderLines"])assert.match(orchestration,new RegExp(token));
  assert.match(stock,/availableToPromise/);assert.doesNotMatch(orchestration,/UPDATE\s+tenant\.(?:stock_|sales_)/i);
});

test("F034-F035 Sales pricing is operator-managed and consumed by the governed pricing engine",()=>{
  const service=read("services/api/src/modules/sales/pass1-operations.js");const route=read("apps/web/src/app/api/sales/pass1-operations/route.ts");const ui=read("apps/web/src/modules/sales/components/pass1-operations-workspace.tsx");const pricing=read("services/api/src/modules/sales/index.js");
  for(const fn of ["upsertSalesPriceListItem","upsertSalesCustomerPrice"])assert.match(service,new RegExp(fn));
  assert.match(service,/tenant\.price_list_items/);assert.match(service,/tenant\.sales_pricing_rules/);assert.match(service,/sales\.settings\.manage/);assert.match(service,/party_type IN \('customer','both'\)/);
  for(const action of ["upsert-price-list-item","upsert-customer-price"])assert.match(route,new RegExp(action));
  for(const label of ["Maintain price-list rate","Maintain customer-specific price","Price-list rates","Customer pricing rules"])assert.match(ui,new RegExp(label));
  assert.match(pricing,/FROM tenant\.price_list_items/);assert.match(pricing,/FROM tenant\.sales_pricing_rules/);
});

test("F052/F055/F056/F057 have durable Sales operations and an end-user workspace",()=>{
  const migration=read(PASS1_MIGRATION);const service=read("services/api/src/modules/sales/pass1-operations.js");const ui=read("apps/web/src/modules/sales/components/pass1-operations-workspace.tsx");
  for(const table of ["sales_advance_payments","sales_credit_adjustment_requests","sales_drop_ship_requests","sales_commission_rules","sales_commission_entries"])assert.match(migration,new RegExp(table));
  for(const fn of ["recordSalesAdvancePayment","requestSalesCreditAdjustment","createSalesDropShipRequest","createSalesCommissionRule","accrueSalesCommission"])assert.match(service,new RegExp(fn));
  for(const action of ["record-advance","request-adjustment","create-drop-ship","create-commission-rule","accrue-commission","check-availability","reserve-stock"])assert.match(ui,new RegExp(action));
  assert.ok(exists("apps/web/src/app/(app)/sales/operations/page.tsx"));
});

test("Procurement F063-F086/F088-F090/F092-F093/F096 retain the mature procurement document engine",()=>{
  const service=read("services/api/src/modules/procurement/index.js");const governance=read("services/api/src/modules/procurement/governance.js");const migration=read("database/tenant/migrations/012_procurement_module.sql");
  for(const table of ["procurement_suppliers","procurement_requisitions","procurement_sourcing_events","procurement_agreements","procurement_purchase_orders","procurement_receipts","procurement_returns","procurement_matching_records"])assert.match(migration,new RegExp(table));
  for(const token of ["suppliers","requisitions","sourcing-events","agreements","purchase-orders","receipts","returns","match-exceptions"])assert.match(service,new RegExp(`\\"${token}\\"`));
  assert.match(governance,/supplier/i);assert.match(governance,/order/i);assert.match(governance,/requisition/i);
});

test("F069-F073/F079/F083/F089-F090 Procurement sourcing, supplier pricing, returns and scorecards are normal operator workflows",()=>{
  const route=read("apps/web/src/app/api/procurement/pass1-operations/route.ts");const ui=read("apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx");const service=read("services/api/src/modules/procurement/pass1-operations.js");const engine=read("services/api/src/modules/procurement/index.js");const migration=read(PASS1_MIGRATION);
  assert.match(migration,/procurement_supplier_prices/);assert.match(service,/upsertSupplierPurchasePrice/);assert.match(service,/procurement\.catalog\.manage/);
  for(const action of ["create-sourcing-invitation","record-supplier-bid","record-sourcing-evaluation","record-supplier-scorecard","create-purchase-return","upsert-supplier-price"]) { assert.match(route,new RegExp(action)); assert.match(ui,new RegExp(action)); }
  for(const resource of ["sourcing-invitations","sourcing-bids","sourcing-evaluations","supplier-scorecards","returns"])assert.match(engine,new RegExp(`\"${resource}\"`));
  for(const label of ["RFQ invitations","Supplier quotations / bids","Bid evaluations","Supplier scorecards","Purchase returns","Supplier purchase prices"])assert.match(ui,new RegExp(label));
});

test("F087/F091/F094/F095 close identified Procurement operational gaps",()=>{
  const migration=read(PASS1_MIGRATION);const service=read("services/api/src/modules/procurement/pass1-operations.js");const reorder=read("services/api/src/orchestration/reorder-purchasing.js");const ui=read("apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx");
  for(const table of ["procurement_landed_costs","procurement_supplier_lead_times","procurement_reorder_requests","procurement_subcontract_orders"])assert.match(migration,new RegExp(table));
  for(const fn of ["createProcurementLandedCost","upsertSupplierLeadTime","createProcurementReorderRequest","createProcurementSubcontractOrder"])assert.match(service,new RegExp(fn));
  assert.match(reorder,/listStockReorderCandidates/);assert.match(reorder,/createProcurementReorderRequest/);assert.doesNotMatch(reorder,/INSERT\s+INTO\s+tenant\./i);
  for(const action of ["create-landed-cost","upsert-lead-time","generate-reorders","create-subcontract"])assert.match(ui,new RegExp(action));
});

test("F097-F105 shared item/warehouse foundations include variants and UOM conversions",()=>{
  const shared=read("database/tenant/migrations/001_business_data_foundation.sql");const migration=read(PASS1_MIGRATION);const master=read("services/api/src/core/master-data.js");const web=read("apps/web/src/core/master-data.ts");
  for(const token of ["units_of_measure","item_groups","items","item_uom_conversions","warehouses","warehouse_locations"])assert.match(shared,new RegExp(token));
  assert.match(migration,/tenant\.item_variants/);assert.match(master,/"item-variants"/);assert.match(master,/"item-uom-conversions"/);assert.match(web,/"item-variants"/);assert.match(web,/"item-uom-conversions"/);
});

test("F106-F114 Stock has governed balance, ledger, receipt/issue/transfer/adjustment, reservation and ATP workflows",()=>{
  const stock=read("services/api/src/modules/stock/index.js");const baseMigration=read("database/tenant/migrations/044_stock_module.sql");const passMigration=read(PASS1_MIGRATION);const availabilityUi=read("apps/web/src/modules/stock/components/availability-workspace.tsx");const operationsUi=read("apps/web/src/modules/stock/components/operations-workspace.tsx");
  for(const token of ["stock_balances","stock_movements","stock_transfers","stock_reservations","stock_reorder_rules"])assert.match(baseMigration,new RegExp(token));
  for(const fn of ["postStockMovement","createStockTransfer","completeStockTransfer","getStockAvailability","reserveStock","releaseStockReservation","listStockReorderCandidates","stockDimension"])assert.match(stock,new RegExp(fn));
  assert.match(stock,/STOCK_ADJUSTMENT_DIRECTION_INVALID/);assert.match(stock,/idempotency_key=\$2/);assert.match(stock,/transfer:\$\{t\.id\}:issue/);assert.match(stock,/INSUFFICIENT_STOCK/);assert.match(stock,/availableToPromise/);
  assert.match(passMigration,/stock_transfers_idempotency_idx/);
  for(const label of ["Goods receipt","Goods issue","Adjustment","Internal transfer","Movement ledger","Transfer register"])assert.match(operationsUi,new RegExp(label));
  assert.match(availabilityUi,/Check availability/);assert.match(availabilityUi,/Reserve stock/);assert.match(availabilityUi,/Release/);
});

test("F108-F111 Stock mutation routes enforce same-origin checks and transaction-coupled audit",()=>{
  for(const file of ["apps/web/src/app/api/stock/movements/route.ts","apps/web/src/app/api/stock/transfers/route.ts","apps/web/src/app/api/stock/transfers/[id]/complete/route.ts"]){const source=read(file);assert.match(source,/assertSameOrigin\(request\)/);assert.match(source,/audit\(/);assert.match(source,/tenantTransaction/);}
  assert.ok(exists("apps/web/src/app/(app)/stock/operations/page.tsx"));
});

test("Pass 1 UI is reachable from normal module navigation",()=>{
  const nav=read("apps/web/src/core/navigation/modules.ts");
  for(const route of ["/sales/operations","/procurement/operations","/stock/operations","/stock/availability"])assert.match(nav,new RegExp(route.replaceAll("/","\\/")));
  for(const route of ["apps/web/src/app/(app)/sales/operations/page.tsx","apps/web/src/app/(app)/procurement/operations/page.tsx","apps/web/src/app/(app)/stock/operations/page.tsx","apps/web/src/app/(app)/stock/availability/page.tsx"])assert.ok(exists(route),route);
});

test("Pass 1 register/spec/UAT materialization never claims COMPLETE before human acceptance",()=>{
  const register=read("docs/erp-510/FEATURE_REGISTER.csv");
  for(const f of scope.features){assert.match(register,new RegExp(`^${f.id},${f.module.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")},`,"m"));assert.ok(exists(`docs/erp-510/02-feature-specs/ERP-${f.id.slice(1)}.md`));assert.ok(exists(`docs/erp-510/05-uat/${f.id}-UAT.md`));const spec=read(`docs/erp-510/02-feature-specs/ERP-${f.id.slice(1)}.md`);assert.match(spec,new RegExp(`Feature ID: ${f.id}`));assert.match(spec,/Status: TESTING/);assert.doesNotMatch(spec,/Status: COMPLETE/)}
  assert.doesNotMatch(register,/^ERP-(?:0(?:1[5-9]|[2-9]\d)|1(?:0\d|1[0-4])),/m);
});

test("Pass 1 mutation routes retain transactional platform audit and scoped cross-module errors",()=>{
  const salesRoute=read("apps/web/src/app/api/sales/pass1-operations/route.ts");
  const procurementRoute=read("apps/web/src/app/api/procurement/pass1-operations/route.ts");
  const stockCreate=read("apps/web/src/app/api/stock/reservations/route.ts");
  const stockClose=read("apps/web/src/app/api/stock/reservations/[id]/route.ts");
  const stockMovement=read("apps/web/src/app/api/stock/movements/route.ts");const stockTransfer=read("apps/web/src/app/api/stock/transfers/route.ts");const stockTransferComplete=read("apps/web/src/app/api/stock/transfers/[id]/complete/route.ts");
  const salesOrchestration=read("services/api/src/orchestration/sales-stock-reservation.js");
  const salesOps=read("services/api/src/modules/sales/pass1-operations.js");
  for(const source of [salesRoute,procurementRoute,stockCreate,stockClose,stockMovement,stockTransfer,stockTransferComplete]){assert.match(source,/audit\(/);assert.match(source,/tenantTransaction/)}
  assert.match(salesOrchestration,/SALES_STOCK_CONTEXT_INVALID/);assert.match(salesOrchestration,/SALES_STOCK_COMPANY_MISMATCH/);
  assert.match(salesOps,/ruleScope = companySql/);
});

test("Pass 1 TypeScript contracts expose new API functions and master-data schemas", () => {
  const apiTypes = read("services/api/src/index.d.ts");
  for (const symbol of [
    "createCrmTask", "updateCrmTask", "startCrmTask", "completeCrmTask", "cancelCrmTask", "listCrmTaskHistory",
    "recordSalesAdvancePayment", "requestSalesCreditAdjustment", "createSalesDropShipRequest", "createSalesCommissionRule",
    "accrueSalesCommission", "upsertSalesPriceListItem", "upsertSalesCustomerPrice", "listSalesPass1Operations",
    "checkSalesOrderLineAvailability", "reserveSalesOrderLineFromStock", "listSalesPass1CrossModuleOptions",
    "createProcurementLandedCost", "createProcurementSubcontractOrder", "generateReorderPurchasingRequests",
    "listProcurementPass1Operations", "listProcurementPass1Options", "upsertSupplierLeadTime", "upsertSupplierPurchasePrice",
    "getStockAvailability", "listStockOperationOptions", "reserveStock", "releaseStockReservation",
  ]) assert.match(apiTypes, new RegExp(`export function ${symbol}\\b`), `${symbol} must be exported by @vercentlabs/api types`);

  const validation = read("apps/web/src/core/master-data-validation.ts");
  assert.match(validation, /const itemVariantSchema = z\.object/);
  assert.match(validation, /const itemUomConversionSchema = z\.object/);
  assert.match(validation, /"item-variants": itemVariantSchema/);
  assert.match(validation, /"item-uom-conversions": itemUomConversionSchema/);
  assert.match(validation, /"item-variants": itemVariantSchema\.partial\(\)/);
  assert.match(validation, /"item-uom-conversions": itemUomConversionSchema\.partial\(\)/);
});

test("Pass 1 HTTP boundaries preserve strict TypeScript service contracts", () => {
  const crmCreate = read("apps/web/src/app/api/crm/[resource]/route.ts");
  assert.match(crmCreate, /const taskInput: Record<string, unknown> = \{ \.\.\.input \}/);
  assert.doesNotMatch(crmCreate, /const taskInput = isTask \? .* : null/);

  for (const file of [
    "apps/web/src/app/api/crm/tasks/[id]/start/route.ts",
    "apps/web/src/app/api/crm/tasks/[id]/cancel/route.ts",
  ]) {
    const route = read(file);
    assert.match(route, /typeof rawInput !== "object" \|\| Array\.isArray\(rawInput\)/);
    assert.match(route, /const input = rawInput as Record<string, unknown>/);
  }

  for (const file of [
    "apps/web/src/app/api/sales/pass1-operations/route.ts",
    "apps/web/src/app/api/procurement/pass1-operations/route.ts",
  ]) {
    const route = read(file);
    assert.match(route, /const rawLimit = url\.searchParams\.get\("limit"\)/);
    assert.match(route, /const limit = rawLimit === null \? 100 : Number\(rawLimit\)/);
    assert.match(route, /Number\.isInteger\(limit\)/);
    assert.doesNotMatch(route, /limit:\s*url\.searchParams\.get\("limit"\)\s*\|\|\s*100/);
  }
});


test("Pass 1 client workspaces follow the repository lint-safe async effect pattern", () => {
  for (const file of [
    "apps/web/src/modules/sales/components/pass1-operations-workspace.tsx",
    "apps/web/src/modules/procurement/components/pass1-operations-workspace.tsx",
    "apps/web/src/modules/stock/components/availability-workspace.tsx",
    "apps/web/src/modules/stock/components/operations-workspace.tsx",
  ]) {
    const source = read(file);
    assert.match(source, /useEffect\(\(\) => \{/);
    assert.match(source, /let cancelled = false/);
    assert.match(source, /new AbortController\(\)/);
    assert.match(source, /\.then\(/);
    assert.match(source, /controller\.abort\(\)/);
    assert.doesNotMatch(source, /useEffect\([^\n]*void\s+load/i);
    assert.doesNotMatch(source, /eslint-disable-line\s+react-hooks\/exhaustive-deps/);
  }
});


test("Pass 1 write boundaries validate cross-module references and malformed payloads before persistence", () => {
  const salesRoute = read("apps/web/src/app/api/sales/pass1-operations/route.ts");
  const salesOrchestration = read("services/api/src/orchestration/sales-pass1-options.js");
  const salesOps = read("services/api/src/modules/sales/pass1-operations.js");
  assert.match(salesRoute, /createSalesDropShipWithSupplierValidation/);
  assert.match(salesOrchestration, /getProcurementRecord/);
  assert.match(salesOrchestration, /SALES_DROP_SHIP_SUPPLIER_INVALID/);
  assert.match(salesOps, /organization_memberships/);
  assert.match(salesOps, /SALES_USER_SCOPE_INVALID/);
  assert.match(salesOps, /users: users\.rows/);

  const procurementOps = read("services/api/src/modules/procurement/pass1-operations.js");
  assert.match(procurementOps, /async function activeItem/);
  assert.match(procurementOps, /PROCUREMENT_LEAD_TIME_DATE_INVALID/);
  assert.match(procurementOps, /PROCUREMENT_SUBCONTRACT_DATE_INVALID/);

  const stock = read("services/api/src/modules/stock/index.js");
  const stockValidation = read("apps/web/src/modules/stock/validation.ts");
  assert.match(stockValidation, /assertStockUuid/);
  assert.match(stockValidation, /STOCK_REFERENCE_INVALID/);
  assert.match(stock, /await stockDimension\(client, c, \{/);

  for (const file of [
    "apps/web/src/app/api/sales/pass1-operations/route.ts",
    "apps/web/src/app/api/procurement/pass1-operations/route.ts",
    "apps/web/src/app/api/stock/movements/route.ts",
    "apps/web/src/app/api/stock/transfers/route.ts",
    "apps/web/src/app/api/stock/reservations/route.ts",
    "apps/web/src/app/api/stock/reservations/[id]/route.ts",
  ]) {
    const route = read(file);
    assert.match(route, /readJson\(request\)/);
    assert.match(route, /Array\.isArray\(/);
  }
});
