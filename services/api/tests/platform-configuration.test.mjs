import assert from "node:assert/strict";
import test from "node:test";

import {
  CONFIGURATION_DEFINITIONS,
  getConfigurationValue,
  listTenantConfiguration,
  setOperatorConfiguration,
  setTenantConfiguration,
} from "../src/core/platform/configuration/index.js";

const SESSION = { organizationId: "org-1", userId: "user-1" };
const code = (expected) => (error) => error.code === expected;

function recordingClient(extra = () => null) {
  const calls = [];
  return {
    calls,
    async query(sql, values) {
      calls.push({ sql, values });
      const answer = extra(sql, values);
      if (answer) return answer;
      if (/COALESCE\(max\(version\),0\)\+1/.test(sql)) return { rows: [{ v: 1 }] };
      if (/INSERT INTO configuration_versions/.test(sql)) return { rows: [{ id: "c1", version: 1, effective_from: new Date() }] };
      return { rows: [] };
    },
  };
}

test("writes are serialized with an advisory lock keyed to the organisation and key", async () => {
  const client = recordingClient();
  await setTenantConfiguration(client, SESSION, { namespace: "platform.exports", key: "artifact_retention_hours", value: 48 });
  const lock = client.calls.find(({ sql }) => /pg_advisory_xact_lock/.test(sql));
  assert.deepEqual(lock.values, ["org-1", "configuration:platform.exports:artifact_retention_hours"]);
  assert.ok(client.calls.some(({ sql }) => /INSERT INTO audit_events/.test(sql)), "every version is audited");
});

test("only registered keys, only tenant keys from tenant writes, only valid values", async () => {
  await assert.rejects(setTenantConfiguration(recordingClient(), SESSION, { namespace: "crm", key: "anything", value: 1 }), code("CONFIGURATION_KEY_UNKNOWN"));
  await assert.rejects(setTenantConfiguration(recordingClient(), SESSION, { namespace: "operator.webhooks", key: "delivery_paused", value: true }), code("CONFIGURATION_OPERATOR_ONLY"));
  await assert.rejects(setTenantConfiguration(recordingClient(), SESSION, { namespace: "platform.exports", key: "artifact_retention_hours", value: 1000 }), code("CONFIGURATION_VALUE_INVALID"));
  await assert.rejects(setTenantConfiguration(recordingClient(), SESSION, { namespace: "platform.workflows", key: "enabled", value: "yes" }), code("CONFIGURATION_VALUE_INVALID"));
  await assert.rejects(setOperatorConfiguration(recordingClient(), SESSION, { namespace: "platform.exports", key: "artifact_retention_hours", value: 5 }), code("CONFIGURATION_OPERATOR_ONLY"));
});

test("a change that starts before an existing scheduled one is refused", async () => {
  const client = recordingClient((sql) => (/effective_from >= \$4 LIMIT 1/.test(sql) ? { rows: [{ "?column?": 1 }] } : null));
  await assert.rejects(setTenantConfiguration(client, SESSION, { namespace: "platform.exports", key: "artifact_retention_hours", value: 12 }), code("CONFIGURATION_SCHEDULE_CONFLICT"));
});

test("reads fall back to the registered default, and a corrupted stored value never escapes validation", async () => {
  assert.equal(await getConfigurationValue(recordingClient(), "org-1", "platform.exports", "artifact_retention_hours"), 24);
  const corrupted = recordingClient((sql) => (/SELECT value, version/.test(sql) ? { rows: [{ value: 99999 }] } : null));
  assert.equal(await getConfigurationValue(corrupted, "org-1", "platform.exports", "artifact_retention_hours"), 24);
});

test("the tenant view never lists operator flags; every key is described and consumed", async () => {
  const entries = await listTenantConfiguration(recordingClient(), "org-1");
  assert.ok(entries.length > 0);
  assert.ok(entries.every((entry) => !entry.namespace.startsWith("operator.")));
  for (const definition of CONFIGURATION_DEFINITIONS) assert.ok(definition.label && definition.description && definition.consumedBy && definition.validate, definition.key);
});
