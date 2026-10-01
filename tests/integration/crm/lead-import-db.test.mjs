// F021 durable lead import against real PostgreSQL on the runtime role:
// dry run with in-file and existing duplicates, scope-safe duplicate
// policies, synchronous small imports, worker-backed large imports that
// resume after a crash without importing a row twice, revoked authority,
// formula-safe error download, and cross-user / cross-tenant isolation.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  commitLeadImport,
  getLeadImportBatch,
  getLeadImportErrorsCsv,
  LEAD_IMPORT_LIMITS,
  previewLeadImport,
  rollbackLeadImport,
} from "../../../services/api/src/modules/crm/master-data/lead-import.js";
import { ensureDefaultLeadStages } from "../../../services/api/src/modules/crm/lead-management/lifecycle/stage-catalog.js";
import { leadImportHandler } from "../../../services/worker/src/handlers/crm-lead-import.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";
import { crmFixtures, REP } from "./crm-fixtures.mjs";

const IMPORTER = [...REP, "crm.import"];
const MAPPING = { firstName: "First", lastName: "Last", email: "Email", phone: "Phone", companyName: "Company" };
const row = (first, email, extra = {}) => ({ First: first, Last: "Test", Email: email, Phone: "", Company: "Acme", ...extra });

test("F021 durable lead import", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["alice", "bob"]);
    const other = await kit.organization(["mallory"]);
    const fx = crmFixtures(kit, org);
    const roleId = await fx.crmRole([org.ids.alice, org.ids.bob], ["crm.view", "crm.import", "crm.leads.manage"]);
    await kit.tenant(org.organizationId, (client) => ensureDefaultLeadStages(client, { organizationId: org.organizationId, userId: org.ids.alice }));
    const alice = org.session("alice", IMPORTER);
    const bob = org.session("bob", IMPORTER);
    const run = (session, work) => kit.tenant(org.organizationId, (client) => work(client, session));
    const leadCount = async (where = "true", values = []) =>
      (await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.crm_leads WHERE organization_id=$1 AND ${where}`, [org.organizationId, ...values])).rows[0].n;

    // Existing leads: one Alice can see (hers), one she cannot (Bob's).
    const visibleId = randomUUID();
    const hiddenId = randomUUID();
    await kit.owner.query(`INSERT INTO tenant.crm_leads(id,organization_id,company_id,branch_id,code,first_name,last_name,email,owner_user_id) VALUES($1,$2,$3,$4,'L-VIS','Visible','Lead','visible@example.test',$5)`, [visibleId, org.organizationId, org.companyId, org.branchId, org.ids.alice]);
    await kit.owner.query(`INSERT INTO tenant.crm_leads(id,organization_id,company_id,branch_id,code,first_name,last_name,email,owner_user_id) VALUES($1,$2,$3,$4,'L-HID','Hidden','Lead','hidden@example.test',$5)`, [hiddenId, org.organizationId, org.companyId, org.branchId, org.ids.bob]);

    let small;
    await t.test("dry run: validation, in-file duplicates, visible matches only, and nothing imported", async () => {
      const before = await leadCount();
      const preview = await run(alice, (client, ctx) =>
        previewLeadImport(client, ctx, {
          fileName: "small.csv",
          fieldMapping: MAPPING,
          duplicateStrategy: "update",
          rows: [
            row("New", "new@example.test"),
            row("", "nofirst@example.test"),
            row("Again", "new@example.test"),
            row("Updated", "visible@example.test"),
            row("Sneaky", "hidden@example.test"),
            row("Formula", "not-an-email", { Company: "=HYPERLINK(\"http://evil\")" }),
          ],
        }),
      );
      small = preview.batch;
      assert.deepEqual(preview.report, { total: 6, valid: 3, invalid: 3, inFileDuplicates: 1, existingMatches: 1, plannedCreate: 2, plannedUpdate: 1, plannedSkip: 0 });
      assert.equal(await leadCount(), before, "a dry run creates nothing");
      const again = await run(alice, (client, ctx) =>
        previewLeadImport(client, ctx, { fileName: "small.csv", fieldMapping: MAPPING, duplicateStrategy: "update", rows: [row("New", "new@example.test"), row("", "nofirst@example.test"), row("Again", "new@example.test"), row("Updated", "visible@example.test"), row("Sneaky", "hidden@example.test"), row("Formula", "not-an-email", { Company: "=HYPERLINK(\"http://evil\")" })] }),
      );
      assert.equal(again.idempotent, true);
      assert.equal(again.batch.id, small.id);
      await assert.rejects(run(alice, (client, ctx) => previewLeadImport(client, ctx, { rows: [row("A", "a@example.test")], fieldMapping: MAPPING, duplicateStrategy: "merge" })), expectCode("CRM_LEAD_IMPORT_STRATEGY_INVALID"));
    });

    await t.test("small import commits synchronously; a match outside the importer's scope is never updated", async () => {
      const result = await run(alice, (client, ctx) => commitLeadImport(client, ctx, small.id));
      assert.equal(result.async, false);
      assert.equal(result.batch.status, "completed_with_errors");
      assert.equal(result.batch.created_rows, 1);
      assert.equal(result.batch.updated_rows, 1);
      const hidden = await kit.owner.query(`SELECT first_name FROM tenant.crm_leads WHERE id=$1`, [hiddenId]);
      assert.equal(hidden.rows[0].first_name, "Hidden", "Bob's lead was not touched by Alice's import");
      const visible = await kit.owner.query(`SELECT first_name FROM tenant.crm_leads WHERE id=$1`, [visibleId]);
      assert.equal(visible.rows[0].first_name, "Updated");
      const refused = await kit.owner.query(`SELECT error_code FROM tenant.crm_lead_import_rows WHERE batch_id=$1 AND row_number=5`, [small.id]);
      assert.equal(refused.rows[0].error_code, "CRM_LEAD_IMPORT_MATCH_OUT_OF_SCOPE");
      const replay = await run(alice, (client, ctx) => commitLeadImport(client, ctx, small.id));
      assert.equal(replay.replayed, true, "committing twice never imports twice");
      assert.equal(await leadCount("email='new@example.test'"), 1);
    });

    await t.test("error download lists every rejected row with formula-neutralised cells", async () => {
      const file = await run(alice, (client, ctx) => getLeadImportErrorsCsv(client, ctx, small.id));
      assert.equal(file.rows, 4);
      assert.match(file.csv, /Repeats row 1 of this file/);
      assert.match(file.csv, /'=HYPERLINK/, "a formula is prefixed so a spreadsheet shows it as text");
      assert.doesNotMatch(file.csv, /,=HYPERLINK/);
    });

    await t.test("isolation: another user and another organisation cannot open the batch", async () => {
      await assert.rejects(run(bob, (client, ctx) => getLeadImportBatch(client, ctx, small.id)), expectCode("CRM_LEAD_IMPORT_NOT_FOUND"));
      const mallory = other.session("mallory", IMPORTER);
      await assert.rejects(kit.tenant(other.organizationId, (client) => getLeadImportBatch(client, mallory, small.id)), expectCode("CRM_LEAD_IMPORT_NOT_FOUND"));
    });

    const bigRows = (prefix, count) => Array.from({ length: count }, (_, index) => row(`${prefix}${index}`, `${prefix}${index}@bulk.example.test`));
    const runtimeFor = (jobId, { failOnCall = null } = {}) => {
      let calls = 0;
      return {
        organizationId: org.organizationId,
        pool: kit.pool,
        job: { id: jobId, attempts: 1 },
        withTenantClient: async (_pool, organizationId, work) => {
          calls += 1;
          if (failOnCall && calls === failOnCall) {
            // A crash in the middle of a chunk: the chunk's transaction rolls back.
            return kit.tenant(organizationId, async (client) => {
              await work(client);
              throw new Error("worker crashed");
            });
          }
          return kit.tenant(organizationId, work);
        },
      };
    };

    await t.test("a large import becomes one background job that resumes after a crash without duplicates", async () => {
      const count = LEAD_IMPORT_LIMITS.syncCommitRows + LEAD_IMPORT_LIMITS.chunkSize * 2 + 37;
      const preview = await run(alice, (client, ctx) => previewLeadImport(client, ctx, { fileName: "big.csv", fieldMapping: MAPPING, duplicateStrategy: "skip", rows: bigRows("big", count) }));
      const committed = await run(alice, (client, ctx) => commitLeadImport(client, ctx, preview.batch.id));
      assert.equal(committed.async, true);
      assert.equal(committed.batch.status, "queued");
      const again = await run(alice, (client, ctx) => commitLeadImport(client, ctx, preview.batch.id));
      assert.equal(again.replayed, true);
      const jobs = await kit.owner.query(`SELECT id, payload FROM tenant.background_jobs WHERE organization_id=$1 AND job_type='crm.leads.import'`, [org.organizationId]);
      assert.equal(jobs.rows.length, 1, "one job per batch");
      const job = jobs.rows[0];

      // Attempt 1 crashes during its second chunk (call 1 marks processing, call 2 = chunk 1, call 3 = chunk 2).
      await assert.rejects(leadImportHandler(null, null, job.payload, runtimeFor(job.id, { failOnCall: 3 })), /worker crashed/);
      const midway = await run(alice, (client, ctx) => getLeadImportBatch(client, ctx, preview.batch.id));
      assert.equal(midway.batch.status, "processing");
      assert.equal(midway.progress.processed, LEAD_IMPORT_LIMITS.chunkSize, "the committed first chunk is kept; the crashed chunk is not");

      // Attempt 2 resumes where the first stopped.
      const result = await leadImportHandler(null, null, job.payload, runtimeFor(job.id));
      assert.equal(result.status, "completed");
      assert.equal(result.created, count);
      assert.equal(await leadCount("email LIKE 'big%@bulk.example.test'"), count, "every row imported exactly once");
      const finished = await run(alice, (client, ctx) => getLeadImportBatch(client, ctx, preview.batch.id));
      assert.equal(finished.progress.percent, 100);
      const rerun = await leadImportHandler(null, null, job.payload, runtimeFor(job.id));
      assert.deepEqual(rerun, { skipped: true }, "a duplicate delivery of a finished job does nothing");
    });

    await t.test("revoking the importer's permission stops a queued import and refuses the remaining rows", async () => {
      const count = LEAD_IMPORT_LIMITS.syncCommitRows + 10;
      const preview = await run(alice, (client, ctx) => previewLeadImport(client, ctx, { fileName: "revoked.csv", fieldMapping: MAPPING, duplicateStrategy: "skip", rows: bigRows("rev", count) }));
      await run(alice, (client, ctx) => commitLeadImport(client, ctx, preview.batch.id));
      const job = (await kit.owner.query(`SELECT id, payload FROM tenant.background_jobs WHERE organization_id=$1 AND idempotency_key=$2`, [org.organizationId, `crm.leads.import:${preview.batch.id}`])).rows[0];
      await kit.owner.query(`DELETE FROM role_permissions WHERE role_id=$1 AND permission_key='crm.import'`, [roleId]);
      const result = await leadImportHandler(null, null, job.payload, runtimeFor(job.id));
      assert.equal(result.status, "failed");
      assert.equal(await leadCount("email LIKE 'rev%@bulk.example.test'"), 0);
      const refused = await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.crm_lead_import_rows WHERE batch_id=$1 AND error_code='CRM_LEAD_IMPORT_AUTH_REVOKED'`, [preview.batch.id]);
      assert.equal(refused.rows[0].n, count);
      await kit.owner.query(`INSERT INTO role_permissions(role_id,permission_key) VALUES($1,'crm.import')`, [roleId]);
    });

    await t.test("rollback removes only untouched imported leads", async () => {
      const outcome = await run(alice, (client, ctx) => rollbackLeadImport(client, ctx, small.id));
      assert.equal(outcome.rolledBack, 1);
      assert.equal(await leadCount("email='new@example.test'"), 0);
      await assert.rejects(run(alice, (client, ctx) => rollbackLeadImport(client, ctx, small.id)), expectCode("CRM_LEAD_IMPORT_STATE_INVALID"));
    });
  } finally {
    await kit.close();
  }
});
