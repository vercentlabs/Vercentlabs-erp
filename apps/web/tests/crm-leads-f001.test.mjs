import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (path) =>
  fs.readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("F001 web: lead model requires first name but accepts any contact method", () => {
  const definition = read("src/modules/crm/crm-data-operations-and-customization/resource-definitions/prospect-and-relationship.ts");
  assert.match(definition, /name: "firstName"[\s\S]{0,120}required: true/);
  const mobileBlock =
    definition.match(/\{\s*name: "mobile"[\s\S]*?\},/m)?.[0] || "";
  assert.doesNotMatch(mobileBlock, /required:\s*true/);
});

test("F001 web: create validation enforces email-or-mobile-or-phone", () => {
  const validation = read("src/modules/crm/crm-data-operations-and-customization/input-validation.ts");
  assert.match(validation, /key === "leads" && requireRequiredFields/);
  assert.match(validation, /\["email", "mobile", "phone"\]/);
  assert.match(validation, /Provide at least one contact method/);
});

test("F001 web: create workspace no longer hard-requires mobile", () => {
  const workspace = read(
    "src/modules/crm/prospect-and-relationship-master-data/lead-create-workspace.tsx",
  );
  const mobileMarker = 'name="mobile"';
  const markerIndex = workspace.indexOf(mobileMarker);
  const inputStart = workspace.lastIndexOf("<input", markerIndex);
  const inputEnd = workspace.indexOf("/>", markerIndex);
  const mobileInput =
    markerIndex >= 0 && inputStart >= 0 && inputEnd >= 0
      ? workspace.slice(inputStart, inputEnd + 2)
      : "";
  assert.ok(mobileInput, "mobile input should exist");
  assert.doesNotMatch(mobileInput, /\brequired\b/);
  assert.match(
    workspace,
    /Work\s+email,\s+mobile number or alternate number/,
  );
});

test("F001 web: country and all three contact methods are available end-to-end", () => {
  const definition = read("src/modules/crm/crm-data-operations-and-customization/resource-definitions/prospect-and-relationship.ts");
  const create = read("src/modules/crm/prospect-and-relationship-master-data/lead-create-workspace.tsx");
  const detail = read("src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx");
  for (const source of [definition, create, detail])
    assert.match(source, /countryCode/);
  assert.match(detail, /Alternate phone/);
});

test("F001 web: edit preserves omitted fields and keeps ownership on the governed assignment path", () => {
  const manager = read("src/modules/crm/crm-data-operations-and-customization/resource-manager.tsx");
  const workspace = read("src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx");
  const detail = read("src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx");
  const page = read("src/app/(app)/crm/[resource]/page.tsx");
  assert.match(manager, /elements\.namedItem\(field\.name\)/);
  assert.match(manager, /if \(!control\) continue/);
  assert.match(workspace, /field\.name !== "ownerUserId"/);
  assert.match(detail, /canAssignOwner[\s\S]*Change owner/);
  assert.match(page, /PERMISSIONS\.crmRecordsViewAll/);
});

test("F001 web: archive is available on detail with explicit preservation copy", () => {
  const detail = read("src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx");
  const manager = read("src/modules/crm/crm-data-operations-and-customization/resource-manager.tsx");
  for (const source of [detail, manager]) {
    assert.match(source, /Historical information is preserved/);
    assert.match(source, /method: "DELETE"/);
  }
  assert.match(detail, /Archive lead/);
  assert.match(detail, /router\.push\("\/crm\/leads"\)/);
});

test("F001 API: the default collection omits archived Leads", () => {
  const service = read("../../services/api/src/modules/crm/crm-data-operations-and-customization/resource-query-service.js") + read("../../services/api/src/modules/crm/crm-data-operations-and-customization/resource-registry.js");
  assert.match(service, /\["archived", "converted"\]\.includes\(String\(filters\.status/);
  assert.match(service, /record_status = 'active'/);
});

test("F001 web/API: lead CRUD is guarded, transactional and audited", () => {
  const collectionRoute = read("src/app/api/crm/[resource]/route.ts");
  const itemRoute = read("src/app/api/crm/[resource]/[id]/route.ts");

  for (const source of [collectionRoute, itemRoute]) {
    assert.match(source, /crmApiContext/);
    assert.match(source, /tenantTransaction/);
  }
  assert.match(collectionRoute, /requireCrmResourceView/);
  assert.match(collectionRoute, /requireCrmManage/);
  assert.match(collectionRoute, /requireBillingWriteAccess/);
  assert.match(collectionRoute, /eventType: `crm\.\$\{resource\}\.created`/);
  assert.match(itemRoute, /requireCrmResourceView/);
  assert.match(itemRoute, /requireCrmManage/);
  assert.match(itemRoute, /requireBillingWriteAccess/);
  assert.match(itemRoute, /eventType: `crm\.\$\{resource\}\.updated`/);
  assert.match(itemRoute, /eventType: `crm\.\$\{resource\}\.archived`/);
});
