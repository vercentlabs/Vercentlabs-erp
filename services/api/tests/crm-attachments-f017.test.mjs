import assert from "node:assert/strict";
import test from "node:test";

import {
  listCrmAttachments,
  listCrmAttachmentVersions,
  createCrmAttachment,
  getCrmAttachmentContent,
  deleteCrmAttachment,
  crmAttachmentStorageEntityType,
} from "../src/modules/crm/seller-activity-and-follow-up-workspace/attachments/attachments-operations.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "44444444-4444-4444-8444-444444444444";
const lead = "55555555-5555-4555-8555-555555555555";
const attachment = "88888888-8888-4888-8888-888888888888";
const attachmentV2 = "99999999-9999-4999-8999-999999999999";

function baseContext() {
  // A seller who logs CRM work (crm.activities.manage): writing files needs a
  // write permission, not just record visibility (assertCanWriteCrmRecordContent).
  return { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive", "crm.activities.manage"] };
}

function mockClient({ leadRow = { id: lead }, attachments = [], calls = [] } = {}) {
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads lead WHERE")) return { rows: leadRow ? [leadRow] : [] };
      if (sql.includes("SELECT logical_id,version FROM public.attachments") && sql.includes("FOR UPDATE")) {
        const row = attachments.find((entry) => entry.logical_id === values[3] && entry.is_current);
        return { rows: row ? [{ logical_id: row.logical_id, version: row.version }] : [] };
      }
      if (sql.startsWith("UPDATE public.attachments SET is_current=false"))
        return { rows: [], rowCount: 1 };
      if (sql.startsWith("UPDATE public.attachments SET is_current=true"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("SELECT id,logical_id,version,is_current,file_name,mime_type,size_bytes,lifecycle_status,scan_status,uploaded_by,created_at"))
        return { rows: attachments.filter((row) => row.logical_id === values[3]).sort((a, b) => b.version - a.version) };
      if (sql.includes("SELECT id,logical_id,version,file_name,mime_type,size_bytes,lifecycle_status,scan_status,uploaded_by,created_at"))
        return { rows: attachments.filter((row) => row.is_current) };
      if (sql.includes("INSERT INTO public.attachments"))
        return { rows: [{ id: values[0], logical_id: values[12], version: values[13], file_name: values[4], mime_type: values[6], size_bytes: values[7], created_at: "2026-09-01T00:00:00.000Z" }] };
      if (sql.includes("SELECT file_name,mime_type,size_bytes,content FROM public.attachments"))
        return { rows: attachments.filter((row) => row.id === values[1] && row.lifecycle_status === "clean") };
      if (sql.includes("DELETE FROM public.attachments"))
        return { rows: attachments.filter((row) => row.id === values[1]).map((row) => ({ id: row.id, logical_id: row.logical_id, version: row.version, is_current: row.is_current, file_name: row.file_name, mime_type: row.mime_type, size_bytes: row.size_bytes })) };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F017: crmAttachmentStorageEntityType produces the ONE 'crm.<entityType>' convention every route/query shares", () => {
  assert.equal(crmAttachmentStorageEntityType("lead"), "crm.lead");
  assert.equal(crmAttachmentStorageEntityType("opportunity"), "crm.opportunity");
  assert.equal(crmAttachmentStorageEntityType("party"), "crm.party");
  assert.equal(crmAttachmentStorageEntityType("contact"), "crm.contact");
});

test("F017: listCrmAttachments returns an empty list, not an error, when the caller cannot see the parent record", async () => {
  const client = mockClient({ leadRow: null });
  const result = await listCrmAttachments(client, baseContext(), "lead", lead);
  assert.deepEqual(result, []);
});

test("F017: listCrmAttachments never selects the content column — metadata only", async () => {
  const client = mockClient();
  await listCrmAttachments(client, baseContext(), "lead", lead);
  const query = client.calls.find(({ sql }) => sql.includes("FROM public.attachments") && sql.includes("is_current\n"));
  assert.ok(!query.sql.includes("content"), "the list query must never pull file bytes across the wire");
});

test("F017: listCrmAttachments only returns the current version of each logical file, not every historical version", async () => {
  const client = mockClient({
    attachments: [
      { id: attachment, logical_id: attachment, version: 1, is_current: false, file_name: "a-v1.pdf" },
      { id: attachmentV2, logical_id: attachment, version: 2, is_current: true, file_name: "a-v2.pdf" },
    ],
  });
  const result = await listCrmAttachments(client, baseContext(), "lead", lead);
  assert.equal(result.length, 1);
  assert.equal(result[0].fileName, "a-v2.pdf");
});

test("F017: createCrmAttachment fails closed when the caller cannot access the parent record", async () => {
  const client = mockClient({ leadRow: null });
  await assert.rejects(
    () => createCrmAttachment(client, baseContext(), "lead", lead, { id: attachment, fileName: "a.pdf", storageKey: "k", mimeType: "application/pdf", sizeBytes: 10, content: Buffer.from("x"), contentSha256: "abc", scanStatus: "not_applicable" }),
    (error) => error.code === "CRM_ATTACHMENT_RELATION_INVALID",
  );
});

test("F017: createCrmAttachment writes the 'crm.<entityType>' storage convention, not the bare entityType", async () => {
  const client = mockClient();
  await createCrmAttachment(client, baseContext(), "lead", lead, { id: attachment, fileName: "a.pdf", storageKey: "k", mimeType: "application/pdf", sizeBytes: 10, content: Buffer.from("x"), contentSha256: "abc", scanStatus: "not_applicable" });
  const insert = client.calls.find(({ sql }) => sql.includes("INSERT INTO public.attachments"));
  assert.equal(insert.values[2], "crm.lead");
});

test("F017 §CRM-VNEXT-053: a fresh upload (no replacesLogicalId) becomes its own one-version logical file", async () => {
  const client = mockClient();
  const created = await createCrmAttachment(client, baseContext(), "lead", lead, { id: attachment, fileName: "a.pdf", storageKey: "k", mimeType: "application/pdf", sizeBytes: 10, content: Buffer.from("x"), contentSha256: "abc", scanStatus: "not_applicable" });
  assert.equal(created.logicalId, attachment);
  assert.equal(created.version, 1);
});

test("F017 §CRM-VNEXT-053: uploading a replacement reuses the ORIGINAL logical_id and increments the version — not an unrelated new attachment", async () => {
  const client = mockClient({ attachments: [{ id: attachment, logical_id: attachment, version: 1, is_current: true }] });
  const created = await createCrmAttachment(client, baseContext(), "lead", lead, {
    id: attachmentV2, fileName: "a-v2.pdf", storageKey: "k2", mimeType: "application/pdf", sizeBytes: 12,
    content: Buffer.from("y"), contentSha256: "def", scanStatus: "not_applicable", replacesLogicalId: attachment,
  });
  assert.equal(created.logicalId, attachment, "the new version must carry the SAME logical_id as the file it replaces");
  assert.equal(created.version, 2);
  assert.ok(client.calls.some(({ sql }) => sql.startsWith("UPDATE public.attachments SET is_current=false")), "the previous current version must be demoted, not deleted");
  assert.ok(!client.calls.some(({ sql }) => sql.includes("DELETE FROM public.attachments")), "replacing a version must never delete the row it supersedes");
});

test("F017 §CRM-VNEXT-053: replacing a nonexistent logical file 404s rather than silently creating an unrelated attachment", async () => {
  const client = mockClient({ attachments: [] });
  await assert.rejects(
    () => createCrmAttachment(client, baseContext(), "lead", lead, {
      id: attachmentV2, fileName: "a-v2.pdf", storageKey: "k2", mimeType: "application/pdf", sizeBytes: 12,
      content: Buffer.from("y"), contentSha256: "def", scanStatus: "not_applicable", replacesLogicalId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    }),
    (error) => error.code === "CRM_ATTACHMENT_NOT_FOUND",
  );
});

test("F017: listCrmAttachmentVersions returns the full history for one logical file, newest first, never selecting content", async () => {
  const client = mockClient({
    attachments: [
      { id: attachment, logical_id: attachment, version: 1, is_current: false, file_name: "a-v1.pdf", lifecycle_status: "clean", scan_status: "clean" },
      { id: attachmentV2, logical_id: attachment, version: 2, is_current: true, file_name: "a-v2.pdf", lifecycle_status: "clean", scan_status: "clean" },
    ],
  });
  const versions = await listCrmAttachmentVersions(client, baseContext(), "lead", lead, attachment);
  assert.equal(versions.length, 2);
  assert.equal(versions[0].version, 2);
  assert.equal(versions[1].version, 1);
  const query = client.calls.find(({ sql }) => sql.includes("logical_id=$4"));
  assert.ok(!query.sql.includes(",content"));
});

test("F017: getCrmAttachmentContent 404s a still-quarantined file — same response as a missing one, no existence leak", async () => {
  const client = mockClient({ attachments: [{ id: attachment, lifecycle_status: "quarantined", file_name: "a.pdf" }] });
  await assert.rejects(() => getCrmAttachmentContent(client, baseContext(), "lead", lead, attachment), (error) => error.code === "CRM_ATTACHMENT_NOT_FOUND");
});

test("F017: getCrmAttachmentContent returns bytes only for a scan-clean attachment", async () => {
  const client = mockClient({ attachments: [{ id: attachment, lifecycle_status: "clean", scan_status: "clean", file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 3, content: Buffer.from("abc") }] });
  const result = await getCrmAttachmentContent(client, baseContext(), "lead", lead, attachment);
  assert.equal(result.file_name, "a.pdf");
});

test("F017: getCrmAttachmentContent works for a historical (non-current) version's own id — old versions stay downloadable, not just the current one", async () => {
  const client = mockClient({ attachments: [{ id: attachment, logical_id: attachment, version: 1, is_current: false, lifecycle_status: "clean", scan_status: "clean", file_name: "a-v1.pdf", mime_type: "application/pdf", size_bytes: 3, content: Buffer.from("old") }] });
  const result = await getCrmAttachmentContent(client, baseContext(), "lead", lead, attachment);
  assert.equal(result.file_name, "a-v1.pdf");
});

test("F017: getCrmAttachmentContent fails closed when the caller cannot access the parent record, before even querying the file", async () => {
  const client = mockClient({ leadRow: null });
  await assert.rejects(() => getCrmAttachmentContent(client, baseContext(), "lead", lead, attachment), (error) => error.code === "CRM_ATTACHMENT_RELATION_INVALID");
  assert.ok(!client.calls.some(({ sql }) => sql.includes("SELECT file_name,mime_type,size_bytes,content")));
});

test("F017: deleteCrmAttachment 404s a nonexistent attachment", async () => {
  const client = mockClient({ attachments: [] });
  await assert.rejects(() => deleteCrmAttachment(client, baseContext(), "lead", lead, attachment), (error) => error.code === "CRM_ATTACHMENT_NOT_FOUND");
});

test("F017: deleteCrmAttachment succeeds and is scoped to the exact parent record, not just organization+id", async () => {
  const client = mockClient({ attachments: [{ id: attachment, logical_id: attachment, version: 1, is_current: true, file_name: "a.pdf", mime_type: "application/pdf", size_bytes: 3 }] });
  const result = await deleteCrmAttachment(client, baseContext(), "lead", lead, attachment);
  assert.equal(result.id, attachment);
  const del = client.calls.find(({ sql }) => sql.includes("DELETE FROM public.attachments"));
  assert.ok(del.sql.includes("entity_type=$3 AND entity_id=$4"));
});

test("F017 §CRM-VNEXT-053: deleting the current version promotes the next-most-recent surviving version to current, rather than leaving the file with no current version", async () => {
  const client = mockClient({ attachments: [{ id: attachmentV2, logical_id: attachment, version: 2, is_current: true, file_name: "a-v2.pdf", mime_type: "application/pdf", size_bytes: 3 }] });
  await deleteCrmAttachment(client, baseContext(), "lead", lead, attachmentV2);
  const promote = client.calls.find(({ sql }) => sql.startsWith("UPDATE public.attachments SET is_current=true"));
  assert.ok(promote, "deleting a current version must promote the next-highest surviving version");
});

test("F017 §CRM-VNEXT-053: deleting a NON-current (already-superseded) version does not touch is_current at all", async () => {
  const client = mockClient({ attachments: [{ id: attachment, logical_id: attachment, version: 1, is_current: false, file_name: "a-v1.pdf", mime_type: "application/pdf", size_bytes: 3 }] });
  await deleteCrmAttachment(client, baseContext(), "lead", lead, attachment);
  assert.ok(!client.calls.some(({ sql }) => sql.startsWith("UPDATE public.attachments SET is_current=true")));
});

test("F017: a caller who can SEE the record but cannot manage it (Auditor / Read-only) cannot upload or delete files — refused before any query", async () => {
  const calls = [];
  const client = { async query(sql) { calls.push(sql); return { rows: [] }; } };
  const reader = { ...baseContext(), permissions: ["crm.view", "crm.records.view_all", "crm.leads.view_sensitive"] };
  await assert.rejects(() => createCrmAttachment(client, reader, "lead", "33333333-3333-4333-8333-333333333333", { fileName: "a.txt", mimeType: "text/plain", content: Buffer.from("x") }), { code: "CRM_RECORD_CONTENT_WRITE_FORBIDDEN" });
  await assert.rejects(() => deleteCrmAttachment(client, reader, "lead", "33333333-3333-4333-8333-333333333333", "44444444-4444-4444-8444-444444444444"), { code: "CRM_RECORD_CONTENT_WRITE_FORBIDDEN" });
  assert.equal(calls.length, 0);
});
