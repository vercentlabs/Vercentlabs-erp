import assert from "node:assert/strict";
import test from "node:test";

import { setFeatureFlag, isFeatureFlagEnabled, writeConfigurationVersion, ConfigurationError } from "../src/core/configuration.js";

test("setFeatureFlag serializes writes with an advisory transaction lock keyed to the organisation+flag", async () => {
  let lockCall;
  const client = {
    query: async (sql, values) => {
      if (/pg_advisory_xact_lock/.test(sql)) {
        lockCall = values;
        return { rows: [] };
      }
      if (/SELECT version FROM feature_flags/.test(sql)) return { rows: [] };
      if (/SELECT 1 FROM feature_flags/.test(sql)) return { rows: [] };
      if (/INSERT INTO feature_flags/.test(sql)) return { rows: [{ id: "flag-1", version: 1 }] };
      return { rows: [] };
    },
  };
  await setFeatureFlag(client, { organizationId: "org-1", userId: "user-1" }, { key: "new-nav", enabled: true });
  assert.deepEqual(lockCall, ["org-1", "feature-flag:new-nav"]);
});

test("setFeatureFlag rejects an end timestamp that is not after the start", async () => {
  const client = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    setFeatureFlag(client, { organizationId: "org-1", userId: "user-1" }, {
      key: "bad-window",
      enabled: true,
      effectiveFrom: "2026-01-01T00:00:00Z",
      effectiveTo: "2025-01-01T00:00:00Z",
    }),
    (error) => error instanceof ConfigurationError && error.status === 400,
  );
});

test("isFeatureFlagEnabled requires role/user rule membership when rules are present, and is disabled with no active version", async () => {
  const client = {
    query: async () => ({
      rows: [{ enabled: true, rules: { roles: ["sales_manager"] } }],
    }),
  };
  assert.equal(await isFeatureFlagEnabled(client, "org-1", "beta-nav", { roleSlugs: ["employee"] }), false);
  assert.equal(await isFeatureFlagEnabled(client, "org-1", "beta-nav", { roleSlugs: ["sales_manager"] }), true);

  const noFlagClient = { query: async () => ({ rows: [] }) };
  assert.equal(await isFeatureFlagEnabled(noFlagClient, "org-1", "nonexistent"), false);
});

test("writeConfigurationVersion refuses to schedule a version at/after an already-scheduled one (ordering integrity)", async () => {
  const client = {
    query: async (sql) => {
      if (/pg_advisory_xact_lock/.test(sql)) return { rows: [] };
      if (/COALESCE\(max\(version\),0\)/.test(sql)) return { rows: [{ next_version: 2 }] };
      if (/SELECT 1 FROM configuration_versions/.test(sql)) return { rows: [{}] }; // a later version already exists
      return { rows: [] };
    },
  };
  await assert.rejects(
    writeConfigurationVersion(client, { organizationId: "org-1", userId: "user-1" }, {
      namespace: "crm",
      key: "lead-sla-hours",
      value: 24,
    }),
    (error) => error instanceof ConfigurationError && error.status === 409,
  );
});
