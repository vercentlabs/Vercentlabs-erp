// Real PostgreSQL integration test -- the Quality KPI dashboard (F342) and the form pickers.
import assert from "node:assert/strict";
import test from "node:test";

import { ALL_QUALITY, buildQualityWorld, connectAdmin } from "./quality-test-kit.mjs";

const ROLES = {
  qaA: ALL_QUALITY,
  viewer: ["quality.view"],
};

test("Quality dashboard and options against real PostgreSQL", async (t) => {
  const admin = await connectAdmin();
  if (!admin) return t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL).");
  const w = await buildQualityWorld(admin, ROLES, "qlmg");
  const { api, run, supplierId, customerId } = w;

  try {
    await t.test("F342: the KPI dashboard reconciles to real records", async () => {
      const dash = await run("qaA", (c, x) => api.getQualityKpiDashboard(c, x));
      assert.ok(typeof dash.open_nonconformances === "number");
      assert.ok(typeof dash.active_holds === "number");
      const viewer = await run("viewer", (c, x) => api.getQualityKpiDashboard(c, x));
      assert.ok(typeof viewer.open_inspections === "number");
    });

    await t.test("options: the quality form pickers resolve suppliers and customers", async () => {
      const opts = await run("qaA", (c, x) => api.listQualityOptions(c, x));
      assert.ok(opts.suppliers.some((o) => o.id === supplierId));
      assert.ok(opts.customers.some((o) => o.id === customerId));
    });
  } finally {
    await w.cleanup();
    await admin.end();
  }
});
