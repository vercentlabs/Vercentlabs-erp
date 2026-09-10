import assert from "node:assert/strict";
import test from "node:test";

import {
  listCrmNotes,
  getCrmNote,
  createCrmNote,
  updateCrmNote,
  archiveCrmNote,
  listCrmNoteVersions,
} from "../src/modules/crm/seller-activity-and-follow-up-workspace/notes/notes-operations.js";

const org = "11111111-1111-4111-8111-111111111111";
const user = "44444444-4444-4444-8444-444444444444";
const other = "66666666-6666-4666-8666-666666666666";
const lead = "55555555-5555-4555-8555-555555555555";
const note = "77777777-7777-4777-8777-777777777777";

function baseContext(overrides = {}) {
  return { organizationId: org, userId: user, activeCompanyId: null, activeBranchId: null, allowAllCompanies: true, roleSlugs: [], permissions: ["crm.leads.view_sensitive"], ...overrides };
}

function noteRow(overrides = {}) {
  return {
    id: note, organization_id: org, entity_type: "lead", entity_id: lead, body: "Called and left a voicemail.",
    is_pinned: false, visibility: "shared", version: 1, created_by: user, updated_by: user,
    archived_at: null, archived_by: null, created_at: "2026-09-01T10:00:00.000Z", updated_at: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function mockClient({ leadRow = { id: lead }, notes = [noteRow()], versions = [], calls = [] } = {}) {
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.crm_leads lead WHERE")) return { rows: leadRow ? [leadRow] : [] };
      if (sql.includes("SELECT note.*,u.full_name AS created_by_name FROM tenant.crm_notes note") && sql.includes("LIMIT 1")) {
        const [, noteId, callerId, canViewAll] = values;
        return { rows: notes.filter((row) => row.id === noteId && (row.visibility !== "private" || row.created_by === callerId || canViewAll)) };
      }
      if (sql.includes("SELECT note.*,u.full_name AS created_by_name FROM tenant.crm_notes note"))
        return { rows: notes };
      if (sql.includes("SELECT * FROM tenant.crm_notes WHERE organization_id=$1 AND id=$2 FOR UPDATE"))
        return { rows: notes.filter((row) => row.id === values[1]) };
      if (sql.includes("INSERT INTO tenant.crm_notes"))
        return { rows: [noteRow({ id: "new-note-1", body: values[3], is_pinned: values[4], visibility: values[5] })] };
      if (sql.includes("INSERT INTO tenant.crm_note_versions"))
        return { rows: [], rowCount: 1 };
      if (sql.includes("SELECT nv.*,u.full_name AS actor_name FROM tenant.crm_note_versions"))
        return { rows: versions };
      if (sql.includes("UPDATE tenant.crm_notes SET body=$3"))
        return { rows: [{ ...notes[0], body: values[2], is_pinned: values[3], visibility: values[4], version: notes[0].version + 1 }] };
      if (sql.includes("UPDATE tenant.crm_notes SET archived_at=now()"))
        return { rows: [{ ...notes[0], archived_at: "2026-09-02T00:00:00.000Z", archived_by: values[2] }] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events"))
        return { rows: [], rowCount: 1 };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("F017: listCrmNotes returns an empty list (not an error) when the caller cannot see the parent record", async () => {
  const client = mockClient({ leadRow: null });
  const result = await listCrmNotes(client, baseContext(), "lead", lead, {});
  assert.deepEqual(result, []);
});

test("F017: listCrmNotes excludes archived Notes by default", async () => {
  const client = mockClient();
  await listCrmNotes(client, baseContext(), "lead", lead, {});
  const listQuery = client.calls.find(({ sql }) => sql.includes("ORDER BY note.is_pinned"));
  assert.ok(listQuery.sql.includes("note.archived_at IS NULL"));
});

test("F017: listCrmNotes applies the private-Note visibility predicate — visible to author or view-all only", async () => {
  const client = mockClient();
  await listCrmNotes(client, baseContext(), "lead", lead, {});
  const listQuery = client.calls.find(({ sql }) => sql.includes("ORDER BY note.is_pinned"));
  assert.match(listQuery.sql, /visibility<>'private' OR note\.created_by=\$\d+ OR \$\d+/);
});

test("F017: createCrmNote requires a non-empty body", async () => {
  const client = mockClient();
  await assert.rejects(() => createCrmNote(client, baseContext(), "lead", lead, { body: "   " }), (error) => error.code === "CRM_NOTE_BODY_REQUIRED");
});

test("F017: createCrmNote fails closed when the caller cannot access the parent record", async () => {
  const client = mockClient({ leadRow: null });
  await assert.rejects(() => createCrmNote(client, baseContext(), "lead", lead, { body: "Hello" }), (error) => error.code === "CRM_NOTE_RELATION_INVALID");
});

test("F017: createCrmNote defaults to shared visibility and version 1", async () => {
  const client = mockClient();
  const created = await createCrmNote(client, baseContext(), "lead", lead, { body: "Called back." });
  assert.equal(created.visibility, "shared");
  const insert = client.calls.find(({ sql }) => sql.includes("INSERT INTO tenant.crm_notes"));
  assert.ok(insert.sql.includes(",1,"), "version literal 1 must be part of the INSERT");
});

test("F017: updateCrmNote is author-only unless the caller holds an organization-wide override", async () => {
  const client = mockClient({ notes: [noteRow({ created_by: other })] });
  await assert.rejects(() => updateCrmNote(client, baseContext(), note, { body: "edit" }), (error) => error.code === "CRM_NOTE_EDIT_FORBIDDEN");
});

test("F017: updateCrmNote allows a view-all/org-owner override to edit someone else's Note", async () => {
  const client = mockClient({ notes: [noteRow({ created_by: other })] });
  const context = baseContext({ permissions: ["crm.leads.view_sensitive", "crm.records.view_all"] });
  const result = await updateCrmNote(client, context, note, { body: "corrected" });
  assert.equal(result.body, "corrected");
});

test("F017: updateCrmNote appends the PRIOR content to crm_note_versions before overwriting — never a silent overwrite", async () => {
  const client = mockClient();
  await updateCrmNote(client, baseContext(), note, { body: "revised text" });
  const versionInsert = client.calls.find(({ sql }) => sql.includes("INSERT INTO tenant.crm_note_versions"));
  assert.ok(versionInsert, "the pre-edit content must be archived into crm_note_versions");
  assert.equal(versionInsert.values[3], "Called and left a voicemail.", "the version row must carry the OLD body, not the new one");
  assert.equal(versionInsert.values[2], 1, "the version row must carry the note's version BEFORE the bump");
});

test("F017: updateCrmNote bumps the version number on every edit", async () => {
  const client = mockClient();
  const result = await updateCrmNote(client, baseContext(), note, { body: "revised" });
  assert.equal(result.version, 2);
});

test("F017: updateCrmNote rejects a stale write — A opens, B edits, A submits with the old version", async () => {
  const client = mockClient({ notes: [noteRow({ version: 2 })] });
  await assert.rejects(
    () => updateCrmNote(client, baseContext(), note, { body: "stale edit", expectedVersion: 1 }),
    (error) => error.code === "CRM_NOTE_STALE_WRITE",
  );
  assert.ok(!client.calls.some(({ sql }) => sql.includes("UPDATE tenant.crm_notes SET body=$3")), "a stale write must never reach the UPDATE");
});

test("F017: updateCrmNote succeeds when expectedVersion matches — B's version is preserved in history, not lost", async () => {
  const client = mockClient({ notes: [noteRow({ version: 2, body: "B's edit" })] });
  const result = await updateCrmNote(client, baseContext(), note, { body: "A's follow-up edit", expectedVersion: 2 });
  assert.equal(result.version, 3);
  const versionInsert = client.calls.find(({ sql }) => sql.includes("INSERT INTO tenant.crm_note_versions"));
  assert.equal(versionInsert.values[3], "B's edit");
});

test("F017: updateCrmNote refuses to edit an archived Note", async () => {
  const client = mockClient({ notes: [noteRow({ archived_at: "2026-09-01T00:00:00.000Z" })] });
  await assert.rejects(() => updateCrmNote(client, baseContext(), note, { body: "revive it" }), (error) => error.code === "CRM_NOTE_ARCHIVED");
});

test("F017: a private Note is invisible (404, not 403 — no existence leak) to anyone but its author or a view-all override", async () => {
  const client = mockClient({ notes: [noteRow({ visibility: "private", created_by: other })] });
  await assert.rejects(() => getCrmNote(client, baseContext(), note), (error) => error.code === "CRM_NOTE_NOT_FOUND");
});

test("F017: archiveCrmNote is idempotent — archiving an already-archived Note is a clean no-op, not an error", async () => {
  const client = mockClient({ notes: [noteRow({ archived_at: "2026-09-01T00:00:00.000Z" })] });
  const result = await archiveCrmNote(client, baseContext(), note, {});
  assert.ok(result.archivedAt);
  assert.ok(!client.calls.some(({ sql }) => sql.includes("UPDATE tenant.crm_notes SET archived_at=now()")));
});

test("F017: archiveCrmNote never hard-deletes — the underlying row and its version ledger survive", async () => {
  const client = mockClient();
  const result = await archiveCrmNote(client, baseContext(), note, {});
  assert.ok(result.archivedAt);
  assert.ok(!client.calls.some(({ sql }) => sql.includes("DELETE FROM tenant.crm_notes")));
});

test("F017: listCrmNoteVersions returns the append-only history newest-first", async () => {
  const client = mockClient({ versions: [{ id: "v2", version: 2 }, { id: "v1", version: 1 }] });
  const versions = await listCrmNoteVersions(client, baseContext(), note);
  assert.equal(versions.length, 2);
  const query = client.calls.find(({ sql }) => sql.includes("crm_note_versions nv"));
  assert.match(query.sql, /ORDER BY nv\.version DESC/);
});
