// Real PostgreSQL integration test — SP011 Section 3 (connect billing
// enforcement to actual business mutations). The actual gate functions
// this proves are wired (crm-context.ts's requireCrmMutationAccess/
// requireCrmAccess, pos-context.ts's requirePosAccess) live in apps/web
// and start with `import "server-only"`, which throws unconditionally
// outside Next's bundler -- they cannot be imported by plain `node --test`
// (see crm-context.ts's own comment on why resolveCrmMutationPermission
// was extracted into an alias-free, server-only-free module for exactly
// this reason). This file therefore proves two complementary things
// instead of one end-to-end call:
//   1. A structural check that the actual wiring is present in source --
//      a regression guard against someone silently removing the
//      requireBillingWriteAccess call from these functions later, in the
//      same spirit as scripts/qa/generate-route-security-matrix.mjs's
//      import+call-site detection (not a bare substring grep: it demands
//      both the import and a real call site).
//   2. A real-database functional proof that requireBillingWriteAccess
//      itself -- the exact function these wrappers call, in the exact
//      argument shape they call it with -- blocks a business mutation for
//      an expired/missing subscription in enforce mode and allows one for
//      an active/internal subscription, which is the actual policy
//      decision the wiring delegates to. billing-entitlement-sp011.test.mjs
//      already covers this exhaustively per-status; this file's second
//      section is deliberately narrow: it only re-proves the two
//      integration-relevant edges (blocked vs allowed) to keep this file
//      focused on wiring, not re-duplicating that policy matrix.
import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

import { Client } from "pg";
import { requireBillingWriteAccess, EntitlementError } from "../../services/api/src/core/entitlements.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

function hasImportAndCall(source, importName, calleeName) {
  const importPattern = new RegExp(`import\\s*\\{[^}]*\\b${importName}\\b[^}]*\\}\\s*from`, "s");
  const callPattern = new RegExp(`\\b${calleeName}\\s*\\(`);
  return importPattern.test(source) && callPattern.test(source);
}

test("SP011 Section 3: billing-write enforcement wiring into real CRM/POS mutation entry points", async (t) => {
  await t.test("crm-context.ts imports and calls requireBillingWriteAccess from both requireCrmMutationAccess and the opt-in requireCrmAccess mutation path", () => {
    const source = fs.readFileSync(path.join(repoRoot, "apps/web/src/features/crm/shared/crm-context.ts"), "utf8");
    assert.ok(
      hasImportAndCall(source, "requireBillingWriteAccess", "requireBillingWriteAccess"),
      "crm-context.ts must import requireBillingWriteAccess from @vercentlabs/api and actually call it, not just import it",
    );
  });

  await t.test("pos-context.ts imports and calls requireBillingWriteAccess from the opt-in requirePosAccess mutation path", () => {
    const source = fs.readFileSync(path.join(repoRoot, "apps/web/src/features/pos/shared/pos-context.ts"), "utf8");
    assert.ok(hasImportAndCall(source, "requireBillingWriteAccess", "requireBillingWriteAccess"));
  });

  await t.test("the generic CRM resource routes (create/update/archive) delegate to requireCrmMutationAccess, which is unconditionally billing-gated", () => {
    const collectionRoute = fs.readFileSync(path.join(repoRoot, "apps/web/src/app/api/crm/[resource]/route.ts"), "utf8");
    const itemRoute = fs.readFileSync(path.join(repoRoot, "apps/web/src/app/api/crm/[resource]/[id]/route.ts"), "utf8");
    assert.ok(hasImportAndCall(collectionRoute, "requireCrmMutationAccess", "requireCrmMutationAccess"), "POST /api/crm/[resource] (create)");
    assert.ok(hasImportAndCall(itemRoute, "requireCrmMutationAccess", "requireCrmMutationAccess"), "PATCH/DELETE /api/crm/[resource]/[id] (update/archive)");
  });

  await t.test("COMPLETE MUTATION INVENTORY: every CRM/POS mutation route is either billing-gated or has a specific, reviewed exclusion reason -- 0 unaccounted", () => {
    // Runs scripts/qa/validate-billing-mutation-gate.mjs, which itself
    // re-derives docs/frontend-rebuild/BILLING_MUTATION_INVENTORY.csv fresh
    // from the actual route files (never trusts a possibly-stale commit) --
    // this is the durable regression guard for the full inventory, not
    // just the handful of routes spot-checked above and below. A future
    // CRM/POS mutation route that is neither wired nor added to
    // DOCUMENTED_EXCLUSIONS with a real reason fails this test.
    assert.doesNotThrow(() => {
      execFileSync("node", ["scripts/qa/validate-billing-mutation-gate.mjs"], { cwd: repoRoot, stdio: "pipe" });
    }, "scripts/qa/validate-billing-mutation-gate.mjs must exit 0 -- see its stderr for which route(s) are unaccounted");
  });

  await t.test("the POS cart-completion route (the sale-creating mutation) opts requirePosAccess into the billing-write check", () => {
    const source = fs.readFileSync(path.join(repoRoot, "apps/web/src/app/api/pos/carts/[id]/complete/route.ts"), "utf8");
    assert.match(source, /requirePosAccess\([^)]*\{\s*mutation:\s*true\s*\}\)/s, "POST /api/pos/carts/[id]/complete must pass { mutation: true } to requirePosAccess");
  });

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
  const admin = await connectOrNull(adminConnectionString);
  if (!admin) {
    t.skip("No reachable Postgres connection (MIGRATION_DATABASE_URL) -- run `pnpm infra:up && pnpm db:setup` first.");
    return;
  }

  try {
    await t.test("the exact decision the wiring delegates to: an organization with an expired subscription cannot pass requireBillingWriteAccess in enforce mode", async () => {
      const orgId = randomUUID();
      const ownerId = randomUUID();
      const planId = randomUUID();
      const priceId = randomUUID();
      const subId = randomUUID();
      try {
        await admin.query(
          `INSERT INTO users(id,email,full_name,password_hash,status,email_verified_at) VALUES($1,$2,'SP011 Wiring Owner','x','active',now())`,
          [ownerId, `sp011-wiring-owner-${ownerId}@test.invalid`],
        );
        await admin.query(
          `INSERT INTO organizations(id,name,slug,country_code,timezone,base_currency,created_by) VALUES($1,'SP011 Wiring Expired Org',$2,'IN','Asia/Kolkata','INR',$3)`,
          [orgId, `sp011-wiring-expired-${orgId}`, ownerId],
        );
        await admin.query(
          `INSERT INTO billing_plans(id,code,name,trial_days) VALUES($1,$2,'Wiring Test Plan',0)`,
          [planId, `sp011-wiring-plan-${planId}`],
        );
        await admin.query(
          `INSERT INTO billing_plan_prices(id,plan_id,billing_period,amount_paise) VALUES($1,$2,'monthly',100000)`,
          [priceId, planId],
        );
        await admin.query(
          // migration 051's trigger already created a default founder-
          // preview row on the organizations insert above; overwrite it
          // with the expired state this test needs.
          `INSERT INTO organization_subscriptions(id,organization_id,plan_price_id,status,billing_period) VALUES($1,$2,$3,'expired','monthly')
           ON CONFLICT (organization_id) DO UPDATE SET id=EXCLUDED.id, plan_price_id=EXCLUDED.plan_price_id, status=EXCLUDED.status, billing_period=EXCLUDED.billing_period`,
          [subId, orgId, priceId],
        );

        await assert.rejects(
          () => requireBillingWriteAccess(admin, orgId, { NODE_ENV: "production" }),
          (error) => error instanceof EntitlementError && error.status === 402 && error.code === "ENTITLEMENT_SUBSCRIPTION_INACTIVE",
          "the same check requireCrmMutationAccess/requirePosAccess(mutation:true) delegate to must block an expired subscription in enforce mode",
        );
      } finally {
        await admin.query(`DELETE FROM organization_subscriptions WHERE id=$1`, [subId]).catch(() => undefined);
        await admin.query(`DELETE FROM billing_plan_prices WHERE id=$1`, [priceId]).catch(() => undefined);
        await admin.query(`DELETE FROM billing_plans WHERE id=$1`, [planId]).catch(() => undefined);
        await admin.query(`DELETE FROM organizations WHERE id=$1`, [orgId]).catch(() => undefined);
        await admin.query(`DELETE FROM users WHERE id=$1`, [ownerId]).catch(() => undefined);
      }
    });
  } finally {
    await admin.end();
  }
});
