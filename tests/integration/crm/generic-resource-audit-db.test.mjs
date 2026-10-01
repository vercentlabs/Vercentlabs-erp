// Generic CRM resource writes must only stamp audit columns a table has.
// Ten registered resources (consent events, account signals, pipeline
// inspections, recommendations, AI predictions and feedback, conversation
// insights, playbook responses, enrichment jobs, data-quality scores) lack
// created_by and/or updated_by/updated_at; the generic create used to write
// them unconditionally, so every create through /api/crm/<resource> failed
// with 42703. Real PostgreSQL, restricted runtime role.
import assert from "node:assert/strict";
import test from "node:test";

import { createCrmRecord, updateCrmRecord } from "../../../services/api/src/modules/crm/data-management/resource-mutation-service.js";
import { permissionsForRole } from "../../../packages/permissions/src/roles.js";
import { createRuntimeKit } from "../shared-runtime/runtime-kit.mjs";
import { crmFixtures } from "./crm-fixtures.mjs";

test("generic create/update works on resources without every audit column", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin"]);
    const fx = crmFixtures(kit, org);
    await fx.crmRole([org.ids.admin]);
    const admin = org.session("admin", [...permissionsForRole("crm_administrator")], ["crm_administrator"]);
    const pipe = await fx.pipeline();
    const opportunity = await fx.opportunity(pipe, { ownerId: org.ids.admin });
    const leadId = await kit.crmLead(org, org.ids.admin, "Audit", "Probe");
    const partyId = await fx.party("Audit Probe Pvt Ltd");
    const now = new Date().toISOString();
    const run = (work) => kit.tenant(org.organizationId, (client) => work(client));
    const create = (resource, input) => run((client) => createCrmRecord(client, admin, resource, { companyId: org.companyId, ...input }));

    const conversation = await create("conversations", { opportunityId: opportunity, channel: "call", title: "Discovery call", startedAt: now, status: "completed", consentStatus: "granted", transcriptStatus: "ready" });
    const playbook = await create("playbooks", { name: "Probe playbook", framework: "bant", status: "active" });
    const question = await create("playbook-questions", { playbookId: playbook.id, questionKey: "budget", prompt: "Budget?", responseType: "boolean", sequence: 1, status: "active" });
    const cases = {
      "consent-events": { leadId, channel: "email", purpose: "marketing", action: "granted", lawfulBasis: "consent", source: "form", evidence: { note: "form checkbox" }, occurredAt: now },
      "account-signals": { partyId, signalType: "intent", title: "Pricing page visits", score: 60, occurredAt: now, source: "website", status: "active" },
      "pipeline-inspections": { opportunityId: opportunity, inspectedAt: now, stageAgeDays: 3, daysSinceActivity: 1, healthScore: 80, healthStatus: "healthy", calculationVersion: "v1" },
      recommendations: { entityType: "lead", entityId: leadId, recommendationType: "follow_up", title: "Follow up", rationale: "No reply in 7 days.", priority: "medium", confidence: 0.7, source: "rules", status: "open" },
      "ai-predictions": { entityType: "lead", entityId: leadId, predictionType: "lead_conversion", score: 0.6, label: "possible", modelProvider: "vercentlabs", modelName: "lead-propensity", generatedAt: now, status: "active" },
      "conversation-insights": { conversationId: conversation.id, insightType: "summary", title: "Summary", content: "Budget confirmed.", reviewStatus: "pending" },
      "playbook-responses": { playbookId: playbook.id, questionId: question.id, opportunityId: opportunity, response: { value: true }, respondedAt: now, source: "manual" },
      "enrichment-jobs": { entityType: "lead", entityId: leadId, provider: "manual", status: "queued" },
      "data-quality-scores": { entityType: "lead", entityId: leadId, completenessScore: 80, validityScore: 90, freshnessScore: 70, duplicateRiskScore: 10, overallScore: 82, calculatedAt: now },
    };
    const created = {};
    for (const [resource, input] of Object.entries(cases))
      await t.test(`create ${resource}`, async () => {
        created[resource] = await create(resource, input);
        assert.ok(created[resource]?.id, `${resource} was created`);
      });
    await t.test("create ai-feedback", async () => {
      const feedback = await create("ai-feedback", { predictionId: created["ai-predictions"].id, userId: org.ids.admin, outcome: "correct" });
      assert.ok(feedback.id);
    });
    await t.test("update a resource without updated_by", async () => {
      const updated = await run((client) => updateCrmRecord(client, admin, "recommendations", created.recommendations.id, { status: "accepted" }));
      assert.equal(updated.status, "accepted");
    });
  } finally {
    await kit.close();
  }
});
