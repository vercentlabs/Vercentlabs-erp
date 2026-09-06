import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const create = read("src/modules/crm/components/lead-create-workspace.tsx");
const detail = read("src/modules/crm/components/lead-detail-workspace.tsx");
const combobox = read("src/modules/crm/components/lead-assignee-combobox.tsx");
const rules = read(
  "src/modules/crm/components/lead-assignment-rules-workspace.tsx",
);
const rulesPage = read("src/app/(app)/crm/assignment-rules/page.tsx");
const assignRoute = read("src/app/api/crm/leads/[id]/assign/route.ts");
const assigneesRoute = read("src/app/api/crm/leads/assignees/route.ts");
const policyRoute = read("src/app/api/crm/leads/assignment-policies/route.ts");
const genericRoute = read("src/app/api/crm/[resource]/[id]/route.ts");
const genericCollectionRoute = read("src/app/api/crm/[resource]/route.ts");
const detailData = read("src/modules/crm/server/lead-detail-data.ts");
const css = read("src/app/crm-lead-suite-enterprise.css");
const settings = read("src/app/(app)/crm/settings/page.tsx");

test("F005 UI: Create Lead uses governed searchable ownership and preserves automatic fallback", () => {
  assert.match(create, /<LeadAssigneeCombobox name="ownerUserId"/);
  assert.match(create, /delete body\.ownerUserId/);
  assert.match(create, /Leave blank to let the server apply/);
  assert.doesNotMatch(create, /options\.users\.map/);
});

test("F005 UI: Lead Detail exposes a human owner, inactive state, governed reassignment and history reason", () => {
  assert.match(detail, /lead\.ownerName \|\| "Unassigned"/);
  assert.match(detail, /lead\.ownerStatus === "inactive"/);
  assert.match(detail, />Change owner</);
  assert.match(detail, /<dialog/);
  assert.match(detail, /aria-labelledby="change-owner-title"/);
  assert.match(detail, /if \(!dialog\.open\) dialog\.showModal\(\)/);
  assert.match(detail, /onCloseRef\.current/);
  assert.doesNotMatch(detail, /if \(dialog\.open\) dialog\.close\(\)/);
  assert.match(detail, /\/api\/crm\/leads\/\$\{String\(lead\.id\)\}\/assign/);
  assert.match(detail, /assignmentReason\(event\)/);
  assert.match(detailData, /crm_lead_assignment_events/);
  assert.match(detailData, /policy\.name AS policy_name/);
  assert.doesNotMatch(detail, /ownerUserId\}\s*<\/strong>/);
});

test("F005 UI: assignee discovery is a server-backed accessible combobox", () => {
  assert.match(combobox, /role="combobox"/);
  assert.match(combobox, /aria-autocomplete="list"/);
  assert.match(combobox, /aria-activedescendant/);
  assert.match(combobox, /role="listbox"/);
  assert.match(combobox, /role="option"/);
  assert.match(combobox, /ArrowDown/);
  assert.match(combobox, /ArrowUp/);
  assert.match(combobox, /event\.key === "Escape"/);
  assert.match(combobox, /AbortController/);
  assert.match(combobox, /\/api\/crm\/leads\/assignees/);
  assert.match(combobox, /limit: "20"/);
});

test("F005 API: assignment requires same-origin, existing permissions, canonical domain logic and safe audit", () => {
  assert.match(assignRoute, /assertSameOrigin\(request\)/);
  assert.match(assignRoute, /PERMISSIONS\.crmLeadsManage/);
  assert.match(assignRoute, /PERMISSIONS\.crmRecordsViewAll/);
  assert.match(assignRoute, /assignLeadOwner/);
  assert.match(assignRoute, /tenantTransaction/);
  assert.match(assignRoute, /eventType: "crm\.leads\.assigned"/);
  assert.match(assignRoute, /previousOwnerUserId/);
  assert.match(assignRoute, /ownerUserId/);
});

test("F005 API: eligible-user discovery and rule configuration have independent server authorization", () => {
  assert.match(assigneesRoute, /PERMISSIONS\.crmSettingsManage/);
  assert.match(assigneesRoute, /PERMISSIONS\.crmLeadsManage/);
  assert.match(assigneesRoute, /listEligibleLeadAssignees/);
  assert.match(policyRoute, /PERMISSIONS\.crmSettingsManage/);
  assert.match(policyRoute, /assertSameOrigin\(request\)/);
  assert.match(policyRoute, /saveLeadAssignmentPolicy/);
  assert.match(policyRoute, /archiveLeadAssignmentPolicy/);
  assert.match(policyRoute, /setLeadAssignmentPolicyStatus/);
  assert.match(policyRoute, /\["fixed", "round_robin"\]/);
});

test("F005 API: generic owner PATCH cannot bypass or mix assignment with unrelated fields", () => {
  assert.match(genericRoute, /Object\.keys\(input\)\.length !== 1/);
  assert.match(genericRoute, /CRM_LEAD_ASSIGNMENT_REQUIRED/);
  assert.match(genericRoute, /assignLeadOwner/);
  assert.match(genericRoute, /crm\.leads\.assigned/);
  assert.match(genericRoute, /resource === "assignment-rules"/);
  assert.match(genericCollectionRoute, /CRM_ASSIGNMENT_RULE_API_MOVED/);
});

test("F005 rules UX is guided, priority-ordered and does not expose F020 routing", () => {
  assert.match(rulesPage, /PERMISSIONS\.crmSettingsManage/);
  assert.match(rulesPage, /\["fixed", "round_robin"\]/);
  assert.match(rules, /First eligible match wins/);
  assert.match(rules, /Lead source/);
  assert.match(rules, /Country/);
  assert.match(rules, /Industry/);
  assert.match(rules, /Product interest/);
  assert.match(rules, /<option value="fixed">Fixed owner<\/option>/);
  assert.match(rules, /<option value="round_robin">Round robin<\/option>/);
  assert.doesNotMatch(rules, /<option value="territory"/);
  assert.doesNotMatch(rules, /<option value="workload"/);
  assert.doesNotMatch(rules, /JSON\.stringify\(.*criteria/);
  assert.match(settings, /"Assignment rules", "assignment-rules"/);
});

test("F005 fallback owner and out-of-office are wired through the same governed policy route", () => {
  assert.match(policyRoute, /setLeadAssignmentFallback/);
  assert.match(policyRoute, /getLeadAssignmentFallback/);
  assert.match(policyRoute, /setLeadAssigneeAvailability/);
  assert.match(policyRoute, /listLeadAssigneeAvailability/);
  assert.match(policyRoute, /clearLeadAssigneeAvailability/);
  assert.match(policyRoute, /action === "set-fallback"/);
  assert.match(policyRoute, /action === "set-availability"/);
  assert.match(policyRoute, /action === "clear-availability"/);
  assert.match(rules, /Fallback owner/);
  assert.match(rules, /Out of office/);
  assert.match(rules, /action: "set-fallback"/);
  assert.match(rules, /action: "set-availability"/);
  assert.match(rules, /action: "clear-availability"/);
  assert.match(rulesPage, /getLeadAssignmentFallback/);
  assert.match(rulesPage, /listLeadAssigneeAvailability/);
});

test("F005 backend: automatic assignment skips out-of-office candidates and falls back to a defined owner", () => {
  const governance = read("../../services/api/src/modules/crm/lead-governance.js");
  assert.match(governance, /crm_lead_assignee_availability/);
  assert.match(governance, /reason: "fallback_queue"/);
  assert.match(governance, /A manager explicitly picking a specific owner/);
});

test("F005 backend: the Lead SLA reassignment timer now runs on a schedule, not only on manual demand", () => {
  const handler = read("../../services/worker/src/handlers/crm-lead-sla-scan.js");
  assert.match(handler, /scanLeadSlaBreaches/);
  assert.match(handler, /crm\.leads\.manage/);
  const scheduler = read("../../services/worker/src/scheduler.js");
  assert.match(scheduler, /LEAD_SLA_SCAN_JOB_TYPE/);
  assert.match(scheduler, /lead-sla-scan-tick/);
});

test("F005 responsive CSS keeps dialogs, selectors and rules usable on tablets and phones", () => {
  assert.match(
    css,
    /\.crm-owner-dialog\s*\{[\s\S]*width: min\(520px, calc\(100vw - 32px\)\)/,
  );
  assert.match(css, /input\[role="combobox"\][\s\S]*min-height: 44px/);
  assert.match(
    css,
    /@media \(max-width: 768px\)[\s\S]*crm-assignment-rule-list/,
  );
  assert.match(
    css,
    /@media \(max-width: 520px\)[\s\S]*width: calc\(100vw - 16px\)/,
  );
  assert.match(
    css,
    /crm-assignment-rule-actions > button[\s\S]*min-height: 44px/,
  );
  assert.match(
    css,
    /crm-lead-detail-facts > div:first-child \.link-button[\s\S]*min-height: 40px/,
  );
  assert.match(css, /prefers-reduced-motion: reduce/);
});
