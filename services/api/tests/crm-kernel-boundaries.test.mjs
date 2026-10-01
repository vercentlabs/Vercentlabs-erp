// Kernel primitives moved below their users (record-kernel dependency
// cleanup): each keeps one implementation, the old import paths and the
// public package re-export the same binding, and behaviour is unchanged.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import * as api from "../src/index.js";
import * as crm from "../src/modules/crm/index.js";
import { resolveCrmEntityAccess } from "../src/modules/crm/data-management/entity-access.js";
import { resolveCrmEntityAccess as timelineEntityAccess, getCrmTimelinePage } from "../src/modules/crm/activities/timeline/timeline.js";
import * as communicationAccess from "../src/modules/crm/data-management/communication-access.js";
import * as communicationProjection from "../src/modules/crm/activities/communications/communication-projection.js";
import { taskOverdueSql } from "../src/modules/crm/data-management/activity-query-rules.js";
import { taskOverdueSql as taskOperationsOverdueSql } from "../src/modules/crm/activities/task-operations.js";
import * as qualificationFields from "../src/modules/crm/lead-management/qualification-fields.js";
import * as leadQualification from "../src/modules/crm/lead-management/lead-qualification.js";
import { projectCrmRecord, recordScope } from "../src/modules/crm/data-management/record-policy.js";
import { resources } from "../src/modules/crm/data-management/resource-registry.js";
import {
  assertGenericLeadLinkedTarget,
  assertLeadExpectedVersion,
  assertQualificationCriterionFieldsValid,
  assertRecordExpectedVersion,
} from "../src/modules/crm/data-management/resource-validation.js";
import { assertSalesTeamParentAllowed, assertTerritoryParentAllowed } from "../src/modules/crm/sales-organization/hierarchy-rules.js";
import { listRecordTags } from "../src/modules/crm/data-management/tag-assignment.js";

const crmRoot = fileURLToPath(new URL("../src/modules/crm/", import.meta.url));
const runtimeFiles = (dir = crmRoot) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? runtimeFiles(path.join(dir, entry.name)) : /\.m?js$/.test(entry.name) ? [path.join(dir, entry.name)] : [],
  );
const local = (file) => path.relative(crmRoot, file).split(path.sep).join("/");
const definers = (pattern) => runtimeFiles().filter((file) => pattern.test(fs.readFileSync(file, "utf8"))).map(local).sort();

const ORG = "11111111-1111-4111-8111-111111111111";
const USER = "22222222-2222-4222-8222-222222222222";
const LEAD = "33333333-3333-4333-8333-333333333333";
const OTHER = "44444444-4444-4444-8444-444444444444";
const rep = { organizationId: ORG, userId: USER, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.view"] };
const sensitiveRep = { ...rep, permissions: ["crm.view", "crm.leads.view_sensitive", "crm.records.view_all"] };

function recordingClient(respond = () => ({ rows: [] })) {
  const calls = [];
  return { calls, query: async (sql, values) => { calls.push({ sql, values }); return respond(sql, values); } };
}

// ------------------------------------------------------------ entity access

test("entity access has one implementation, shared by every record-attached surface", () => {
  assert.deepEqual(definers(/function resolveCrmEntityAccess\b/), ["data-management/entity-access.js"]);
  assert.equal(timelineEntityAccess, resolveCrmEntityAccess);
  assert.equal(crm.resolveCrmEntityAccess, resolveCrmEntityAccess);
  assert.equal(api.resolveCrmEntityAccess, resolveCrmEntityAccess);
  for (const consumer of [
    "activities/timeline/timeline.js",
    "activities/notes/notes-operations.js",
    "activities/attachments/attachments-operations.js",
    "activities/communications/email-service.js",
    "data-management/custom-field-runtime.js",
    "data-management/tag-assignment.js",
  ]) {
    const source = fs.readFileSync(path.join(crmRoot, consumer), "utf8");
    assert.match(source, /import \{ resolveCrmEntityAccess \} from "[./]*(?:data-management\/)?entity-access\.js";/, consumer);
  }
});

test("entity access keeps its validation errors, permission gate and scoped lookups", async () => {
  await assert.rejects(resolveCrmEntityAccess(recordingClient(), rep, "invoice", LEAD), { status: 400, code: "CRM_TIMELINE_ENTITY_INVALID" });
  await assert.rejects(resolveCrmEntityAccess(recordingClient(), rep, "lead", "not-a-uuid"), { status: 400, code: "CRM_TIMELINE_ENTITY_INVALID" });

  const denied = recordingClient();
  assert.equal(await resolveCrmEntityAccess(denied, rep, "lead", LEAD), false);
  assert.equal(denied.calls.length, 0, "no sensitive Lead permission: no lookup at all");

  const found = recordingClient((sql) => (sql.includes("tenant.crm_leads lead") ? { rows: [{ id: LEAD }] } : { rows: [] }));
  assert.equal(await resolveCrmEntityAccess(found, sensitiveRep, "lead", LEAD), true);
  assert.match(found.calls[0].sql, /lead\.record_status <> 'archived'/);
  assert.deepEqual(found.calls[0].values.slice(0, 2), [ORG, LEAD]);

  const campaign = recordingClient(() => ({ rows: [{ id: LEAD, company_id: OTHER }] }));
  assert.equal(await resolveCrmEntityAccess(campaign, { ...rep, activeCompanyId: "55555555-5555-4555-8555-555555555555" }, "campaign", LEAD), false);
});

test("Timeline and Tags treat no entity access as empty, not as an error", async () => {
  const timelineClient = recordingClient();
  assert.deepEqual(await getCrmTimelinePage(timelineClient, rep, "lead", LEAD), { rows: [], hasMore: false, nextCursor: null });
  assert.equal(timelineClient.calls.length, 0);
  const tagsClient = recordingClient();
  assert.deepEqual(await listRecordTags(tagsClient, rep, "lead", LEAD), []);
  assert.equal(tagsClient.calls.length, 0);
});

// ------------------------------------------------------- communication access

test("communication audience and content rules have one implementation behind the old paths", () => {
  for (const name of ["communicationVisibilitySql", "projectCrmCommunication", "projectCrmCommunications", "resolveCallerParticipantCommunicationIds"]) {
    assert.equal(communicationProjection[name], communicationAccess[name], name);
    assert.equal(crm[name], communicationAccess[name], name);
    assert.equal(api[name], communicationAccess[name], name);
    assert.deepEqual(definers(new RegExp(`function ${name}\\b`)), ["data-management/communication-access.js"], name);
  }
  assert.equal(crm.resolveCommunicationParticipants, communicationProjection.resolveCommunicationParticipants);
  assert.equal("resolveCommunicationParticipants" in communicationAccess, false, "participant persistence stays with the communication services");
});

test("communication content projection still honours sender, participant and sensitive-permission visibility", async () => {
  const row = { id: LEAD, channel: "email", direction: "outbound", status: "sent", subject: "Pricing", body: "Secret", created_by: OTHER };
  assert.deepEqual(communicationAccess.projectCrmCommunication(row, rep), {
    id: LEAD, channel: "email", direction: "outbound", status: "sent", contentVisibility: "metadata", redacted: true,
  });
  assert.equal(communicationAccess.projectCrmCommunication(row, rep, { isParticipant: true }).contentVisibility, "full");
  assert.equal(communicationAccess.projectCrmCommunication({ ...row, created_by: USER }, rep).contentVisibility, "full");
  assert.equal(communicationAccess.projectCrmCommunication(row, sensitiveRep).body, "Secret");
  // Generic record projection dispatches communications to the same rule.
  assert.equal((await projectCrmRecord(recordingClient(), rep, "communications", row)).redacted, true);
});

test("generic communication scope still carries the audience fragment and view-all override", () => {
  const values = [ORG];
  const sql = recordScope(resources.communications, rep, values);
  assert.match(sql, /record\.visibility='team' OR record\.created_by=\$\d+ OR \$\d+::boolean OR \(record\.visibility='participant'/);
  assert.ok(values.includes(USER));
  assert.ok(values.includes(false), "a representative cannot override private communications");
  const ownerValues = [ORG];
  recordScope(resources.communications, { ...rep, roleSlugs: ["organization_owner"] }, ownerValues);
  assert.ok(ownerValues.includes(true), "the organization owner keeps the private-content override");
});

// ------------------------------------------------------ overdue predicate

test("the overdue predicate has one definition and every overdue filter uses it", () => {
  assert.equal(taskOperationsOverdueSql, taskOverdueSql);
  assert.equal(crm.taskOverdueSql, taskOverdueSql);
  assert.equal(api.taskOverdueSql, taskOverdueSql);
  assert.equal(taskOverdueSql("record"), "record.due_at<now() AND record.status NOT IN ('completed','cancelled')");
  assert.deepEqual(definers(/function taskOverdueSql\b/), ["data-management/activity-query-rules.js"]);
  assert.deepEqual(definers(/\.due_at<now\(\) AND [\w.]*status NOT IN \('completed','cancelled'\)/), [], "no hand-written copy of the predicate");
  for (const user of ["data-management/resource-query-service.js", "analytics/analytics-service.js", "activities/task-operations.js", "activities/call-operations.js", "activities/follow-ups/follow-up-operations.js"])
    assert.match(fs.readFileSync(path.join(crmRoot, user), "utf8"), /taskOverdueSql\("(?:activity|record)"\)/, user);
});

// --------------------------------------------- Lead-linked targets and versions

test("Lead-linked generic records still require a visible Lead or prediction", async () => {
  const noQuery = recordingClient();
  await assert.rejects(
    assertGenericLeadLinkedTarget(noQuery, rep, "consent-events", { leadId: LEAD }),
    { status: 403, code: "CRM_LEAD_SENSITIVE_CONTENT_FORBIDDEN" },
  );
  await assertGenericLeadLinkedTarget(noQuery, rep, "data-quality-scores", { entityType: "party", entityId: LEAD });
  await assert.rejects(
    assertGenericLeadLinkedTarget(noQuery, sensitiveRep, "enrichment-jobs", { entityType: "Lead", entityId: " " }),
    { status: 400, code: "CRM_LEAD_REFERENCE_REQUIRED" },
  );
  assert.equal(noQuery.calls.length, 0);

  const missing = recordingClient();
  await assert.rejects(assertGenericLeadLinkedTarget(missing, sensitiveRep, "consent-events", { leadId: LEAD }), { status: 404, message: "CRM record not found." });
  assert.match(missing.calls[0].sql, /FROM tenant\.crm_leads record WHERE record\.organization_id = \$1 AND record\.id = \$2/);

  const prediction = recordingClient();
  await assert.rejects(assertGenericLeadLinkedTarget(prediction, sensitiveRep, "ai-feedback", { predictionId: LEAD }), { status: 404 });
  assert.match(prediction.calls[0].sql, /FROM tenant\.crm_ai_predictions record/);
});

test("record version checks keep the Lead and per-entity conflict codes", () => {
  const record = { updatedAt: new Date("2026-09-04T07:05:38.575Z") };
  assert.throws(() => assertLeadExpectedVersion(record, "", true), { status: 400, code: "CRM_LEAD_VERSION_REQUIRED" });
  assert.throws(() => assertLeadExpectedVersion(record, "2026-09-04T07:05:38.574Z"), { status: 409, code: "CRM_STALE_WRITE" });
  assert.doesNotThrow(() => assertLeadExpectedVersion(record, "2026-09-04T07:05:38.575Z", true));
  assert.throws(() => assertRecordExpectedVersion(record, "nope", false, "Territory", "CRM_TERRITORY"), { status: 400, code: "CRM_TERRITORY_VERSION_INVALID" });
});

// ------------------------------------------------- Lead qualification fields

test("qualification field rules have one implementation behind the Lead Qualification exports", () => {
  for (const name of ["LEAD_QUALIFICATION_MUTATION_FIELDS", "LeadQualificationError", "READINESS_FIELD_COLUMNS", "assertNoQualificationMutation"]) {
    assert.equal(leadQualification[name], qualificationFields[name], name);
    assert.equal(api[name], qualificationFields[name], name);
  }
  assert.throws(
    () => qualificationFields.assertNoQualificationMutation({ qualification_state: "qualified" }),
    (error) => error instanceof leadQualification.LeadQualificationError && error.status === 409 && error.code === "CRM_LEAD_QUALIFICATION_ACTION_REQUIRED",
  );
  assert.doesNotThrow(() => assertQualificationCriterionFieldsValid({ fieldKeys: ["score"], checkType: "minimum_threshold", threshold: 60 }));
  assert.throws(() => assertQualificationCriterionFieldsValid({ fieldKeys: ["salary"] }), { status: 400, code: "CRM_QUALIFICATION_CRITERION_FIELD_INVALID" });
});

// ---------------------------------------------------------- F020 hierarchy

test("F020 hierarchy rules reject self-parent and ancestor cycles for territories and sales teams", async () => {
  const quiet = recordingClient();
  await assertTerritoryParentAllowed(quiet, rep, "sales-teams", LEAD, { parentTerritoryId: LEAD });
  await assertTerritoryParentAllowed(quiet, rep, "territories", LEAD, { name: "North" });
  await assertSalesTeamParentAllowed(quiet, rep, "territories", LEAD, { parentTeamId: LEAD });
  assert.equal(quiet.calls.length, 0);

  await assert.rejects(assertTerritoryParentAllowed(quiet, rep, "territories", LEAD, { parentTerritoryId: LEAD }), { status: 409, code: "CRM_TERRITORY_HIERARCHY_SELF_PARENT" });
  await assert.rejects(assertSalesTeamParentAllowed(quiet, rep, "sales-teams", LEAD, { parentTeamId: LEAD }), { status: 409, code: "CRM_SALES_TEAM_HIERARCHY_SELF_PARENT" });

  const cycle = recordingClient(() => ({ rows: [{ "?column?": 1 }] }));
  await assert.rejects(assertTerritoryParentAllowed(cycle, rep, "territories", LEAD, { parentTerritoryId: OTHER }), { status: 409, code: "CRM_TERRITORY_HIERARCHY_CYCLE" });
  assert.match(cycle.calls[0].sql, /FROM tenant\.crm_territories territory/);
  assert.deepEqual(cycle.calls[0].values, [ORG, OTHER, LEAD]);
  await assert.rejects(assertSalesTeamParentAllowed(cycle, rep, "sales-teams", LEAD, { parentTeamId: OTHER }), { status: 409, code: "CRM_SALES_TEAM_HIERARCHY_CYCLE" });
  assert.match(cycle.calls[1].sql, /FROM tenant\.crm_sales_teams team/);

  const clear = recordingClient();
  await assertTerritoryParentAllowed(clear, rep, "territories", LEAD, { parentTerritoryId: OTHER });
  await assertSalesTeamParentAllowed(clear, rep, "sales-teams", LEAD, { parentTeamId: OTHER });
  assert.equal(clear.calls.length, 2);
});
