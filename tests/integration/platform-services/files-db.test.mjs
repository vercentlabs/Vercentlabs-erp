// Shared Platform files against real PostgreSQL + an in-memory object store:
// upload pipeline, CRM attachment versions/quarantine/authorization, the
// legacy bytea compatibility path, export artifacts and Support attachments.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { createMemoryObjectStorage } from "../../../packages/document-engine/src/index.js";

import { archiveFile, prepareFileUpload, purgeExpiredFileContent, readFileContent, storeFile } from "../../../services/api/src/core/platform/files/index.js";
import {
  createCrmAttachment,
  deleteCrmAttachment,
  getCrmAttachmentContent,
  listCrmAttachments,
  listCrmAttachmentVersions,
} from "../../../services/api/src/modules/crm/seller-activity-and-follow-up-workspace/attachments/attachments-operations.js";
import { addAttachment, createTicket, getAttachmentContent } from "../../../services/api/src/modules/support/tickets.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";

const PDF = Buffer.from("%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%EOF\n");
const LOCAL = { NODE_ENV: "test", ATTACHMENT_SCAN_MODE: "local" };
const pdf = (name = "contract.pdf", bytes = PDF) => prepareFileUpload({ fileName: name, mimeType: "application/pdf", bytes }, LOCAL);

test("files: upload pipeline refuses unsafe content before anything is stored", async () => {
  await assert.rejects(prepareFileUpload({ fileName: "a.exe", mimeType: "application/x-msdownload", bytes: Buffer.from("MZ") }, LOCAL), expectCode("FILE_INVALID"));
  await assert.rejects(prepareFileUpload({ fileName: "big.pdf", mimeType: "application/pdf", bytes: Buffer.alloc(11 * 1024 * 1024, 1) }, LOCAL), expectCode("FILE_INVALID"));
  await assert.rejects(prepareFileUpload({ fileName: "fake.pdf", mimeType: "application/pdf", bytes: Buffer.from("not a pdf") }, LOCAL), expectCode("ATTACHMENT_CONTENT_TYPE_MISMATCH"));
  await assert.rejects(
    prepareFileUpload({ fileName: "eicar.txt", mimeType: "text/plain", bytes: Buffer.from("X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*") }, LOCAL),
    expectCode("ATTACHMENT_MALWARE_DETECTED"),
  );
  await assert.rejects(prepareFileUpload({ fileName: "a.pdf", mimeType: "application/pdf", bytes: PDF }, { NODE_ENV: "production" }), expectCode("ATTACHMENT_SCAN_NOT_CONFIGURED"));
  const prepared = await pdf("../../etc/passwd.pdf");
  assert.equal(prepared.fileName.includes("/"), false, "file names are sanitised");
  assert.match(prepared.contentSha256, /^[0-9a-f]{64}$/);
});

test("files: CRM attachments on the shared file service", async (t) => {
  const kit = await createRuntimeKit();
  const storage = createMemoryObjectStorage();
  try {
    const org = await kit.organization(["owner", "peer"]);
    const crm = (label, permissions) => ({ ...org.session(label, permissions), allowAllCompanies: false });
    const owner = crm("owner", ["crm.view", "crm.leads.manage", "crm.leads.view_sensitive", "crm.activities.manage"]);
    const peer = crm("peer", ["crm.view", "crm.leads.manage", "crm.leads.view_sensitive", "crm.activities.manage"]);
    const leadId = await kit.crmLead(org, owner.userId, "Asha", "Rao");
    const tenant = (work) => kit.tenant(org.organizationId, work);

    let v1;
    let v2;
    await t.test("upload stores bytes in object storage, not PostgreSQL", async () => {
      v1 = await tenant((client) => createCrmAttachment(client, owner, "lead", leadId, { prepared: null, ...{ prepared: undefined } }, { storage }).catch((error) => error));
      assert.ok(v1 instanceof Error, "an unprepared upload is refused");
      v1 = await tenant(async (client) => createCrmAttachment(client, owner, "lead", leadId, { prepared: await pdf() }, { storage }));
      const row = (await kit.owner.query(`SELECT storage_mode, content, storage_key, content_sha256 FROM attachments WHERE id=$1`, [v1.id])).rows[0];
      assert.equal(row.storage_mode, "object");
      assert.equal(row.content, null);
      assert.ok((await storage.head(row.storage_key)).size > 0);
      await assert.rejects(kit.owner.query(`UPDATE attachments SET content='\\x00'::bytea WHERE id=$1`, [v1.id]), "an object row can never carry bytes");
    });

    await t.test("replacing a file creates version 2; both versions stay downloadable", async () => {
      v2 = await tenant(async (client) => createCrmAttachment(client, owner, "lead", leadId, { prepared: await pdf("contract-v2.pdf", Buffer.from("%PDF-1.4\nv2\n%%EOF\n")), replacesLogicalId: v1.logicalId }, { storage }));
      assert.equal(v2.logicalId, v1.logicalId);
      assert.equal(v2.version, 2);
      const list = await tenant((client) => listCrmAttachments(client, owner, "lead", leadId));
      assert.deepEqual(list.map((row) => row.id), [v2.id], "the list shows current versions only");
      assert.equal("content" in list[0], false);
      const versions = await tenant((client) => listCrmAttachmentVersions(client, owner, "lead", leadId, v1.logicalId));
      assert.deepEqual(versions.map((row) => row.version), [2, 1]);
      const old = await tenant((client) => getCrmAttachmentContent(client, owner, "lead", leadId, v1.id, { storage }));
      assert.equal(old.body.toString("latin1"), PDF.toString("latin1"));
      await assert.rejects(
        tenant(async (client) => createCrmAttachment(client, owner, "lead", leadId, { prepared: await pdf(), replacesLogicalId: randomUUID() }, { storage })),
        expectCode("CRM_ATTACHMENT_NOT_FOUND"),
      );
    });

    await t.test("parent-record authorization decides; another org never sees the file", async () => {
      await assert.rejects(tenant((client) => getCrmAttachmentContent(client, peer, "lead", leadId, v2.id, { storage })), expectCode("CRM_ATTACHMENT_RELATION_INVALID"));
      assert.deepEqual(await tenant((client) => listCrmAttachments(client, peer, "lead", leadId)), []);
      const other = await kit.organization(["x"]);
      await assert.rejects(
        kit.tenant(other.organizationId, (client) => readFileContent(client, { organizationId: other.organizationId, entityType: "crm.lead", entityId: leadId, fileId: v2.id }, { storage })),
        expectCode("FILE_NOT_FOUND"),
      );
      // A file id of this lead cannot be read through another record either.
      await assert.rejects(tenant((client) => readFileContent(client, { organizationId: org.organizationId, entityType: "crm.lead", entityId: randomUUID(), fileId: v2.id }, { storage })), expectCode("FILE_NOT_FOUND"));
      await assert.rejects(tenant((client) => readFileContent(client, { organizationId: org.organizationId, entityType: "made.up", entityId: leadId, fileId: v2.id }, { storage })), expectCode("FILE_ENTITY_TYPE_UNREGISTERED"));
    });

    await t.test("a quarantined file answers exactly like a missing one", async () => {
      await kit.owner.query(`UPDATE attachments SET scan_status='pending', lifecycle_status='quarantined' WHERE id=$1`, [v2.id]);
      await assert.rejects(tenant((client) => getCrmAttachmentContent(client, owner, "lead", leadId, v2.id, { storage })), expectCode("CRM_ATTACHMENT_NOT_FOUND"));
      await kit.owner.query(`UPDATE attachments SET scan_status='clean', lifecycle_status='clean' WHERE id=$1`, [v2.id]);
    });

    await t.test("deleting the current version archives it and promotes the previous one", async () => {
      const deleted = await tenant((client) => deleteCrmAttachment(client, owner, "lead", leadId, v2.id));
      assert.equal(deleted.isCurrent, true);
      const list = await tenant((client) => listCrmAttachments(client, owner, "lead", leadId));
      assert.deepEqual(list.map((row) => row.id), [v1.id]);
      const archived = (await kit.owner.query(`SELECT lifecycle_status, archived_by FROM attachments WHERE id=$1`, [v2.id])).rows[0];
      assert.deepEqual(archived, { lifecycle_status: "archived", archived_by: owner.userId }, "evidence kept, never hard-deleted");
      await assert.rejects(tenant((client) => getCrmAttachmentContent(client, owner, "lead", leadId, v2.id, { storage })), expectCode("CRM_ATTACHMENT_NOT_FOUND"));
    });

    await t.test("files uploaded before migration 063 (bytes in PostgreSQL) stay readable", async () => {
      const legacyId = randomUUID();
      await kit.owner.query(
        `INSERT INTO attachments (id, organization_id, entity_type, entity_id, file_name, storage_key, mime_type, size_bytes, content, content_sha256, lifecycle_status, scan_status, logical_id, version, is_current, storage_mode)
         VALUES ($1,$2,'crm.lead',$3,'legacy.txt','organizations/legacy.txt','text/plain',6,'legacy'::bytea,'x','clean','clean',$1,1,true,'database_legacy')`,
        [legacyId, org.organizationId, leadId],
      );
      const legacy = await tenant((client) => getCrmAttachmentContent(client, owner, "lead", leadId, legacyId, { storage }));
      assert.equal(legacy.body.toString("utf8"), "legacy");
    });
  } finally {
    await kit.close();
  }
});

test("files: export artifacts expire and their bytes are purged, evidence kept", async () => {
  const kit = await createRuntimeKit();
  const storage = createMemoryObjectStorage();
  try {
    const org = await kit.organization(["owner"]);
    const jobId = randomUUID();
    const prepared = await prepareFileUpload({ fileName: "export.csv", mimeType: "text/csv", bytes: Buffer.from("a,b\n1,2\n") }, LOCAL);
    const file = await kit.tenant(org.organizationId, (client) =>
      storeFile(client, { organizationId: org.organizationId, entityType: "platform.export", entityId: jobId, prepared, purpose: "export", expiresAt: new Date(Date.now() + 60_000) }, { storage }),
    );
    const read = (id = file.id) => kit.tenant(org.organizationId, (client) => readFileContent(client, { organizationId: org.organizationId, entityType: "platform.export", entityId: jobId, fileId: id }, { storage }));
    assert.equal((await read()).body.toString("utf8"), "a,b\n1,2\n");
    await assert.rejects(kit.tenant(org.organizationId, (client) => storeFile(client, { organizationId: org.organizationId, entityType: "platform.export", entityId: jobId, prepared, purpose: "attachment" }, { storage })), expectCode("FILE_PURPOSE_INVALID"));

    await kit.owner.query(`UPDATE attachments SET expires_at = now() - interval '1 minute' WHERE id=$1`, [file.id]);
    await assert.rejects(read(), expectCode("FILE_EXPIRED"));
    const client = await kit.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await purgeExpiredFileContent(client, { storage });
      await client.query("COMMIT");
      assert.ok(result.removed >= 1);
    } finally {
      client.release();
    }
    const row = (await kit.owner.query(`SELECT content_removed_at, lifecycle_status, content_sha256 FROM attachments WHERE id=$1`, [file.id])).rows[0];
    assert.ok(row.content_removed_at);
    assert.ok(row.content_sha256, "the evidence row keeps its hash");
    assert.equal(await storage.head((await kit.owner.query(`SELECT storage_key FROM attachments WHERE id=$1`, [file.id])).rows[0].storage_key), null);
    await assert.rejects(read(), expectCode("FILE_EXPIRED"));
  } finally {
    await kit.close();
  }
});

test("files: Support attachments go through the shared pipeline; private ones stay private", async () => {
  const kit = await createRuntimeKit();
  const storage = createMemoryObjectStorage();
  try {
    const org = await kit.organization(["agent", "viewer"]);
    const support = (label, permissions) => ({ organizationId: org.organizationId, companyId: org.companyId, userId: org.ids[label], permissions, roleSlugs: [] });
    const agent = support("agent", ["support.view", "support.ticket.create", "support.communication.manage"]);
    const viewer = support("viewer", ["support.view"]);
    const tenant = (work) => kit.tenant(org.organizationId, work);
    const ticket = await tenant((client) => createTicket(client, agent, { subject: "Printer jam", description: "Paper stuck in tray 2" }));
    await assert.rejects(tenant((client) => addAttachment(client, agent, ticket.id, { storageKey: "support/anything.pdf", fileName: "x.pdf", sizeBytes: 10 })), expectCode("SUPPORT_ATTACHMENT_UPLOAD_REQUIRED"));
    const shared = await tenant(async (client) => addAttachment(client, agent, ticket.id, { prepared: await pdf("photo.pdf") }, { storage }));
    const hidden = await tenant(async (client) => addAttachment(client, agent, ticket.id, { prepared: await pdf("internal.pdf"), privateNote: true }, { storage }));
    assert.ok(shared.file_id);
    assert.equal((await tenant((client) => getAttachmentContent(client, viewer, shared.id, { storage }))).fileName, "photo.pdf");
    await assert.rejects(tenant((client) => getAttachmentContent(client, viewer, hidden.id, { storage })), expectCode("SUPPORT_ATTACHMENT_NOT_FOUND"));
    assert.equal((await tenant((client) => getAttachmentContent(client, agent, hidden.id, { storage }))).fileName, "internal.pdf", "the uploader can read their own private file");
    await tenant((client) => archiveFile(client, { organizationId: org.organizationId, entityType: "support.ticket", entityId: ticket.id, fileId: shared.file_id }));
    await assert.rejects(tenant((client) => getAttachmentContent(client, agent, shared.id, { storage })), expectCode("SUPPORT_ATTACHMENT_NOT_FOUND"));
  } finally {
    await kit.close();
  }
});
