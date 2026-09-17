// F007: the default Lead pipeline's directed graph is now a 5-stage cycle —
// New -> Attempting Contact -> Connected -> Working / Discovery -> Nurturing
// -> Attempting Contact (the closing edge supports re-engaging a nurtured
// Lead). Stable codes: new, attempting (new), contacted (preserved,
// relabeled "Connected"), working (preserved, relabeled "Working /
// Discovery"), nurturing (new). This file proves each of the five declared
// edges is legal through the governed transitionLeadStage command, and that
// an undeclared shortcut (skipping a stage) is rejected — mirroring the
// "forbidden B->A" test in crm-lead-lifecycle-directed-graph-f007.test.mjs
// but scoped to the specific new default graph rather than generic
// transition-graph mechanics.
import assert from "node:assert/strict";
import test from "node:test";

import { transitionLeadStage } from "../src/modules/crm/lead-lifecycle-qualification-and-prioritization/lifecycle/transition-engine.js";

const org = "11111111-1111-4111-8111-111111111111";
const actorId = "22222222-2222-4222-8222-222222222222";
const leadId = "33333333-3333-4333-8333-333333333333";

const context = {
  organizationId: org,
  userId: actorId,
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  roleSlugs: ["organization_owner"],
  permissions: ["crm.records.view_all"],
};

const STAGES = {
  new: { id: "a0000000-0000-4000-8000-000000000001", name: "New" },
  attempting: { id: "a0000000-0000-4000-8000-000000000002", name: "Attempting Contact" },
  contacted: { id: "a0000000-0000-4000-8000-000000000003", name: "Connected" },
  working: { id: "a0000000-0000-4000-8000-000000000004", name: "Working / Discovery" },
  nurturing: { id: "a0000000-0000-4000-8000-000000000005", name: "Nurturing" },
};

const DECLARED_EDGES = new Set([
  "new->attempting",
  "attempting->contacted",
  "contacted->working",
  "working->nurturing",
  "nurturing->attempting",
]);

function graphClient(fromCode, toCode) {
  const from = STAGES[fromCode];
  const to = STAGES[toCode];
  return {
    async query(sql, values = []) {
      if (sql.includes("SELECT lead.*,current.id AS current_stage_id"))
        return {
          rows: [{
            id: leadId, organization_id: org, status: fromCode, record_status: "active", updated_at: "2026-01-01T00:00:00.000Z",
            current_stage_id: from.id, current_stage_name: from.name, current_stage_status: "active",
          }],
        };
      if (sql.includes("FROM tenant.crm_lead_stages stage") && sql.includes("stage.code=$2"))
        return { rows: [{ id: to.id, organization_id: org, code: toCode, name: to.name, status: "active", lead_count: 0 }] };
      if (sql.includes("SELECT reason_required FROM tenant.crm_lead_stage_transitions"))
        return { rows: DECLARED_EDGES.has(`${fromCode}->${toCode}`) ? [{ reason_required: false }] : [] };
      if (sql.includes("UPDATE tenant.crm_leads SET status="))
        return { rows: [{ id: leadId, status: toCode, record_status: "active" }] };
      if (sql.includes("INSERT INTO tenant.crm_lead_stage_events")) return { rows: [{ id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee" }] };
      if (sql.includes("INSERT INTO tenant.crm_outbox_events")) return { rows: [] };
      if (sql.includes("SELECT lead.id FROM tenant.crm_leads lead")) return { rows: [{ id: leadId }] };
      if (sql.includes("FROM tenant.crm_lead_stage_events event")) return { rows: [] };
      if (sql.startsWith("SELECT set_config")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

for (const edge of DECLARED_EDGES) {
  const [fromCode, toCode] = edge.split("->");
  test(`F007 default 5-stage graph: ${STAGES[fromCode].name} -> ${STAGES[toCode].name} is a legal transition`, async () => {
    const client = graphClient(fromCode, toCode);
    const result = await transitionLeadStage(client, context, leadId, { stageCode: toCode });
    assert.equal(result.changed, true);
    assert.equal(result.stage.code, toCode);
  });
}

test("F007 default 5-stage graph: skipping a stage (New -> Connected) is not a declared edge and is rejected", async () => {
  const client = graphClient("new", "contacted");
  await assert.rejects(
    transitionLeadStage(client, context, leadId, { stageCode: "contacted" }),
    (error) => error.code === "CRM_LEAD_STAGE_TRANSITION_INVALID",
  );
});

test("F007 default 5-stage graph: moving backward (Working / Discovery -> Attempting Contact) is not a declared edge and is rejected", async () => {
  const client = graphClient("working", "attempting");
  await assert.rejects(
    transitionLeadStage(client, context, leadId, { stageCode: "attempting" }),
    (error) => error.code === "CRM_LEAD_STAGE_TRANSITION_INVALID",
  );
});

test("F007 default 5-stage graph: Nurturing -> Attempting Contact re-engages a nurtured Lead (the closing edge of the cycle)", async () => {
  const client = graphClient("nurturing", "attempting");
  const result = await transitionLeadStage(client, context, leadId, { stageCode: "attempting" });
  assert.equal(result.changed, true);
  assert.equal(result.stage.name, "Attempting Contact");
});
