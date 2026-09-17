// Real PostgreSQL integration test — not a fake-DB-client unit test.
//
// F007: the default Lead pipeline changed from 3 stages (new/contacted/
// working) to 5 (new/attempting/contacted/working/nurturing, "Connected"
// and "Working / Discovery" as the new labels for contacted/working). The
// classification/upgrade logic in stage-catalog.js's ensureDefaultLeadStages
// depends on real Postgres constraints (crm_leads_lifecycle_stage_fkey,
// crm_lead_stages_one_initial_uidx, RLS) and real multi-statement sequencing
// that a mocked client cannot meaningfully prove — this suite exercises it
// against a real database, matching the existing crm-tenant-rls-context.test.mjs
// pattern in this directory.
import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";

import { Client } from "pg";

const adminConnectionString = process.env.MIGRATION_DATABASE_URL || "";

async function connectOrNull(connectionString) {
  if (!connectionString) return null;
  const client = new Client({ connectionString });
  try {
    await client.connect();
    return client;
  } catch {
    return null;
  }
}

async function freshOrg(admin, label) {
  const orgId = randomUUID();
  const userId = randomUUID();
  await admin.query(
    `INSERT INTO public.users(id,email,full_name,password_hash,status,email_verified_at) VALUES ($1,$2,$3,'x','active',now())`,
    [userId, `${label}-${orgId}@test.invalid`, label],
  );
  await admin.query(
    `INSERT INTO public.organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES ($1,$2,$3,'IN','Asia/Kolkata','INR',$4)`,
    [orgId, label, `${label}-${orgId}`, userId],
  );
  await admin.query(
    `INSERT INTO public.numbering_series(organization_id,entity_type,prefix,next_number,padding,status) VALUES ($1,'crm_lead','LEAD-',1,6,'active')`,
    [orgId],
  );
  return {
    orgId,
    userId,
    context: {
      organizationId: orgId,
      userId,
      activeCompanyId: null,
      activeBranchId: null,
      allowAllCompanies: true,
      roleSlugs: ["organization_owner"],
      permissions: [],
    },
  };
}

async function seedLegacyThreeStage(admin, orgId, userId, { bidirectional }) {
  const inserted = await admin.query(
    `INSERT INTO tenant.crm_lead_stages(organization_id,code,name,description,sort_order,status,is_system,is_initial,created_by,updated_by)
     VALUES
       ($1,'new','New','Captured and awaiting first engagement.',10,'active',true,true,$2,$2),
       ($1,'contacted','Contacted','Initial outreach has been made.',20,'active',true,false,$2,$2),
       ($1,'working','Working','Active follow-up or discovery is underway.',30,'active',true,false,$2,$2)
     RETURNING id,code`,
    [orgId, userId],
  );
  const byCode = Object.fromEntries(inserted.rows.map((row) => [row.code, row.id]));
  const edges = bidirectional
    ? [
        ["new", "contacted"],
        ["contacted", "new"],
        ["contacted", "working"],
        ["working", "contacted"],
      ]
    : [
        ["new", "contacted"],
        ["contacted", "working"],
      ];
  for (const [from, to] of edges) {
    await admin.query(
      `INSERT INTO tenant.crm_lead_stage_transitions(organization_id,from_stage_id,to_stage_id,created_by) VALUES ($1,$2,$3,$4)`,
      [orgId, byCode[from], byCode[to], userId],
    );
  }
  return byCode;
}

test("F007 five-stage default: fresh org, legacy-org upgrade, and customized-org preservation against real PostgreSQL", async (t) => {
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  const { createCrmRecord, ensureDefaultLeadStages, classifyLeadStageCustomization, previewLeadStageTemplateUpgrade, applyLeadStageTemplateUpgrade } =
    await import("../../services/api/src/index.js");
  const { setTenantContext } = await import("../../packages/database/src/index.js");

  const cleanupOrgIds = [];
  try {
    await t.test("a truly fresh organization seeds the exact 5-stage template and 5-edge cycle graph on its first Lead", async () => {
      const { orgId, userId, context } = await freshOrg(admin, "F007 Fresh Org");
      cleanupOrgIds.push(orgId);
      await setTenantContext(admin, orgId);
      const stagesBeforeCount = (await admin.query(`SELECT count(*)::int AS count FROM tenant.crm_lead_stages WHERE organization_id=$1`, [orgId])).rows[0];
      assert.equal(stagesBeforeCount.count, 0);

      const lead = await createCrmRecord(admin, context, "leads", { firstName: "Test", lastName: "Lead", email: `${userId}@test.invalid` });
      assert.equal(lead.status, "new");

      const stages = (await admin.query(`SELECT code,name,sort_order,is_initial FROM tenant.crm_lead_stages WHERE organization_id=$1 ORDER BY sort_order`, [orgId])).rows;
      assert.deepEqual(
        stages.map((row) => row.code),
        ["new", "attempting", "contacted", "working", "nurturing"],
      );
      assert.equal(stages[0].is_initial, true);
      assert.equal(stages.slice(1).every((row) => row.is_initial === false), true);
      assert.equal(stages.find((row) => row.code === "contacted").name, "Connected");
      assert.equal(stages.find((row) => row.code === "working").name, "Working / Discovery");

      const edges = (
        await admin.query(
          `SELECT from_stage.code AS from_code,to_stage.code AS to_code
             FROM tenant.crm_lead_stage_transitions edge
             JOIN tenant.crm_lead_stages from_stage ON from_stage.id=edge.from_stage_id
             JOIN tenant.crm_lead_stages to_stage ON to_stage.id=edge.to_stage_id
            WHERE edge.organization_id=$1`,
          [orgId],
        )
      ).rows.map((row) => `${row.from_code}->${row.to_code}`);
      assert.deepEqual(
        new Set(edges),
        new Set(["new->attempting", "attempting->contacted", "contacted->working", "working->nurturing", "nurturing->attempting"]),
      );

      // Idempotency: calling it again must not duplicate anything.
      await ensureDefaultLeadStages(admin, context);
      const stagesAgain = (await admin.query(`SELECT count(*)::int AS count FROM tenant.crm_lead_stages WHERE organization_id=$1`, [orgId])).rows[0];
      assert.equal(stagesAgain.count, 5);
    });

    await t.test("an untouched one-directional legacy org (created after migration 093) is classified correctly and safely upgraded, preserving an existing Lead's stage and history", async () => {
      const { orgId, userId, context } = await freshOrg(admin, "F007 Legacy Unidirectional Org");
      cleanupOrgIds.push(orgId);
      await setTenantContext(admin, orgId);
      const byCode = await seedLegacyThreeStage(admin, orgId, userId, { bidirectional: false });

      // A real pre-existing Lead, inserted directly (not through the
      // governed command) to simulate production data that already existed
      // before this upgrade ever shipped.
      const leadId = randomUUID();
      await admin.query(
        `INSERT INTO tenant.crm_leads(id,organization_id,code,first_name,last_name,email,status,record_status,stage_entered_at,created_by,updated_by)
         VALUES ($1,$2,'LEAD-000001','Existing','Lead','existing1@test.invalid','contacted','active',now(),$3,$3)`,
        [leadId, orgId, userId],
      );
      await admin.query(
        `INSERT INTO tenant.crm_lead_stage_events(organization_id,lead_id,from_stage_id,to_stage_id,from_stage_code,to_stage_code,source,changed_by_user_id)
         VALUES ($1,$2,$3,$4,'new','contacted','manual',$5)`,
        [orgId, leadId, byCode.new, byCode.contacted, userId],
      );

      const existingRows = (
        await admin.query(
          `SELECT code,name,description,sort_order,status,is_system,is_initial,dwell_warning_hours,dwell_breach_hours FROM tenant.crm_lead_stages WHERE organization_id=$1`,
          [orgId],
        )
      ).rows;
      assert.equal(await classifyLeadStageCustomization(admin, context, existingRows), "UNTOUCHED_STANDARD_3_STAGE");

      await ensureDefaultLeadStages(admin, context);

      const stageCodes = (await admin.query(`SELECT code FROM tenant.crm_lead_stages WHERE organization_id=$1 ORDER BY sort_order`, [orgId])).rows.map((r) => r.code);
      assert.deepEqual(stageCodes, ["new", "attempting", "contacted", "working", "nurturing"]);

      const leadAfter = (await admin.query(`SELECT status FROM tenant.crm_leads WHERE id=$1`, [leadId])).rows[0];
      assert.equal(leadAfter.status, "contacted", "an existing Lead's stage code must never change merely because new stages were introduced");

      const historyCount = (await admin.query(`SELECT count(*)::int AS count FROM tenant.crm_lead_stage_events WHERE lead_id=$1`, [leadId])).rows[0];
      assert.equal(historyCount.count, 1, "immutable stage history must be unchanged by the upgrade");
    });

    await t.test("an untouched bidirectional legacy org (migration 063's original pre-Prompt-4 seed) is also classified correctly and safely upgraded", async () => {
      const { orgId, userId, context } = await freshOrg(admin, "F007 Legacy Bidirectional Org");
      cleanupOrgIds.push(orgId);
      await setTenantContext(admin, orgId);
      await seedLegacyThreeStage(admin, orgId, userId, { bidirectional: true });

      const existingRows = (
        await admin.query(
          `SELECT code,name,description,sort_order,status,is_system,is_initial,dwell_warning_hours,dwell_breach_hours FROM tenant.crm_lead_stages WHERE organization_id=$1`,
          [orgId],
        )
      ).rows;
      assert.equal(await classifyLeadStageCustomization(admin, context, existingRows), "UNTOUCHED_STANDARD_3_STAGE");

      await ensureDefaultLeadStages(admin, context);
      const edgeCount = (await admin.query(`SELECT count(*)::int AS count FROM tenant.crm_lead_stage_transitions WHERE organization_id=$1`, [orgId])).rows[0];
      assert.equal(edgeCount.count, 5, "the old 4-edge bidirectional graph must be fully replaced by the new 5-edge cycle, not left standing alongside it");
    });

    await t.test("a customized org (renamed initial stage) is never auto-upgraded, and its preview/apply template workflow is purely additive and idempotent", async () => {
      const { orgId, userId, context } = await freshOrg(admin, "F007 Customized Org");
      cleanupOrgIds.push(orgId);
      await setTenantContext(admin, orgId);
      await seedLegacyThreeStage(admin, orgId, userId, { bidirectional: false });
      await admin.query(`UPDATE tenant.crm_lead_stages SET name='Fresh Lead' WHERE organization_id=$1 AND code='new'`, [orgId]);

      const existingRows = (
        await admin.query(
          `SELECT code,name,description,sort_order,status,is_system,is_initial,dwell_warning_hours,dwell_breach_hours FROM tenant.crm_lead_stages WHERE organization_id=$1`,
          [orgId],
        )
      ).rows;
      assert.equal(await classifyLeadStageCustomization(admin, context, existingRows), "CUSTOMIZED");

      await ensureDefaultLeadStages(admin, context);
      const untouched = (await admin.query(`SELECT count(*)::int AS count FROM tenant.crm_lead_stages WHERE organization_id=$1`, [orgId])).rows[0];
      assert.equal(untouched.count, 3, "a customized org must never be auto-upgraded");
      const nameStillCustom = (await admin.query(`SELECT name FROM tenant.crm_lead_stages WHERE organization_id=$1 AND code='new'`, [orgId])).rows[0];
      assert.equal(nameStillCustom.name, "Fresh Lead");

      const preview = await previewLeadStageTemplateUpgrade(admin, context);
      assert.deepEqual(
        preview.stagesToCreate.map((s) => s.code).sort(),
        ["attempting", "nurturing"],
      );
      assert.equal(preview.affectedLeadCount, 0);
      assert.equal(preview.requiresLeadMigration, false);
      assert.equal(preview.conflicts.length, 0);

      await assert.rejects(
        () => applyLeadStageTemplateUpgrade(admin, context, {}),
        (error) => error.code === "CRM_LEAD_STAGE_TEMPLATE_CONFIRMATION_REQUIRED",
      );

      const applied = await applyLeadStageTemplateUpgrade(admin, context, { confirm: true });
      assert.equal(applied.applied, true);
      assert.equal(applied.stagesCreated.length, 2);

      const finalName = (await admin.query(`SELECT name FROM tenant.crm_lead_stages WHERE organization_id=$1 AND code='new'`, [orgId])).rows[0];
      assert.equal(finalName.name, "Fresh Lead", "applying the template must never rename an existing, customized stage");

      const finalStageCount = (await admin.query(`SELECT count(*)::int AS count FROM tenant.crm_lead_stages WHERE organization_id=$1`, [orgId])).rows[0];
      assert.equal(finalStageCount.count, 5);

      // Idempotent: applying again finds nothing left to add.
      const secondPreview = await previewLeadStageTemplateUpgrade(admin, context);
      assert.equal(secondPreview.stagesToCreate.length, 0);
      assert.equal(secondPreview.edgesToAdd.length, 0);
    });
  } finally {
    for (const orgId of cleanupOrgIds) {
      await admin.query(`DELETE FROM tenant.crm_lead_stage_events WHERE organization_id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM tenant.crm_leads WHERE organization_id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM tenant.crm_lead_stage_transitions WHERE organization_id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM tenant.crm_lead_stages WHERE organization_id=$1`, [orgId]).catch(() => undefined);
      await admin.query(`DELETE FROM public.numbering_series WHERE organization_id=$1`, [orgId]).catch(() => undefined);
      const org = await admin.query(`SELECT created_by FROM public.organizations WHERE id=$1`, [orgId]).catch(() => ({ rows: [] }));
      await admin.query(`DELETE FROM public.organizations WHERE id=$1`, [orgId]).catch(() => undefined);
      if (org.rows[0]?.created_by) {
        await admin.query(`DELETE FROM public.users WHERE id=$1`, [org.rows[0].created_by]).catch(() => undefined);
      }
    }
    await admin.end();
  }
});
