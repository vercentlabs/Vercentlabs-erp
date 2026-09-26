// Global search and background-job visibility, against real PostgreSQL on the
// restricted runtime role inside tenant transactions (as /api/search and
// /api/jobs run them).
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { getJobForViewer, listJobsForViewer } from "../../../services/api/src/core/platform/jobs/index.js";
import { SEARCH_PROVIDERS } from "../../../services/api/src/orchestration/search/providers.js";
import { SEARCH_LIMITS, searchRecords } from "../../../services/api/src/orchestration/search/service.js";
import { createRuntimeKit, expectCode } from "./runtime-kit.mjs";

const REP = ["crm.view", "crm.leads.manage", "sales.view"];
const DTO_KEYS = ["detail", "href", "moduleKey", "recordId", "sourceKey", "sourceLabel", "title"];

async function enableModules(kit, organizationId, keys) {
  for (const key of keys) {
    await kit.owner.query(
      `INSERT INTO organization_modules (organization_id, module_key, name, status, enabled_at) VALUES ($1,$2,$2,'enabled',now())
       ON CONFLICT (organization_id, module_key) DO UPDATE SET status='enabled', enabled_at=now()`,
      [organizationId, key],
    );
  }
}

test("search: server-side providers gated by module, entitlement, permission and record scope", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["alice", "bob"]);
    const other = await kit.organization(["mallory"]);
    await enableModules(kit, org.organizationId, ["crm", "sales"]);
    await enableModules(kit, other.organizationId, ["crm", "sales"]);
    const alice = org.session("alice", REP);
    const bob = org.session("bob", REP);
    const mallory = other.session("mallory", REP);

    await kit.crmLead(org, alice.userId, "Zephyr", "Alpha");
    await kit.crmLead(org, bob.userId, "Zephyr", "Hidden");
    await kit.crmLead(other, mallory.userId, "Zephyr", "Foreign");
    for (let index = 0; index < 9; index += 1) await kit.crmLead(org, alice.userId, "Quasar", `Number${index}`);
    await kit.owner.query(
      `INSERT INTO tenant.business_parties (id, organization_id, company_id, code, party_type, display_name, email, phone, status, created_by)
       VALUES ($1,$2,$3,'ZEP-CUST','customer','Zephyr Traders','ceo@zephyr.test','+91 99999 00000','active',$4)`,
      [randomUUID(), org.organizationId, org.companyId, alice.userId],
    );

    const search = (session, query, accessibleModules, extra = {}) => kit.tenant(session.organizationId, (client) => searchRecords(client, session, { query, accessibleModules, ...extra }));
    const hits = (result) => result.groups.flatMap((group) => group.results);
    const aliceModules = await kit.accessibleModules(alice);

    await t.test("CRM and Sales results come back as a safe DTO, within record scope", async () => {
      assert.ok(aliceModules.includes("crm") && aliceModules.includes("sales"));
      const result = await search(alice, "Zephyr", aliceModules);
      const titles = hits(result).map((hit) => hit.title);
      assert.ok(titles.includes("Zephyr Alpha"));
      assert.ok(titles.includes("Zephyr Traders"), "Sales customers are searchable");
      assert.ok(!titles.includes("Zephyr Hidden"), "a lead Alice may not open is not found");
      assert.ok(!titles.includes("Zephyr Foreign"), "another organisation's records are never found");
      for (const hit of hits(result)) assert.deepEqual(Object.keys(hit).sort(), DTO_KEYS);
      assert.ok(!JSON.stringify(result).includes("ceo@zephyr.test"));
      assert.ok(!JSON.stringify(result).includes("99999"));
      assert.ok(hits(await search(bob, "Zephyr", await kit.accessibleModules(bob))).some((hit) => hit.title === "Zephyr Hidden"));
    });

    await t.test("short, long and wildcard queries", async () => {
      await assert.rejects(search(alice, "Z", aliceModules), expectCode("SEARCH_QUERY_TOO_SHORT"));
      await assert.rejects(search(alice, "%%", aliceModules), expectCode("SEARCH_QUERY_TOO_SHORT"), "wildcards alone never match everything");
      await assert.rejects(search(alice, "__", aliceModules), expectCode("SEARCH_QUERY_TOO_SHORT"));
      const long = await search(alice, `Zephyr${"x".repeat(500)}`, aliceModules);
      assert.equal(long.query.length, SEARCH_LIMITS.maxLength);
      const injection = await search(alice, "Zephyr'; DROP TABLE tenant.crm_leads; --", aliceModules);
      assert.equal(hits(injection).length, 0);
      assert.ok(hits(await search(alice, "Zephyr", aliceModules)).length > 0, "tables intact");
    });

    await t.test("results are capped per source", async () => {
      const result = await search(alice, "Quasar", aliceModules);
      const leads = result.groups.find((group) => group.sourceKey === "crm.leads");
      assert.equal(leads.results.length, SEARCH_LIMITS.perProvider);
      assert.ok(hits(result).length <= SEARCH_LIMITS.total);
    });

    await t.test("a disabled module is not searched", async () => {
      await kit.owner.query(`UPDATE organization_modules SET status='disabled' WHERE organization_id=$1 AND module_key='sales'`, [org.organizationId]);
      const modules = await kit.accessibleModules(alice);
      assert.ok(!modules.includes("sales"));
      const result = await search(alice, "Zephyr", modules);
      assert.ok(!result.groups.some((group) => group.moduleKey === "sales"));
      await enableModules(kit, org.organizationId, ["sales"]);
    });

    await t.test("an unentitled module is not searched when billing is enforced", async () => {
      await kit.owner.query(`INSERT INTO billing_entitlement_overrides (organization_id, entitlement_key, entitlement_value, reason) VALUES ($1,'modules','["crm"]'::jsonb,'rt test')`, [org.organizationId]);
      try {
        const modules = await kit.accessibleModules(alice, { BILLING_ENFORCEMENT_MODE: "enforce" });
        assert.ok(modules.includes("crm") && !modules.includes("sales"), "the plan override leaves Sales unentitled");
        const result = await search(alice, "Zephyr", modules);
        assert.ok(result.groups.length > 0 && result.groups.every((group) => group.moduleKey === "crm"));
      } finally {
        await kit.owner.query(`DELETE FROM billing_entitlement_overrides WHERE organization_id=$1`, [org.organizationId]);
      }
    });

    await t.test("without the module permission a source is not searched", async () => {
      const salesOnly = org.session("alice", ["sales.view"]);
      const result = await search(salesOnly, "Zephyr", aliceModules);
      assert.ok(result.groups.every((group) => group.moduleKey === "sales"));
    });

    await t.test("one failing provider is reported unavailable; the others still answer", async () => {
      const broken = { key: "broken", label: "Broken", moduleKey: "crm", requiredPermission: "crm.view", execute: (client) => client.query("SELECT * FROM tenant.table_that_does_not_exist") };
      const result = await search(alice, "Zephyr", aliceModules, { providers: [broken, ...SEARCH_PROVIDERS] });
      assert.equal(result.groups.find((group) => group.sourceKey === "broken").status, "unavailable");
      assert.ok(hits(result).some((hit) => hit.title === "Zephyr Alpha"), "the transaction survived the failure");
    });
  } finally {
    await kit.close();
  }
});

test("background jobs: own user-facing jobs; operations viewers see the organisation; nothing sensitive leaks", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["alice", "bob", "ops"]);
    const other = await kit.organization(["mallory"]);
    const job = async (organizationId, fields) =>
      (await kit.owner.query(
        `INSERT INTO tenant.background_jobs (organization_id, job_type, payload, status, requested_by, last_error, progress, result_manifest, attempts)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [organizationId, fields.type, fields.payload ?? { secretFilter: "owner=ceo" }, fields.status ?? "completed", fields.by ?? null, fields.error ?? null, fields.progress ?? {}, fields.manifest ?? {}, fields.attempts ?? 1],
      )).rows[0].id;
    const aliceExport = await job(org.organizationId, {
      type: "crm.leads.export", by: org.ids.alice, progress: { processed: 10, total: 10, note: "Top secret lead list" },
      manifest: { rowCount: 10, truncated: false, csv: `id,email\n${"a@b.c,".repeat(100)}` },
    });
    const aliceFailed = await job(org.organizationId, {
      type: "crm.leads.bulk_update", by: org.ids.alice, status: "dead", attempts: 5,
      error: "connect ECONNREFUSED postgres://vercent_app:pw@db:5432/erp token=abcdefghijklmnopqrstuvwxyz0123456789ABCD\n    at Pool.connect (/srv/node_modules/pg/lib/index.js:10)",
    });
    const bobJob = await job(org.organizationId, { type: "crm.leads.export", by: org.ids.bob });
    const systemJob = await job(org.organizationId, { type: "crm.automation.detect_lead_sla_breaches" });
    const aliceScheduled = await job(org.organizationId, { type: "crm.pipeline.capture_daily_snapshot", by: org.ids.alice });
    const foreign = await job(other.organizationId, { type: "crm.leads.export", by: other.ids.mallory });

    const viewer = (label, operations = false) => ({ organizationId: org.organizationId, userId: org.ids[label], operations });
    const list = (who) => kit.tenant(who.organizationId, (client) => listJobsForViewer(client, who, {}));
    const detail = (who, id) => kit.tenant(who.organizationId, (client) => getJobForViewer(client, who, id));

    await t.test("an ordinary user sees only their own user-facing jobs", async () => {
      const ids = (await list(viewer("alice"))).map((row) => row.id).sort();
      assert.deepEqual(ids, [aliceExport, aliceFailed].sort());
      await assert.rejects(detail(viewer("alice"), bobJob), expectCode("JOB_NOT_FOUND"));
      await assert.rejects(detail(viewer("alice"), systemJob), expectCode("JOB_NOT_FOUND"));
      await assert.rejects(detail(viewer("alice"), aliceScheduled), expectCode("JOB_NOT_FOUND"), "scheduler work is not a user's job even if attributed");
      await assert.rejects(detail(viewer("alice"), "nope"), expectCode("JOB_NOT_FOUND"));
    });

    await t.test("an operations viewer sees the whole organisation, never another one", async () => {
      const ids = (await list(viewer("ops", true))).map((row) => row.id);
      assert.equal(ids.length, 5);
      assert.ok(ids.includes(systemJob) && ids.includes(bobJob));
      assert.ok(!ids.includes(foreign));
      await assert.rejects(detail(viewer("ops", true), foreign), expectCode("JOB_NOT_FOUND"));
    });

    await t.test("a user sees a curated failure; operations see a redacted technical one", async () => {
      const mine = (await list(viewer("alice"))).find((row) => row.id === aliceFailed);
      assert.match(mine.error, /could not finish/);
      assert.equal(mine.jobType, undefined);
      assert.equal(mine.attempts, undefined);
      const ops = (await list(viewer("ops", true))).find((row) => row.id === aliceFailed);
      assert.match(ops.error, /ECONNREFUSED/);
      for (const leaked of ["vercent_app:pw", "abcdefghijklmnopqrstuvwxyz0123456789ABCD", "node_modules"]) assert.ok(!ops.error.includes(leaked), leaked);
    });

    await t.test("labels, progress counters and manifest counters only; never the payload or file content", async () => {
      const row = await detail(viewer("alice"), aliceExport);
      assert.equal(row.label, "Lead export");
      assert.deepEqual(row.progress, { processed: 10, total: 10 });
      assert.deepEqual(row.result, { rowCount: 10, truncated: false });
      assert.equal(row.hasOutput, true);
      const text = JSON.stringify(row);
      for (const leaked of ["secretFilter", "Top secret", "a@b.c", "payload"]) assert.ok(!text.includes(leaked), leaked);
    });

    await t.test("status filter is validated", async () => {
      await assert.rejects(kit.tenant(org.organizationId, (client) => listJobsForViewer(client, viewer("alice"), { status: "'; DROP" })), expectCode("JOB_FILTER_INVALID"));
      assert.equal((await kit.tenant(org.organizationId, (client) => listJobsForViewer(client, viewer("alice"), { status: "dead" }))).length, 1);
    });
  } finally {
    await kit.close();
  }
});
