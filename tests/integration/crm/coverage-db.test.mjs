// F020 sales organisation and coverage against real PostgreSQL on the
// runtime role: hierarchy overview, gaps, unassigned queues, governed
// reassignment (permission, target, version, scope) and effective-dated
// territory transfer with audit.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import {
  getSalesCoverage,
  listUnassignedRecords,
  reassignCoverage,
  transferTerritoryCoverage,
} from "../../../services/api/src/modules/crm/sales-organization/coverage-service.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";
import { ADMIN, crmFixtures, MANAGER, REP } from "./crm-fixtures.mjs";

const COVERAGE_ADMIN = [...ADMIN, "crm.accounts.manage", "crm.coverage.view", "crm.teams.manage", "crm.territories.manage", "crm.coverage.assign"];
const COVERAGE_MANAGER = [...MANAGER, "crm.coverage.view", "crm.coverage.assign"];
const tomorrow = () => new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

test("F020 sales coverage", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin", "alice", "bob", "carol", "manny", "drifter"]);
    const other = await kit.organization(["mallory"]);
    const fx = crmFixtures(kit, org);
    const { alice, bob, carol, manny, drifter } = org.ids;
    await fx.crmRole([alice, bob, carol, manny, drifter]);
    const pipe = await fx.pipeline();
    const india = await fx.team("India");
    const west = await fx.team("West", { managerId: manny, parentId: india });
    const empty = await fx.team("Empty");
    await fx.member(west, alice);
    await fx.member(west, bob, { to: new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10) }); // ended last month
    await fx.member(west, carol, { from: "2999-01-01" }); // scheduled
    const north = await fx.territory("North");
    const pune = await fx.territory("Pune", { parentId: north });
    await fx.territoryAssignment(north, "user", alice);
    await fx.opportunity(pipe, { ownerId: alice, amount: 500 });
    await fx.opportunity(pipe, { ownerId: drifter, amount: 700 });
    const unassignedOpportunity = await fx.opportunity(pipe, { amount: 100 });
    const leads = [];
    for (let index = 0; index < 5; index += 1) leads.push(await kit.crmLead(org, null, "Queue", `Lead${index}`));
    const carolLead = await kit.crmLead(org, carol, "Carol", "Owned");
    const account = await fx.party("Unowned Customer");
    const foreignLead = await kit.crmLead(other, other.ids.mallory, "Foreign", "Lead");

    const admin = org.session("admin", COVERAGE_ADMIN);
    const manager = org.session("manny", COVERAGE_MANAGER);
    const rep = org.session("alice", REP);
    const run = (session, work) => kit.tenant(org.organizationId, (client) => work(client, session));

    await t.test("overview: hierarchy, membership states, coverage, gaps and unassigned work", async () => {
      const coverage = await run(admin, (client, ctx) => getSalesCoverage(client, ctx));
      const westRow = coverage.teams.find((team) => team.id === west);
      assert.equal(westRow.parentTeamId, india);
      assert.deepEqual(
        Object.fromEntries(westRow.members.map((member) => [member.userId, member.state])),
        { [alice]: "current", [bob]: "ended", [carol]: "scheduled" },
      );
      assert.equal(westRow.work.openOpportunities, 1);
      assert.equal(westRow.work.openPipeline, 500);
      const northRow = coverage.territories.find((territory) => territory.id === north);
      assert.equal(northRow.primaryAssigneeId, alice);
      const kinds = coverage.gaps.map((gap) => `${gap.kind}:${gap.id}`);
      assert.ok(kinds.includes(`territory_without_owner:${pune}`));
      assert.ok(kinds.includes(`team_without_manager:${india}`));
      assert.ok(kinds.includes(`team_without_members:${empty}`));
      assert.ok(kinds.includes(`seller_without_team:${drifter}`));
      assert.ok(!kinds.includes(`territory_without_owner:${north}`));
      assert.deepEqual(coverage.unassigned, { leads: 5, opportunities: 1, accounts: 1 });
      assert.deepEqual(coverage.permissions, { manageTeams: true, manageTerritories: true, reassign: true });
    });

    await t.test("viewing coverage needs crm.coverage.view", async () => {
      await assert.rejects(run(rep, (client, ctx) => getSalesCoverage(client, ctx)), expectCode("CRM_PERMISSION_REQUIRED"));
      await assert.rejects(run(rep, (client, ctx) => listUnassignedRecords(client, ctx, { type: "leads" })), expectCode("CRM_PERMISSION_REQUIRED"));
    });

    await t.test("unassigned queues page with a stable cursor", async () => {
      const seen = [];
      let cursor = null;
      do {
        const page = await run(admin, (client, ctx) => listUnassignedRecords(client, ctx, { type: "leads", cursor, limit: 2 }));
        seen.push(...page.records.map((record) => record.id));
        cursor = page.nextCursor;
      } while (cursor);
      assert.deepEqual(new Set(seen), new Set(leads));
      assert.equal(seen.length, 5);
    });

    await t.test("a manager reassigns to their own team only, with a reason, record by record", async () => {
      const ok = await run(manager, (client, ctx) => reassignCoverage(client, ctx, { type: "leads", ids: leads.slice(0, 2), ownerUserId: alice, reason: "Rebalance West" }));
      assert.equal(ok.summary.applied, 2, JSON.stringify(ok.results));
      const owners = await kit.owner.query(`SELECT owner_user_id FROM tenant.crm_leads WHERE id = ANY($1::uuid[])`, [leads.slice(0, 2)]);
      assert.ok(owners.rows.every((row) => row.owner_user_id === alice));
      const events = await kit.owner.query(`SELECT count(*)::int AS n FROM tenant.crm_lead_assignment_events WHERE lead_id = ANY($1::uuid[])`, [leads.slice(0, 2)]);
      assert.equal(events.rows[0].n, 2, "the governed lead command wrote assignment history");
      await assert.rejects(
        run(manager, (client, ctx) => reassignCoverage(client, ctx, { type: "leads", ids: [leads[2]], ownerUserId: drifter, reason: "Not my team" })),
        expectCode("CRM_OWNER_ASSIGNMENT_FORBIDDEN"),
      );
      await assert.rejects(run(manager, (client, ctx) => reassignCoverage(client, ctx, { type: "leads", ids: [leads[2]], ownerUserId: alice, reason: "" })), expectCode("CRM_COVERAGE_REASON_REQUIRED"));
      await assert.rejects(run(rep, (client, ctx) => reassignCoverage(client, ctx, { type: "leads", ids: [leads[2]], ownerUserId: alice, reason: "No right" })), expectCode("CRM_PERMISSION_REQUIRED"));
    });

    await t.test("stale versions conflict, out-of-scope and foreign records are skipped, the rest still apply", async () => {
      const result = await run(manager, (client, ctx) =>
        reassignCoverage(client, ctx, {
          type: "leads",
          ids: [leads[2], leads[3], carolLead, foreignLead],
          ownerUserId: alice,
          reason: "Mixed batch",
          expectedUpdatedAt: { [leads[3]]: "2000-01-01T00:00:00.000Z" },
        }),
      );
      const byId = Object.fromEntries(result.results.map((row) => [row.id, row.status]));
      assert.equal(byId[leads[2]], "applied");
      assert.equal(byId[leads[3]], "conflict");
      assert.equal(byId[carolLead], "skipped", "carol is outside the manager's team");
      assert.equal(byId[foreignLead], "skipped", "another organisation's lead does not exist here");
      const audit = await kit.owner.query(`SELECT metadata FROM audit_events WHERE organization_id=$1 AND event_type='crm.coverage.reassigned' ORDER BY created_at DESC LIMIT 1`, [org.organizationId]);
      assert.equal(audit.rows[0].metadata.reason, "Mixed batch");
      assert.equal(audit.rows[0].metadata.applied, 1);
    });

    await t.test("opportunities and accounts move through their own governed commands", async () => {
      const opportunities = await run(admin, (client, ctx) => reassignCoverage(client, ctx, { type: "opportunities", ids: [unassignedOpportunity], ownerUserId: alice, reason: "Pick up" }));
      assert.equal(opportunities.summary.applied, 1);
      const accounts = await run(admin, (client, ctx) => reassignCoverage(client, ctx, { type: "accounts", ids: [account], ownerUserId: alice, reason: "Named account" }));
      assert.equal(accounts.summary.applied, 1, JSON.stringify(accounts.results));
      const after = await run(admin, (client, ctx) => getSalesCoverage(client, ctx));
      assert.deepEqual(after.unassigned, { leads: 2, opportunities: 0, accounts: 0 });
      await assert.rejects(run(admin, (client, ctx) => reassignCoverage(client, ctx, { type: "leads", ids: Array.from({ length: 201 }, () => randomUUID()), ownerUserId: alice, reason: "Too many" })), expectCode("CRM_COVERAGE_SELECTION_TOO_LARGE"));
    });

    await t.test("territory transfer is effective-dated, idempotent, overlap-safe and audited", async () => {
      const from = tomorrow();
      const first = await run(admin, (client, ctx) => transferTerritoryCoverage(client, ctx, north, { assigneeType: "team", assigneeId: west, effectiveFrom: from, reason: "Team selling" }));
      assert.equal(first.changed, true);
      const rows = await kit.owner.query(
        `SELECT assignee_type, assignee_id, effective_from::text AS effective_from, effective_to::text AS effective_to FROM tenant.crm_territory_assignments WHERE territory_id=$1 AND assignment_role='primary' ORDER BY effective_from`,
        [north],
      );
      assert.equal(rows.rows.length, 2);
      assert.equal(rows.rows[0].assignee_id, alice);
      assert.equal(rows.rows[0].effective_to, new Date(Date.parse(from) - 86_400_000).toISOString().slice(0, 10), "the previous owner ends the day before");
      assert.deepEqual([rows.rows[1].assignee_type, rows.rows[1].effective_from, rows.rows[1].effective_to], ["team", from, null]);
      const again = await run(admin, (client, ctx) => transferTerritoryCoverage(client, ctx, north, { assigneeType: "team", assigneeId: west, effectiveFrom: from, reason: "Retry" }));
      assert.equal(again.changed, false, "a retried transfer is a no-op");
      await assert.rejects(run(admin, (client, ctx) => transferTerritoryCoverage(client, ctx, north, { assigneeType: "user", assigneeId: bob, effectiveFrom: from, reason: "Clash" })), expectCode("CRM_TERRITORY_COVERAGE_OVERLAP"));
      await assert.rejects(run(admin, (client, ctx) => transferTerritoryCoverage(client, ctx, north, { assigneeType: "user", assigneeId: bob, effectiveFrom: "2000-01-01", reason: "Backdated" })), expectCode("CRM_TERRITORY_EFFECTIVE_DATE_INVALID"));
      await assert.rejects(run(rep, (client, ctx) => transferTerritoryCoverage(client, ctx, north, { assigneeType: "user", assigneeId: bob, effectiveFrom: from, reason: "No right" })), expectCode("CRM_PERMISSION_REQUIRED"));
      await assert.rejects(run(admin, (client, ctx) => transferTerritoryCoverage(client, ctx, north, { assigneeType: "user", assigneeId: other.ids.mallory, effectiveFrom: from, reason: "Outsider" })), expectCode("CRM_TERRITORY_ASSIGNEE_INVALID"));
      const audit = await kit.owner.query(`SELECT after_data FROM audit_events WHERE organization_id=$1 AND event_type='crm.territory.coverage_transferred' AND entity_id=$2`, [org.organizationId, north]);
      assert.equal(audit.rows.length, 1);
      assert.equal(audit.rows[0].after_data.primary.assigneeType, "team");
    });
  } finally {
    await kit.close();
  }
});
