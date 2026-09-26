// Workflow engine, shared reporting and PDF documents against real
// PostgreSQL (restricted runtime role), driven through the real CRM/Sales
// domain functions and the worker's own processing code.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createMemoryObjectStorage } from "../../../packages/document-engine/src/index.js";
import { buildWorkspaceAccessSnapshot } from "../../../services/api/src/core/access/index.js";
import { setTenantConfiguration } from "../../../services/api/src/core/platform/configuration/index.js";
import { publishDomainEvent } from "../../../services/api/src/core/platform/events/index.js";
import { setObjectStorageForTests } from "../../../services/api/src/core/platform/files/index.js";
import { setNotificationPreference } from "../../../services/api/src/core/platform/notifications/index.js";
import { createWorkflow, listWorkflowRuns, setWorkflowStatus } from "../../../services/api/src/core/platform/workflows/index.js";
import { recordLeadAssignment } from "../../../services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-assignment.js";
import { renderAuthorizedDocument } from "../../../services/api/src/orchestration/documents/registry.js";
import {
  createReportDefinition,
  executeReportRun,
  listReportDatasets,
  listReportRuns,
  readReportRunOutput,
  requestReportRun,
} from "../../../services/api/src/orchestration/reporting/service.js";
import { dispatchOrganizationEvents, processOrganizationWorkflows } from "../../../services/worker/src/webhooks.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";

async function enableModules(kit, organizationId, keys) {
  for (const key of keys) {
    await kit.owner.query(
      `INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at) VALUES ($1,$2,$2,'enabled',now())
       ON CONFLICT (organization_id, module_key) DO UPDATE SET status='enabled', enabled_at=now()`,
      [organizationId, key],
    );
  }
}

async function grantRole(kit, organizationId, userId, permissions) {
  const role = (await kit.owner.query(`INSERT INTO roles (organization_id, name, slug) VALUES ($1,$2,$3) RETURNING id`, [organizationId, `RT ${randomUUID().slice(0, 6)}`, `rt-${randomUUID().slice(0, 8)}`])).rows[0];
  for (const permission of permissions) await kit.owner.query(`INSERT INTO role_permissions (role_id, permission_key) VALUES ($1,$2)`, [role.id, permission]);
  await kit.owner.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status, starts_at, reason) VALUES ($1,$2,$3,true,'active',now(),'test')`, [organizationId, userId, role.id]);
}

test("automations: registered triggers and actions, conditions, idempotency, preferences, loops", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin", "rep"]);
    const other = await kit.organization(["x"]);
    const admin = org.session("admin", ["platform.workflows.manage", "crm.view", "crm.leads.manage"]);
    const rep = org.session("rep", ["crm.view", "crm.leads.manage"]);
    const tx = (work) => kit.tenant(org.organizationId, work);
    const process = async () => {
      await dispatchOrganizationEvents(kit.pool, org.organizationId);
      await processOrganizationWorkflows(kit.pool, org.organizationId);
    };
    const notifications = async () => (await kit.owner.query(`SELECT * FROM notifications WHERE organization_id=$1 AND user_id=$2 AND category='crm_workflow' ORDER BY created_at`, [org.organizationId, org.ids.rep])).rows;
    const assign = async () => {
      const leadId = await kit.crmLead(org, org.ids.admin, "Asha", `Rao-${randomUUID().slice(0, 4)}`);
      await kit.tenant(org.organizationId, (client) => recordLeadAssignment(client, admin, { leadId, previousOwnerUserId: org.ids.admin, ownerUserId: org.ids.rep, leadName: "Asha Rao" }));
      return leadId;
    };

    const workflow = await tx((client) =>
      createWorkflow(client, admin, {
        name: "Tell new owners",
        trigger: "crm.leads.assigned",
        conditions: [{ field: "ownerUserId", operator: "equals", value: org.ids.rep }],
        actions: [{ type: "notify", recipient: { type: "event_field", field: "ownerUserId" }, title: "A lead was assigned to you", message: "Please follow up today." }],
        status: "active",
      }),
    );
    const neverMatches = await tx((client) =>
      createWorkflow(client, admin, {
        name: "Only for admin",
        trigger: "crm.leads.assigned",
        conditions: [{ field: "ownerUserId", operator: "equals", value: org.ids.admin }],
        actions: [{ type: "notify", recipient: { type: "user", userId: org.ids.admin }, title: "Never", message: "" }],
        status: "active",
      }),
    );

    await t.test("only registered triggers, fields, operators and actions; bounded", async () => {
      const base = { name: "Bad", actions: [{ type: "notify", recipient: { type: "user", userId: org.ids.rep }, title: "x", message: "" }] };
      await assert.rejects(tx((client) => createWorkflow(client, admin, { ...base, trigger: "crm.anything" })), expectCode("WORKFLOW_DEFINITION_INVALID"));
      await assert.rejects(tx((client) => createWorkflow(client, admin, { ...base, trigger: "crm.leads.assigned", conditions: [{ field: "email", operator: "equals", value: "x" }] })), expectCode("WORKFLOW_DEFINITION_INVALID"));
      await assert.rejects(tx((client) => createWorkflow(client, admin, { ...base, trigger: "crm.leads.assigned", actions: [{ type: "http_post", title: "x" }] })), expectCode("WORKFLOW_DEFINITION_INVALID"));
      await assert.rejects(tx((client) => createWorkflow(client, admin, { ...base, trigger: "crm.leads.assigned", actions: Array.from({ length: 6 }, () => base.actions[0]) })), expectCode("WORKFLOW_DEFINITION_INVALID"));
      await assert.rejects(tx((client) => createWorkflow(client, admin, { ...base, trigger: "crm.leads.assigned", actions: [{ ...base.actions[0], recipient: { type: "user", userId: other.ids.x } }] })), expectCode("WORKFLOW_DEFINITION_INVALID"));
    });

    await t.test("a matching event notifies once; a non-matching workflow records a no-match run", async () => {
      const leadId = await assign();
      await process();
      const [note] = await notifications();
      assert.equal(note.title, "A lead was assigned to you");
      assert.equal(note.href, `/crm/leads/${leadId}`);
      const runs = await tx((client) => listWorkflowRuns(client, org.organizationId));
      assert.equal(runs.find((run) => run.workflowId === workflow.id).matched, true);
      assert.equal(runs.find((run) => run.workflowId === neverMatches.id).matched, false);
    });

    await t.test("replaying the event creates no second run or notification", async () => {
      await kit.owner.query(`UPDATE tenant.platform_events SET dispatch_status='pending' WHERE organization_id=$1`, [org.organizationId]);
      await process();
      assert.equal((await notifications()).length, 1);
      assert.equal((await tx((client) => listWorkflowRuns(client, org.organizationId, { workflowId: workflow.id }))).length, 1);
    });

    await t.test("the recipient's notification preference is respected", async () => {
      await kit.tenant(rep.organizationId, (client) => setNotificationPreference(client, rep, { category: "crm_workflow", enabled: false }));
      await assign();
      await process();
      assert.equal((await notifications()).length, 1);
      const [latest] = await tx((client) => listWorkflowRuns(client, org.organizationId, { workflowId: workflow.id }));
      assert.equal(latest.status, "succeeded");
      await kit.tenant(rep.organizationId, (client) => setNotificationPreference(client, rep, { category: "crm_workflow", enabled: true }));
    });

    await t.test("inactive workflows, the organisation switch and workflow-originated events do not run", async () => {
      const runsBefore = (await tx((client) => listWorkflowRuns(client, org.organizationId, { workflowId: neverMatches.id }))).length;
      await tx((client) => setWorkflowStatus(client, admin, neverMatches.id, "inactive"));
      await assign();
      await process();
      assert.equal((await tx((client) => listWorkflowRuns(client, org.organizationId, { workflowId: neverMatches.id }))).length, runsBefore, "an inactive workflow gets no new run");
      await tx((client) => setTenantConfiguration(client, admin, { namespace: "platform.workflows", key: "enabled", value: false }));
      const before = (await tx((client) => listWorkflowRuns(client, org.organizationId))).length;
      await assign();
      await process();
      assert.equal((await tx((client) => listWorkflowRuns(client, org.organizationId))).length, before);
      await tx((client) => setTenantConfiguration(client, admin, { namespace: "platform.workflows", key: "enabled", value: true, effectiveFrom: new Date(Date.now() + 1000).toISOString() }));
      await new Promise((resolve) => setTimeout(resolve, 1100));
      await kit.tenant(org.organizationId, (client) => publishDomainEvent(client, { organizationId: org.organizationId, eventType: "crm.leads.assigned", entityType: "leads", entityId: randomUUID(), payload: { ownerUserId: org.ids.rep, origin: "workflow" } }));
      await process();
      assert.equal((await tx((client) => listWorkflowRuns(client, org.organizationId))).length, before, "no loop");
    });

    await t.test("a failing run is recorded with evidence", async () => {
      await kit.owner.query(`DELETE FROM workflow_definition_versions WHERE workflow_id=$1`, [workflow.id]);
      await assign();
      await process();
      const [latest] = await tx((client) => listWorkflowRuns(client, org.organizationId, { workflowId: workflow.id }));
      assert.equal(latest.status, "failed");
      assert.match(latest.error, /version/);
    });

    await t.test("other organisations are isolated", async () => {
      assert.deepEqual(await tx((client) => listWorkflowRuns(client, other.organizationId)), []);
    });
  } finally {
    await kit.close();
  }
});

test("reports: registered datasets, module/plan/permission gates, record scope, safe CSV artifacts", async (t) => {
  const kit = await createRuntimeKit();
  const storage = createMemoryObjectStorage();
  setObjectStorageForTests(storage);
  try {
    const org = await kit.organization(["rep", "peer"]);
    const other = await kit.organization(["x"]);
    await enableModules(kit, org.organizationId, ["crm", "sales"]);
    const reportPermissions = ["crm.view", "crm.reports.view", "crm.leads.manage", "sales.view", "sales.reports.view"];
    await grantRole(kit, org.organizationId, org.ids.rep, reportPermissions);
    const rep = { ...org.session("rep", reportPermissions), allowAllCompanies: false };
    const peer = { ...org.session("peer", reportPermissions), allowAllCompanies: false };
    const modules = async (session, env) => [...(await kit.tenant(org.organizationId, (client) => buildWorkspaceAccessSnapshot(client, session, { env: env ?? { BILLING_ENFORCEMENT_MODE: "observe" } }))).accessibleModules];
    await kit.crmLead(org, org.ids.rep, "=HYPERLINK(\"http://evil\")", "Mine");
    await kit.crmLead(org, org.ids.peer, "Hidden", "Theirs");

    await t.test("datasets follow module access and permissions", async () => {
      assert.deepEqual(listReportDatasets(rep, await modules(rep)).map((dataset) => dataset.key).sort(), ["crm.leads", "sales.orders"]);
      assert.deepEqual(listReportDatasets({ ...rep, permissions: ["crm.view"] }, await modules(rep)), [], "missing report permission");
      await kit.owner.query(`UPDATE organization_modules SET status='disabled' WHERE organization_id=$1 AND module_key='sales'`, [org.organizationId]);
      assert.deepEqual(listReportDatasets(rep, await modules(rep)).map((dataset) => dataset.key), ["crm.leads"], "disabled module");
      await enableModules(kit, org.organizationId, ["sales"]);
      await kit.owner.query(`INSERT INTO billing_entitlement_overrides (organization_id, entitlement_key, entitlement_value, reason) VALUES ($1,'modules','["crm"]'::jsonb,'rt')`, [org.organizationId]);
      assert.deepEqual(listReportDatasets(rep, await modules(rep, { BILLING_ENFORCEMENT_MODE: "enforce" })).map((dataset) => dataset.key), ["crm.leads"], "not on the plan");
      await kit.owner.query(`DELETE FROM billing_entitlement_overrides WHERE organization_id=$1`, [org.organizationId]);
    });

    await t.test("definitions validate columns and refuse schedules", async () => {
      const available = await modules(rep);
      await assert.rejects(kit.tenant(rep.organizationId, (client) => createReportDefinition(client, rep, available, { name: "Bad", datasetKey: "crm.leads", columns: ["email"] })), expectCode("REPORT_COLUMN_UNKNOWN"));
      await assert.rejects(kit.tenant(rep.organizationId, (client) => createReportDefinition(client, rep, available, { name: "Bad", datasetKey: "procurement.orders" })), expectCode("REPORT_DATASET_UNKNOWN"));
      await assert.rejects(kit.tenant(rep.organizationId, (client) => createReportDefinition(client, rep, available, { name: "Nightly", datasetKey: "crm.leads", schedule: { cron: "0 0 * * *" } })), expectCode("REPORT_SCHEDULE_UNAVAILABLE"));
    });

    await t.test("a run executes in the background with current authority, record scope and formula-safe CSV", async () => {
      const available = await modules(rep);
      const definition = await kit.tenant(rep.organizationId, (client) => createReportDefinition(client, rep, available, { name: "My leads", datasetKey: "crm.leads", columns: ["code", "firstName", "lastName", "status"] }));
      const run = await kit.tenant(org.organizationId, (client) => requestReportRun(client, rep, available, { definitionId: definition.id }));
      const job = (await kit.owner.query(`SELECT job_type, requested_by FROM tenant.background_jobs WHERE id=$1`, [run.jobId])).rows[0];
      assert.deepEqual(job, { job_type: "platform.reports.run", requested_by: org.ids.rep });
      const result = await kit.tenant(org.organizationId, (client) => executeReportRun(client, org.organizationId, { reportRunId: run.id, activeCompanyId: org.companyId, activeBranchId: org.branchId }, { env: { BILLING_ENFORCEMENT_MODE: "observe" }, storage }));
      assert.equal(result.rowCount, 1, "only the rep's own lead");
      const file = await kit.tenant(rep.organizationId, (client) => readReportRunOutput(client, rep, run.id, { storage }));
      const csv = file.body.toString("utf8");
      assert.match(csv, /'=HYPERLINK/, "formula neutralised");
      assert.ok(!csv.includes("Hidden") && !csv.includes("@"), "no other owner's record, no contact details");
      await assert.rejects(kit.tenant(peer.organizationId, (client) => readReportRunOutput(client, peer, run.id, { storage })), expectCode("REPORT_RUN_NOT_FOUND"));
      const [listed] = await kit.tenant(rep.organizationId, (client) => listReportRuns(client, rep));
      assert.equal(listed.status, "succeeded");
      assert.equal(listed.downloadable, true);
    });

    await t.test("a queued run stops if the requester lost the permission", async () => {
      const available = await modules(rep);
      const run = await kit.tenant(org.organizationId, (client) => requestReportRun(client, rep, available, { datasetKey: "crm.leads" }));
      await kit.owner.query(`UPDATE user_role_assignments SET status='revoked', revoked_at=now() WHERE organization_id=$1 AND user_id=$2`, [org.organizationId, org.ids.rep]);
      await assert.rejects(kit.tenant(org.organizationId, (client) => executeReportRun(client, org.organizationId, { reportRunId: run.id, activeCompanyId: org.companyId, activeBranchId: org.branchId }, { storage })), expectCode("REPORT_DATASET_FORBIDDEN"));
    });

    await t.test("other organisations see none of it", async () => {
      assert.deepEqual(await kit.tenant(other.organizationId, (client) => listReportRuns(client, other.session("x", reportPermissions))), []);
    });
  } finally {
    setObjectStorageForTests(null);
    await kit.close();
  }
});

test("documents: a Sales order PDF through the module's own read", async () => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["seller", "outsider"]);
    const api = await import("../../../services/api/src/index.js");
    const orgId = org.organizationId;
    const uomId = randomUUID();
    const taxCategoryId = randomUUID();
    const priceListId = randomUUID();
    const itemId = randomUUID();
    const customerId = randomUUID();
    await kit.owner.query(`INSERT INTO tenant.currencies(organization_id,code,name,decimal_places,is_base,status) VALUES ($1,'INR','Indian Rupee',2,true,'active') ON CONFLICT DO NOTHING`, [orgId]);
    await kit.owner.query(`INSERT INTO tenant.units_of_measure(id,organization_id,code,name,category,status) VALUES ($1,$2,'EA','Each','quantity','active')`, [uomId, orgId]);
    await kit.owner.query(`INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,'STD','Standard','active')`, [taxCategoryId, orgId]);
    await kit.owner.query(`INSERT INTO tenant.tax_rates(id,organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,$3,'GST 18%','GST18','gst',18,'active')`, [randomUUID(), orgId, taxCategoryId]);
    await kit.owner.query(`INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA')`, [orgId]);
    await kit.owner.query(`INSERT INTO tenant.price_lists(id,organization_id,code,name,price_list_type,currency_code,tax_inclusive,status) VALUES ($1,$2,'RETAIL','Retail','sales','INR',false,'active')`, [priceListId, orgId]);
    await kit.owner.query(`INSERT INTO tenant.items(id,organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status) VALUES ($1,$2,'ITEM1','Widget','product',$3,$4,100,60,'active')`, [itemId, orgId, uomId, taxCategoryId]);
    await kit.owner.query(`INSERT INTO tenant.price_list_items(organization_id,price_list_id,item_id,minimum_quantity,rate,status) VALUES ($1,$2,$3,1,100,'active')`, [orgId, priceListId, itemId]);
    await kit.owner.query(`INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,created_by) VALUES ($1,$2,$3,'CUST1','customer','Acme Retail','active',$4)`, [customerId, orgId, org.companyId, org.ids.seller]);
    const seller = { ...org.session("seller", ["sales.view", "sales.order.create"]), roleSlugs: [] };
    const sales = { organizationId: orgId, userId: org.ids.seller, activeCompanyId: org.companyId, activeBranchId: org.branchId, allowAllCompanies: false, permissions: seller.permissions, roleSlugs: [] };
    const order = await kit.tenant(orgId, (client) => api.createSalesOrder(client, sales, { partyId: customerId, currencyCode: "INR", priceListId, placeOfSupply: "KA", lines: [{ itemId, quantity: 2 }] }));
    const pdf = await kit.tenant(orgId, (client) => renderAuthorizedDocument(client, seller, "sales.order", order.id));
    assert.equal(pdf.body.subarray(0, 5).toString(), "%PDF-");
    assert.match(pdf.fileName, /^sales-order-[A-Za-z0-9._-]+\.pdf$/);
    await assert.rejects(kit.tenant(orgId, (client) => renderAuthorizedDocument(client, { ...org.session("outsider", []), roleSlugs: [] }, "sales.order", order.id)), (error) => error.status === 403);
    await assert.rejects(kit.tenant(orgId, (client) => renderAuthorizedDocument(client, seller, "sales.order", "../../etc/passwd")), (error) => error.status === 404);
    await assert.rejects(kit.tenant(orgId, (client) => renderAuthorizedDocument(client, seller, "any.template", order.id)), (error) => error.status === 404);
  } finally {
    await kit.close();
  }
});
