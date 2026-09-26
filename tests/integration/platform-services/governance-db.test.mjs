// Feature configuration, privacy/retention and AI governance against real
// PostgreSQL on the restricted runtime role.
import assert from "node:assert/strict";
import test from "node:test";

import { getAiGovernanceOverview, recordAiRequest, setAiPolicy } from "../../../services/api/src/core/platform/ai/index.js";
import {
  cancelScheduledConfiguration,
  getConfigurationValue,
  isFeatureFlagEnabled,
  listTenantConfiguration,
  setOperatorConfiguration,
  setTenantConfiguration,
} from "../../../services/api/src/core/platform/configuration/index.js";
import { createPrivacyRequest, listRetentionPolicies, transitionPrivacyRequest, writeRetentionPolicy } from "../../../services/api/src/core/platform/privacy/index.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";

function platformTx(kit) {
  return (work) =>
    kit.runtime(async (client) => {
      await client.query("BEGIN");
      try {
        const result = await work(client);
        await client.query("COMMIT");
        return result;
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    });
}

test("feature configuration: versions, schedules, concurrency, operator isolation", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin"]);
    const admin = org.session("admin", ["platform.configuration.manage"]);
    const tx = platformTx(kit);
    const retention = { namespace: "platform.exports", key: "artifact_retention_hours" };

    await t.test("defaults, then a new effective version", async () => {
      assert.equal(await tx((client) => getConfigurationValue(client, org.organizationId, retention.namespace, retention.key)), 24);
      await tx((client) => setTenantConfiguration(client, admin, { ...retention, value: 48 }));
      assert.equal(await tx((client) => getConfigurationValue(client, org.organizationId, retention.namespace, retention.key)), 48);
    });

    await t.test("a future value is scheduled, can be cancelled, and never rewrites history", async () => {
      const future = new Date(Date.now() + 7 * 86400_000).toISOString();
      const scheduled = await tx((client) => setTenantConfiguration(client, admin, { ...retention, value: 72, effectiveFrom: future }));
      assert.equal(await tx((client) => getConfigurationValue(client, org.organizationId, retention.namespace, retention.key)), 48, "still the current value today");
      assert.equal(await tx((client) => getConfigurationValue(client, org.organizationId, retention.namespace, retention.key, new Date(Date.now() + 8 * 86400_000))), 72);
      const entry = (await tx((client) => listTenantConfiguration(client, org.organizationId))).find((row) => row.key === retention.key);
      assert.deepEqual(entry.scheduled.map((row) => row.value), [72]);
      await assert.rejects(tx((client) => setTenantConfiguration(client, admin, { ...retention, value: 12 })), expectCode("CONFIGURATION_SCHEDULE_CONFLICT"));
      await tx((client) => cancelScheduledConfiguration(client, admin, { ...retention, version: scheduled.version }));
      assert.equal(await tx((client) => getConfigurationValue(client, org.organizationId, retention.namespace, retention.key, new Date(Date.now() + 8 * 86400_000))), 48, "the current version is open-ended again");
      const versions = (await kit.owner.query(`SELECT version, status FROM configuration_versions WHERE organization_id=$1 AND config_key=$2 ORDER BY version`, [org.organizationId, retention.key])).rows;
      assert.deepEqual(versions.map((row) => row.status), ["active", "cancelled"], "history is kept");
    });

    await t.test("concurrent writes serialize to distinct versions", async () => {
      const results = await Promise.allSettled([1, 2, 3].map((hours) => tx((client) => setTenantConfiguration(client, admin, { ...retention, value: hours }))));
      const accepted = results.filter((result) => result.status === "fulfilled").map((result) => result.value.version);
      assert.ok(accepted.length >= 1);
      assert.equal(new Set(accepted).size, accepted.length);
      const open = await kit.owner.query(`SELECT count(*)::int AS n FROM configuration_versions WHERE organization_id=$1 AND config_key=$2 AND status='active' AND effective_to IS NULL`, [org.organizationId, retention.key]);
      assert.equal(open.rows[0].n, 1, "exactly one open-ended version");
    });

    await t.test("operator flags are not tenant-writable or tenant-visible", async () => {
      await assert.rejects(tx((client) => setTenantConfiguration(client, admin, { namespace: "operator.webhooks", key: "delivery_paused", value: true })), expectCode("CONFIGURATION_OPERATOR_ONLY"));
      await tx((client) => setOperatorConfiguration(client, admin, { namespace: "operator.webhooks", key: "delivery_paused", value: true }));
      assert.equal(await tx((client) => isFeatureFlagEnabled(client, org.organizationId, "operator.webhooks", "delivery_paused")), true);
      assert.ok(!(await tx((client) => listTenantConfiguration(client, org.organizationId))).some((entry) => entry.namespace.startsWith("operator.")));
    });
  } finally {
    await kit.close();
  }
});

test("privacy: FSM, versioned registered retention policies, honest enforcement", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin"]);
    const admin = org.session("admin", ["platform.privacy.manage"]);
    const tx = platformTx(kit);

    await t.test("requests follow the state machine and are audited", async () => {
      const request = await tx((client) => createPrivacyRequest(client, admin, { requestType: "erasure", subjectReference: "customer-42" }));
      await assert.rejects(tx((client) => transitionPrivacyRequest(client, admin, request.id, "completed")), (error) => error.status === 409);
      await tx((client) => transitionPrivacyRequest(client, admin, request.id, "verified"));
      await tx((client) => transitionPrivacyRequest(client, admin, request.id, "in_progress"));
      await tx((client) => transitionPrivacyRequest(client, admin, request.id, "completed"));
      await assert.rejects(tx((client) => transitionPrivacyRequest(client, admin, request.id, "cancelled")), (error) => error.status === 409);
      const events = (await kit.owner.query(`SELECT count(*)::int AS n FROM audit_events WHERE organization_id=$1 AND event_type LIKE 'privacy.request_%'`, [org.organizationId])).rows[0].n;
      assert.equal(events, 4);
    });

    await t.test("retention policies: registered classes only, versioned, never claiming automatic deletion falsely", async () => {
      await assert.rejects(tx((client) => writeRetentionPolicy(client, admin, { dataClass: "everything", retentionDays: 30, legalBasis: "x" })), expectCode("PRIVACY_DATA_CLASS_UNKNOWN"));
      await tx((client) => writeRetentionPolicy(client, admin, { dataClass: "accounting.financial_records", retentionDays: 30, legalBasis: "Statute" }));
      await tx((client) => writeRetentionPolicy(client, admin, { dataClass: "crm.personal_data", retentionDays: 365, legalBasis: "Consent", effectiveFrom: new Date(Date.now() - 1000).toISOString() }));
      await tx((client) => writeRetentionPolicy(client, admin, { dataClass: "crm.personal_data", retentionDays: 180, legalBasis: "Consent" }));
      const policies = await tx((client) => listRetentionPolicies(client, org.organizationId));
      const accounting = policies.find((policy) => policy.data_class === "accounting.financial_records");
      assert.equal(accounting.enforcement, "statutory_hold");
      const crm = policies.filter((policy) => policy.data_class === "crm.personal_data");
      assert.deepEqual(crm.map((policy) => policy.version), [2, 1]);
      assert.ok(crm.every((policy) => policy.enforcement === "review_required"));
    });

    await t.test("other organisations see nothing", async () => {
      const other = await kit.organization(["x"]);
      assert.deepEqual(await tx((client) => listRetentionPolicies(client, other.organizationId)), []);
    });
  } finally {
    await kit.close();
  }
});

test("AI governance: fail closed, registered tools only, approval before execution, prompts hashed", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin"]);
    const other = await kit.organization(["x"]);
    const admin = org.session("admin", ["platform.ai.manage"]);
    const tx = platformTx(kit);
    const request = (input) => tx((client) => recordAiRequest(client, admin, { policyKey: "organization", prompt: "Summarise Asha Rao's account balance", ...input }));

    await t.test("no policy means no AI", async () => {
      await assert.rejects(request({ requestType: "read" }), expectCode("AI_POLICY_MISSING"));
    });

    await t.test("a disabled policy blocks everything; an enabled one allows only what it says", async () => {
      await tx((client) => setAiPolicy(client, admin, { enabled: false, allowRead: true, allowPropose: true, allowExecute: true, requiresApproval: false, allowedTools: [], dataClasses: [] }));
      await assert.rejects(request({ requestType: "read" }), expectCode("AI_POLICY_DISABLED"));
      await tx((client) => setAiPolicy(client, admin, { enabled: true, allowRead: true, allowPropose: false, allowExecute: true, requiresApproval: true, allowedTools: [], dataClasses: ["crm.personal_data"] }));
      await request({ requestType: "read" });
      await assert.rejects(request({ requestType: "propose" }), (error) => error.status === 403);
      await assert.rejects(request({ requestType: "execute" }), expectCode("AI_APPROVAL_REQUIRED"));
      await assert.rejects(request({ requestType: "read", actionKey: "crm.write_ledger" }), expectCode("AI_TOOL_DENIED"));
      await assert.rejects(tx((client) => setAiPolicy(client, admin, { enabled: true, allowedTools: ["crm.anything"], dataClasses: [] })), expectCode("AI_TOOL_DENIED"));
      await assert.rejects(tx((client) => setAiPolicy(client, admin, { enabled: true, allowedTools: [], dataClasses: ["secrets"] })), expectCode("AI_DATA_CLASS_UNKNOWN"));
    });

    await t.test("the prompt itself is never stored; evidence is visible without it", async () => {
      const stored = (await kit.owner.query(`SELECT prompt_hash, context_manifest FROM ai_requests WHERE organization_id=$1`, [org.organizationId])).rows;
      assert.ok(stored.length >= 1);
      assert.ok(stored.every((row) => /^[0-9a-f]{64}$/.test(row.prompt_hash)));
      assert.ok(!JSON.stringify(stored).includes("Asha Rao"));
      const overview = await tx((client) => getAiGovernanceOverview(client, org.organizationId));
      assert.equal(overview.policy.version, 2);
      assert.deepEqual(overview.tools, [], "no AI tools are registered");
      assert.ok(!JSON.stringify(overview).includes("Asha Rao"));
      const otherOverview = await tx((client) => getAiGovernanceOverview(client, other.organizationId));
      assert.equal(otherOverview.policy, null);
      assert.deepEqual(otherOverview.requests, []);
    });
  } finally {
    await kit.close();
  }
});
