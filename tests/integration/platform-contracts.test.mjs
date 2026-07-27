import assert from "node:assert/strict";
import test from "node:test";

import { rowsToCsv } from "../../packages/reporting-engine/src/index.js";
import { ERP_MODULE_CATALOG } from "../../packages/shared-types/src/index.js";
import { createCommandRegistry } from "../../packages/workflows/src/index.js";

test("module, workflow and reporting contracts compose without app internals", async () => {
  assert.equal(ERP_MODULE_CATALOG.length, 12);
  assert.deepEqual(
    ERP_MODULE_CATALOG.filter((module) => module.availability === "released").map(
      (module) => module.key,
    ),
    ["accounting", "sales", "crm"],
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
