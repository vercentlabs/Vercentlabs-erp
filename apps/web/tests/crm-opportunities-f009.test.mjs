import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("F009 web: Opportunities remains a reachable governed CRM resource", () => {
  const definition = read("apps/web/src/modules/crm/index.ts");
  const manager = read("apps/web/src/modules/crm/components/resource-manager.tsx");
  assert.match(definition, /opportunities:\s*\{/);
  assert.match(definition, /Opportunity name/);
  assert.match(definition, /permission: PERMISSIONS\.crmOpportunitiesManage/);
  assert.match(manager, /"opportunities"/);
  assert.match(manager, /\/crm\/\$\{definition\.key\}\/\$\{String\(row\.id\)\}/);
});

test("F009 web: derived forecast fields are not editable in generic Opportunity forms", () => {
  const definition = read("apps/web/src/modules/crm/index.ts");
  const manager = read("apps/web/src/modules/crm/components/resource-manager.tsx");
  assert.match(definition, /name: "probability"[\s\S]{0,120}formHidden: true/);
  assert.match(definition, /name: "forecastCategory"[\s\S]{0,300}formHidden: true/);
  assert.match(manager, /definition\.fields\.filter\(\(field\) => !field\.formHidden\)/);
});

test("F009 web: generic routes preserve auth, module gate, permission, transaction and audit boundaries", () => {
  const collection = read("apps/web/src/app/api/crm/[resource]/route.ts");
  const detail = read("apps/web/src/app/api/crm/[resource]/[id]/route.ts");
  for (const source of [collection, detail]) {
    assert.match(source, /crmApiContext\(session\)/);
    assert.match(source, /tenantTransaction/);
    assert.match(source, /crmAuditSnapshot/);
  }
  assert.match(collection, /createCrmRecord/);
  assert.match(detail, /updateCrmRecord/);
  assert.match(detail, /archiveCrmRecord/);
});

test("F009 web: Opportunity audit snapshots exclude free-text/commercial payloads", () => {
  const audit = read("apps/web/src/modules/crm/audit.ts");
  const opportunityBlock = audit.split('resource === "opportunities"')[1]?.split('if (resource !== "leads")')[0] || "";
  for (const key of ["id", "code", "status", "ownerUserId", "companyId", "branchId", "leadId", "partyId", "contactId", "pipelineId", "stageId"])
    assert.match(opportunityBlock, new RegExp(`${key}:`));
  assert.doesNotMatch(opportunityBlock, /description:|nextStep:|customData:|amount:/);
});

test("F009 web: Opportunity detail is owner-scoped, actionable and responsive through the existing record workspace", () => {
  const page = read("apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx");
  assert.match(page, /getCrmRecord\(client, context, "opportunities", id\)/);
  assert.match(page, /href={`\/crm\/opportunities\?edit=/);
  assert.match(page, /crm-record-page crm-opportunity-page/);
  assert.match(page, /CrmOpportunityActions/);
});

test("F009 web: later features remain explicitly separate", () => {
  const spec = read("docs/erp-510/02-feature-specs/ERP-009.md");
  assert.match(spec, /F010 Opportunity Pipeline/);
  assert.match(spec, /F011 Probability and Expected Revenue/);
  assert.match(spec, /F012 Sales Stages/);
  assert.match(spec, /F023 Opportunity-to-Quotation Conversion/);
  assert.match(spec, /not claimed/i);
});
