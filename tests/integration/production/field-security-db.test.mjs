// Field-level security across output channels, as the restricted web role
// (packages/permissions/src/field-security.js): a caller without
// crm.leads.view_sensitive gets no protected lead values through the list
// read, the CSV export built by the worker job, or the shared report
// dataset; a caller with it gets them. Frontend hiding is not involved.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createProductionKit } from "./production-kit.mjs";

const { createCrmRecord, listCrmRecords, buildCrmLeadExportCsv } = await import("../../../services/api/src/index.js");
const { getReportDataset } = await import("../../../services/api/src/orchestration/reporting/datasets.js");

test("protected CRM lead fields never leave through list, export or report without the permission", async (t) => {
  const kit = await createProductionKit();
  t.after(() => kit.close());
  const { organizationId, ownerId } = await kit.organization("field-security");
  const viewerId = await kit.user("field-viewer");
  await kit.owner.query(`INSERT INTO organization_memberships(organization_id,user_id,role,status) VALUES($1,$2,'member','active')`, [organizationId, viewerId]);

  const base = { organizationId, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true };
  const owner = { ...base, userId: ownerId, roleSlugs: ["organization_owner"], permissions: [] };
  const viewerPermissions = ["crm.view", "crm.leads.view", "crm.records.view_all", "crm.export", "crm.reports.view"];
  const viewer = { ...base, userId: viewerId, roleSlugs: ["sales_representative"], permissions: viewerPermissions };
  const sensitiveViewer = { ...viewer, permissions: [...viewerPermissions, "crm.leads.view_sensitive"] };

  const email = `protected-${randomUUID()}@field-security.test`;
  const phone = "+91 98765 43210";
  await kit.as(kit.web, { organizationId, userId: ownerId }, (client) =>
    createCrmRecord(client, owner, "leads", { firstName: "Field", lastName: "Security", companyName: "FS Co", email, phone }),
  );

  const run = (context, work) => kit.as(kit.web, { organizationId, userId: context.userId }, (client) => work(client));

  await t.test("list read", async () => {
    const hidden = (await run(viewer, (client) => listCrmRecords(client, viewer, "leads", {}))).rows.find((row) => row.companyName === "FS Co");
    assert.ok(hidden, "the viewer sees the lead itself");
    assert.equal(hidden.email, undefined);
    assert.equal(hidden.phone, undefined);
    const shown = (await run(sensitiveViewer, (client) => listCrmRecords(client, sensitiveViewer, "leads", {}))).rows.find((row) => row.companyName === "FS Co");
    assert.equal(shown.email, email);
  });

  await t.test("CSV export (worker job build, re-resolved context)", async () => {
    const hidden = await run(viewer, (client) => buildCrmLeadExportCsv(client, viewer, {}));
    assert.ok(hidden.csv.includes("FS Co"));
    assert.ok(!hidden.csv.includes(email), "the protected email must not be in the viewer's export");
    assert.ok(!hidden.csv.includes("98765"), "the protected phone must not be in the viewer's export");
    const shown = await run(sensitiveViewer, (client) => buildCrmLeadExportCsv(client, sensitiveViewer, {}));
    assert.ok(shown.csv.includes(email));
  });

  await t.test("shared report dataset", async () => {
    const dataset = getReportDataset("crm.leads");
    const columns = dataset.columns.map((column) => column.key);
    assert.ok(!columns.includes("email") && !columns.includes("phone"), "contact columns are not reportable at all");
    const rows = await run(viewer, (client) => dataset.execute(client, viewer, {}, 100));
    const row = rows.find((entry) => entry.companyName === "FS Co");
    assert.ok(row);
    assert.equal(row.email, undefined, "the dataset's module read is projected before column selection");
  });
});
