import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const readJoined = (...files) => files.map(read).join("\n");

const retiredScreenFiles = [
  "apps/web/src/app/(app)/crm/lead-acquisition/page.tsx",
  "apps/web/src/app/(app)/crm/lead-intelligence/page.tsx",
  "apps/web/src/app/(app)/crm/communications/page.tsx",
  "apps/web/src/app/(app)/crm/opportunity-revenue/page.tsx",
  "apps/web/src/app/(app)/crm/mobile-readiness/page.tsx",
  "apps/web/src/app/(app)/crm/privacy-retention/page.tsx",
  "apps/web/src/app/(app)/crm/privacy-requests/[id]/page.tsx",
];

test("canonical CRM scope contains F001-F030 exactly once and in order", () => {
  const source = read("apps/web/src/modules/crm/crm-data-operations-and-customization/capability-registry.ts");
  const ids = [...source.matchAll(/\["(F\d{3})",/g)].map((match) => match[1]);
  assert.deepEqual(
    ids,
    Array.from(
      { length: 30 },
      (_, index) => `F${String(index + 1).padStart(3, "0")}`,
    ),
  );
});

test("CRM navigation exposes workspaces, not thirty unrelated actions", () => {
  const fullSource = read("apps/web/src/core/navigation/modules.ts");
  const source = fullSource.split('label: "CRM"')[1].split('label: "Sales"')[0];
  for (const href of [
    "/crm",
    "/crm/leads",
    "/crm/accounts",
    "/crm/contacts",
    "/crm/opportunities",
    "/crm/pipeline",
    "/crm/forecast",
    "/crm/activities",
    "/crm/reports",
    "/crm/settings",
  ]) {
    assert.match(source, new RegExp(`href: "${href.replaceAll("/", "\\/")}"`));
  }
  for (const retired of [
    "lead-acquisition",
    "lead-intelligence",
    "communications",
    "opportunity-revenue",
    "privacy-retention",
    "mobile-readiness",
  ]) {
    assert.doesNotMatch(source, new RegExp(retired));
  }
});

test("retired CRM screens are physically removed rather than kept as parallel product workspaces", () => {
  for (const file of retiredScreenFiles) {
    assert.equal(
      fs.existsSync(path.join(root, file)),
      false,
      `${file} should be removed from the product surface`,
    );
  }
  for (const component of [
    "lead-acquisition-workspace.tsx",
    "lead-intelligence-workspace.tsx",
    "privacy-actions.tsx",
    "privacy-retention-manager.tsx",
    "section-tabs.tsx",
    "account-intelligence-actions.tsx",
    "contact-merge-actions.tsx",
  ]) {
    assert.equal(
      fs.existsSync(
        path.join(root, "apps/web/src/modules/crm/components", component),
      ),
      false,
      `${component} should be retired`,
    );
  }
});

test("generic CRM page and API are fenced by canonical resource allowlists", () => {
  assert.match(
    read("apps/web/src/app/(app)/crm/[resource]/page.tsx"),
    /isCrmUiResource/,
  );
  assert.match(
    read("apps/web/src/app/api/crm/[resource]/route.ts"),
    /isCrmApiResource/,
  );
  assert.match(
    read("apps/web/src/app/api/crm/[resource]/[id]/route.ts"),
    /isCrmApiResource/,
  );
  const importAdapter = read("apps/web/src/app/api/crm/[resource]/import/route.ts");
  const exportImplementation = read("apps/web/src/app/api/crm/[resource]/export/route.ts");
  assert.match(importAdapter, /route-handlers\/lead-import/);
  const importImplementation = read(
    "apps/web/src/modules/crm/crm-data-operations-and-customization/route-handlers/lead-import.ts",
  );
  assert.match(importImplementation, /resource !== "leads"/);
  assert.match(exportImplementation, /resource !== "leads"/);
});

test("F001-F008/F016-F019/F022/F027 core lead workspace keeps governed lifecycle, history and score actions", () => {
  const source = read(
    "apps/web/src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx",
  );
  for (const tab of [
    "overview",
    "timeline",
    "activities",
    "communications",
    "notes",
    "opportunities",
    "score",
    "duplicates",
  ]) {
    assert.match(source, new RegExp(`"${tab}"`));
  }
  assert.match(source, /\/api\/crm\/leads\/\$\{id\}\/stage/);
  assert.match(source, /\/api\/crm\/leads\/\$\{id\}\/follow-up/);
  assert.match(source, /\/api\/crm\/leads\/\$\{id\}\/convert/);
  assert.match(source, /\/api\/crm\/leads\/\$\{id\}\/score/);
  assert.doesNotMatch(source, /lead-intelligence\/scores/);
  assert.doesNotMatch(
    source,
    /<small>Campaign<\/small>|href=\"\/crm\/communications/,
  );
});

test("F013-F016 use one focused Activities workspace with server-side type and due filters", () => {
  const page = readJoined(
    "apps/web/src/app/(app)/crm/activities/page.tsx",
    "apps/web/src/modules/crm/seller-activity-and-follow-up-workspace/activity-workspace-page.tsx",
  );
  const service = read(
    "services/api/src/modules/crm/crm-data-operations-and-customization/resource-query-service.js",
  );
  for (const type of ["call", "meeting", "task", "email", "whatsapp", "sms"])
    assert.match(page, new RegExp(`"${type}"`));
  for (const due of ["today", "overdue", "upcoming"])
    assert.match(page, new RegExp(`"${due}"`));
  assert.match(service, /filters\.activityType/);
  assert.match(page, /preservedQuery/);
});

test("F020/F004/F005/F012/F026/F027/F028 configuration stays inside focused CRM Setup", () => {
  const page = read("apps/web/src/app/(app)/crm/settings/page.tsx");
  for (const resource of [
    "sources",
    "assignment-rules",
    "lead-scoring",
    "pipelines",
    "stages",
    "lost-reasons",
    "sales-teams",
    "sales-team-members",
    "territories",
    "territory-assignments",
    "tags",
  ]) {
    assert.match(page, new RegExp(resource));
  }
  for (const retired of [
    "campaigns",
    "sequences",
    "competitors",
    "privacy",
    "partner",
    "buying-committee",
    "custom-objects",
    "ai-predictions",
  ]) {
    assert.doesNotMatch(page, new RegExp(retired, "i"));
  }
});

test("F021 import/export is lead-only", () => {
  const generic = read("apps/web/src/app/(app)/crm/[resource]/page.tsx");
  assert.match(generic, /canImport=\{\s*resource === "leads"/);
  assert.match(generic, /canExport=\{\s*resource === "leads"/);
  const accounts = read("apps/web/src/app/(app)/crm/accounts/page.tsx");
  const accountWorkspace = read(
    "apps/web/src/modules/crm/prospect-and-relationship-master-data/accounts-workspace.tsx",
  );
  assert.doesNotMatch(accounts, /canImport|\/import/);
  assert.doesNotMatch(accountWorkspace, /Import CSV|\/import/);
  const contacts = read("apps/web/src/app/(app)/crm/contacts/page.tsx");
  const contactWorkspace = read(
    "apps/web/src/modules/crm/prospect-and-relationship-master-data/contacts-workspace.tsx",
  );
  assert.doesNotMatch(contacts, /canImport|\/import/);
  assert.doesNotMatch(contactWorkspace, /Import CSV|\/import/);
});

test("F025/F030 expose dedicated forecast and only canonical reports", () => {
  const forecast = read("apps/web/src/app/(app)/crm/forecast/page.tsx");
  const reports = read("apps/web/src/app/(app)/crm/reports/page.tsx");
  assert.match(forecast, /getCrmReport\(client, context, "forecast"\)/);
  for (const key of [
    "pipeline",
    "conversion",
    "sources",
    "activities",
    "forecast",
  ])
    assert.match(reports, new RegExp(`${key}:`));
  assert.match(reports, /CRM_REPORT_KEYS/);
});

test("F026 won/lost reasons are modeled on terminal stage transitions", () => {
  const migration = read(
    "database/tenant/migrations/056_crm_f001_f030_outcome_reasons.sql",
  );
  const service = read("services/api/src/modules/crm/opportunity-and-pipeline-governance/opportunity-transitions.js");
  const action = read(
    "apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-actions.tsx",
  );
  assert.match(migration, /outcome_type/);
  assert.match(migration, /outcome_reason_id/);
  assert.match(migration, /ON DELETE SET NULL \(outcome_reason_id\)/);
  assert.match(service, /CRM_OUTCOME_REASON_REQUIRED/);
  assert.match(service, /CRM_OUTCOME_REASON_INVALID/);
  assert.match(action, /outcomeReasonId/);
  assert.match(action, /outcomeNotes/);
});

test("F023 opportunity detail keeps governed quotation conversion and removes competitor intelligence", () => {
  const source = read("apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx");
  assert.match(source, /quotation/i);
  assert.match(source, /expected revenue/i);
  assert.doesNotMatch(
    source,
    /competitor intelligence|CrmOpportunityRevenue|battlecard/i,
  );
});

test("F017 notes and attachments are first-class lead record capabilities with governed storage and audit", () => {
  const detail = read(
    "apps/web/src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx",
  );
  const upload = read(
    "apps/web/src/app/api/crm/leads/[id]/attachments/route.ts",
  );
  const item = read(
    "apps/web/src/app/api/crm/leads/[id]/attachments/[attachmentId]/route.ts",
  );
  const migration = read(
    "database/platform/migrations/033_attachment_content.sql",
  );
  assert.match(detail, /Attachments/);
  assert.match(detail, /\/api\/crm\/leads\/\$\{id\}\/attachments/);
  assert.match(upload, /validateAttachment/);
  assert.match(upload, /crm\.lead\.attachment_uploaded/);
  assert.match(item, /crm\.lead\.attachment_deleted/);
  assert.match(item, /Content-Disposition/);
  assert.match(migration, /content bytea/);
  assert.match(migration, /content_sha256/);
});

test("F028 tags and custom fields are editable on lead detail and remain governed/audited", () => {
  const detail = read(
    "apps/web/src/modules/crm/prospect-and-relationship-master-data/lead-detail-workspace.tsx",
  );
  const tags = readJoined(
    "apps/web/src/app/api/crm/leads/[id]/tags/route.ts",
    "apps/web/src/modules/crm/prospect-and-relationship-master-data/route-handlers/lead-tags.ts",
  );
  const custom = read(
    "apps/web/src/app/api/crm/leads/[id]/custom-fields/route.ts",
  );
  assert.match(detail, /Fields & tags/);
  assert.match(detail, /Save tags/);
  assert.match(detail, /Save custom fields/);
  assert.match(tags, /crm\.lead\.tags_updated/);
  assert.match(tags, /crm_lead_tags/);
  assert.match(custom, /crm\.lead\.custom_fields_updated/);
  assert.match(custom, /updateCrmRecord/);
});

test("F029 bulk lead operations remain governed and cannot bypass conversion/archive", () => {
  const workspace = read(
    "apps/web/src/modules/crm/prospect-and-relationship-master-data/leads-workspace.tsx",
  );
  const service = read("services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-operations.js");
  assert.match(workspace, /bulk/i);
  assert.match(service, /crm\.records\.view_all/);
  assert.match(service, /CRM_LEAD_STAGE_ACTION_REQUIRED/);
  assert.match(service, /"status", "stage", "stageId", "stageCode", "recordStatus"/);
  assert.match(service, /record_status='active'/);
});

test("responsive CRM HCI covers desktop, tablet, phone, keyboard focus and reduced motion", () => {
  const css = read("apps/web/src/app/crm-experience.css");
  const layout = read("apps/web/src/app/layout.tsx");
  for (const bp of ["1200", "960", "680", "420"])
    assert.match(css, new RegExp(`max-width:\\s*${bp}px`));
  assert.match(css, /--crm-touch:\s*44px/);
  assert.match(css, /:focus-visible/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(layout, /crm-experience\.css/);
  assert.ok(
    layout.indexOf('import "./crm-experience.css";') >
      layout.indexOf('import "./workspace-redesign-v3.css";'),
  );
});

test("mobile CRM navigation prioritizes recognition and frequent work", () => {
  const source = read("apps/web/src/core/components/bottom-nav.tsx");
  for (const label of ["Overview", "Leads", "Pipeline", "Activities", "More"])
    assert.match(source, new RegExp(`label: "${label}"`));
  assert.match(source, /open-mobile-drawer/);
});

test("public lead-capture transport remains available without becoming a retired product workspace", () => {
  const route = readJoined(
    "apps/web/src/app/api/crm/lead-acquisition/public/email/[token]/route.ts",
    "apps/web/src/modules/crm/prospect-and-relationship-master-data/route-handlers/public-inbound-email.ts",
  );
  const service = read("services/api/src/modules/crm/prospect-and-relationship-master-data/lead-acquisition.js");
  assert.match(route, /ingestLeadAcquisitionWebhook/);
  assert.match(service, /resolveLeadAssignment/);
  assert.doesNotMatch(service, /resolveLeadOwner/);
  assert.equal(
    fs.existsSync(
      path.join(root, "apps/web/src/app/(app)/crm/lead-acquisition/page.tsx"),
    ),
    false,
  );
});
