// F017 CRM attachments: CRM owns parent-record authorization and the write
// rule; storage, versioning, scanning and the quarantine gate are the Shared
// Platform file service's, proven against real PostgreSQL + object storage in
// tests/integration/platform-services/files-db.test.mjs (versions, historical
// downloads, quarantine, delete-promotion, metadata-only lists, legacy rows).
import assert from "node:assert/strict";
import test from "node:test";

import {
  createCrmAttachment,
  crmAttachmentStorageEntityType,
  deleteCrmAttachment,
  getCrmAttachmentContent,
  listCrmAttachments,
} from "../src/modules/crm/seller-activity-and-follow-up-workspace/attachments/attachments-operations.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "44444444-4444-4444-8444-444444444444";
const lead = "55555555-5555-4555-8555-555555555555";
const attachment = "88888888-8888-4888-8888-888888888888";

function baseContext() {
  return { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive", "crm.activities.manage"] };
}

// Parent lookups find nothing (record invisible); any file query is recorded.
function invisibleParentClient() {
  const calls = [];
  return {
    calls,
    async query(sql) {
      calls.push(sql);
      return { rows: [] };
    },
  };
}

test("F017: crmAttachmentStorageEntityType produces the ONE 'crm.<entityType>' convention", () => {
  assert.equal(crmAttachmentStorageEntityType("lead"), "crm.lead");
  assert.equal(crmAttachmentStorageEntityType("party"), "crm.party");
});

test("F017: listCrmAttachments returns an empty list, not an error, when the caller cannot see the parent record", async () => {
  const client = invisibleParentClient();
  assert.deepEqual(await listCrmAttachments(client, baseContext(), "lead", lead), []);
  assert.ok(!client.calls.some((sql) => sql.includes("public.attachments")), "no file query for an invisible parent");
});

test("F017: createCrmAttachment fails closed when the caller cannot access the parent record, before storing anything", async () => {
  const client = invisibleParentClient();
  await assert.rejects(() => createCrmAttachment(client, baseContext(), "lead", lead, { prepared: { bytes: Buffer.from("x"), contentSha256: "abc" } }), { code: "CRM_ATTACHMENT_RELATION_INVALID" });
  assert.ok(!client.calls.some((sql) => sql.includes("public.attachments")));
});

test("F017: getCrmAttachmentContent fails closed when the caller cannot access the parent record, before even querying the file", async () => {
  const client = invisibleParentClient();
  await assert.rejects(() => getCrmAttachmentContent(client, baseContext(), "lead", lead, attachment), { code: "CRM_ATTACHMENT_RELATION_INVALID" });
  assert.ok(!client.calls.some((sql) => sql.includes("public.attachments")));
});

test("F017: unsupported parent types are refused", async () => {
  await assert.rejects(() => getCrmAttachmentContent(invisibleParentClient(), baseContext(), "invoice", lead, attachment), { code: "CRM_ATTACHMENT_RELATION_INVALID" });
});

test("F017: a caller who can SEE the record but cannot manage it (Auditor / Read-only) cannot upload or delete files — refused before any query", async () => {
  const client = invisibleParentClient();
  const reader = { ...baseContext(), permissions: ["crm.view", "crm.records.view_all", "crm.leads.view_sensitive"] };
  await assert.rejects(() => createCrmAttachment(client, reader, "lead", lead, { prepared: { bytes: Buffer.from("x"), contentSha256: "abc" } }), { code: "CRM_RECORD_CONTENT_WRITE_FORBIDDEN" });
  await assert.rejects(() => deleteCrmAttachment(client, reader, "lead", lead, attachment), { code: "CRM_RECORD_CONTENT_WRITE_FORBIDDEN" });
  assert.equal(client.calls.length, 0);
});
