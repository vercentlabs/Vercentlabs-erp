import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("F012 Web: CRM Setup keeps Sales stages in the canonical Pipeline group", () => {
  const setup = read("apps/web/src/app/(app)/crm/settings/page.tsx");
  assert.match(setup, /title: "Pipeline"/);
  assert.match(setup, /\["Sales stages", "stages"/);
  const scope = read("apps/web/src/modules/crm/scope.ts");
  assert.match(scope, /\["F012", "Sales stages"\]/);
});

test("F012 Web: dedicated page is settings-authorized and reads governed stage services", () => {
  const page = read("apps/web/src/app/(app)/crm/stages/page.tsx");
  for (const token of ["crmSettingsManage", "listSalesStagePipelines", "listSalesStages", "listSalesStageHistory", "tenantTransaction", "SalesStagesWorkspace"])
    assert.match(page, new RegExp(token));
  assert.match(page, /requestedPipelineId/);
});

test("F012 Web: workspace supports pipeline selection, create/edit, reorder, deactivate/reactivate and audit history", () => {
  const component = read("apps/web/src/modules/crm/components/sales-stages-workspace.tsx");
  assert.match(component, /aria-label="Select sales-stage pipeline"/);
  assert.match(component, /Add stage/);
  assert.match(component, /Edit sales stage/);
  assert.match(component, /action: "reorder"/);
  assert.match(component, /action: active \? "reactivate" : "deactivate"/);
  assert.match(component, /expectedUpdatedAt: stage\.updatedAt/);
  assert.match(component, /entries: ordered\.map\(\(row\) => \(\{ id: row\.id, expectedUpdatedAt: row\.updatedAt \}\)\)/);
  assert.match(component, /Recent stage configuration changes/);
  assert.match(component, /Stage configuration is prospective/);
});

test("F012 Web: stage editor presents one terminal type instead of independently forgeable Won/Lost flags", () => {
  const component = read("apps/web/src/modules/crm/components/sales-stages-workspace.tsx");
  assert.match(component, /name="stageType"/);
  assert.match(component, /<option value="open">Open<\/option>/);
  assert.match(component, /<option value="won">Won<\/option>/);
  assert.match(component, /<option value="lost">Lost<\/option>/);
  assert.doesNotMatch(component, /name="isWon"|name="isLost"/);
  assert.match(component, /Won is fixed at 100%/);
  assert.match(component, /Lost is fixed at 0%/);
});

test("F012 Web: dedicated APIs preserve origin, permission, billing, transaction and audit controls", () => {
  const collection = read("apps/web/src/app/api/crm/sales-stages/route.ts");
  const record = read("apps/web/src/app/api/crm/sales-stages/[id]/route.ts");
  for (const source of [collection, record]) {
    assert.match(source, /assertSameOrigin\(request\)/);
    assert.match(source, /PERMISSIONS\.crmSettingsManage/);
    assert.match(source, /requireBillingWriteAccess/);
    assert.match(source, /incrementBillingUsage/);
    assert.match(source, /tenantTransaction/);
    assert.match(source, /audit\(/);
  }
  assert.match(collection, /createSalesStage/);
  assert.match(collection, /reorderSalesStages/);
  assert.match(record, /updateSalesStage/);
  assert.match(record, /setSalesStageActive/);
});

test("F012 Web: generic Web and mobile writes are redirected to governed Sales Stages", () => {
  const collection = read("apps/web/src/app/api/crm/[resource]/route.ts");
  const record = read("apps/web/src/app/api/crm/[resource]/[id]/route.ts");
  const mobileCollection = read("apps/web/src/app/api/mobile/v1/crm/[resource]/route.ts");
  const mobileRecord = read("apps/web/src/app/api/mobile/v1/crm/[resource]/[id]/route.ts");
  assert.match(collection, /CRM_SALES_STAGE_API_MOVED/);
  assert.equal((record.match(/CRM_SALES_STAGE_API_MOVED/g) || []).length, 2);
  assert.match(mobileCollection, /CRM_SALES_STAGE_API_MOVED/);
  assert.equal((mobileRecord.match(/CRM_SALES_STAGE_API_MOVED/g) || []).length, 2);
});

test("F012 Web: responsive stage workspace is globally imported and keyboard controls retain 44px targets", () => {
  const layout = read("apps/web/src/app/layout.tsx");
  const css = read("apps/web/src/app/crm-sales-stages.css");
  assert.match(layout, /crm-sales-stages\.css/);
  assert.match(css, /@media\(max-width:980px\)/);
  assert.match(css, /@media\(max-width:640px\)/);
  assert.match(css, /min-height:44px/);
  assert.match(css, /prefers-reduced-motion/);
});

test("F012 documentation/register remain canonical and reflect verified production-ready status",()=>{
  const spec = read("docs/03-modules/crm/features/F012-sales-stages.md");
  assert.match(spec,/Canonical ID: `F012`/);
  assert.match(spec,/Canonical name: \*\*Sales stages\*\*/i);
  assert.match(spec,/Implementation status: `IMPLEMENTED`/);
  assert.match(spec,/Product status: `PRODUCTION_READY`/);
  assert.match(read("docs/02-register/FEATURE_REGISTER.csv"), /^F012,CRM,Sales stages,SPECIFICATION_READY,IMPLEMENTED,PRODUCTION_READY,/m);
});



test("F012 Web: drawer state initialization never performs synchronous setState inside the dialog effect", () => {
  const component = read("apps/web/src/modules/crm/components/sales-stages-workspace.tsx");
  const effectStart = component.indexOf("useEffect(() => {");
  const effectEnd = component.indexOf("}, [editing]);", effectStart);
  const effect = component.slice(effectStart, effectEnd);
  assert.doesNotMatch(effect, /setStageTypeValue/);
  assert.match(component, /function openEditor\(stage: Stage \| null\)/);
  assert.match(component, /setStageTypeValue\(stage\?\.stageType \|\| "open"\)/);
  assert.match(component, /onClick=\{\(\) => openEditor\(null\)\}/);
  assert.match(component, /onClick=\{\(\) => openEditor\(stage\)\}/);
});
