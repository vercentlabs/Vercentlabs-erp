import assert from "node:assert/strict";
import test from "node:test";

import { rowsToCsv } from "../../packages/reporting-engine/src/index.js";
import { ERP_MODULE_CATALOG } from "../../packages/shared-types/src/index.js";
import { createCommandRegistry } from "../../packages/workflows/src/index.js";

test("module, workflow and reporting contracts compose without app internals", async () => {
  assert.equal(ERP_MODULE_CATALOG.length, 12);
  // All 12 modules are marked availability: "released" as of this baseline
  // (see docs/implementation/ERP_WEB_AUDIT_001.md, Section 1). This
  // supersedes an earlier 4-module ("accounting", "procurement", "sales",
  // "crm") release-scope assertion that this test previously carried and
  // that is now stale against the current module catalogue.
  assert.deepEqual(
    ERP_MODULE_CATALOG.filter((module) => module.availability === "released").map(
      (module) => module.key,
    ).sort(),
    [
      "accounting",
      "assets",
      "crm",
      "hr-payroll",
      "manufacturing",
      "point-of-sale",
      "procurement",
      "projects",
      "quality",
      "sales",
      "stock",
      "support",
    ],
  );
  assert.deepEqual(
    ERP_MODULE_CATALOG.filter((module) => module.availability === "roadmap").map(
      (module) => module.key,
    ),
    [],
  );

  const registry = createCommandRegistry([
    {
      key: "crm.fixture.execute",
      validate: (payload) => ({ id: String(payload.id) }),
      execute: async (_context, payload) => ({ ...payload, completed: true }),
    },
  ]);
  const result = await registry.execute("crm.fixture.execute", {}, { id: 7 });
  assert.deepEqual(result, { id: "7", completed: true });

  const csv = rowsToCsv(
    [
      { key: "module", label: "Module" },
      { key: "value", label: "Value" },
    ],
    [{ module: "CRM", value: "=1+1" }],
  );
  assert.match(csv, /CRM,'=1\+1/);
});
