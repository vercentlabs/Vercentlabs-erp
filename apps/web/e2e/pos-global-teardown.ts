import fs from "node:fs";
import path from "node:path";
import { Client } from "pg";

import { MIGRATION_DATABASE_URL } from "./pos-fixtures";

// Runs once after the whole `playwright test` invocation finishes,
// regardless of which spec files matched the run (or whether they passed),
// and is a no-op if no POS spec ever seeded a world in this run. Cleans up
// precisely the rows apps/web/e2e/pos-fixtures.ts created, by id -- never
// by organization_id, since the org itself (`CRM E2E Fixture Org`) is
// shared, real, and outlives this suite.
export default async function globalTeardown() {
  const markerPath = path.resolve(process.cwd(), "e2e/.pos-world.json");
  if (!fs.existsSync(markerPath)) return;

  const marker = JSON.parse(fs.readFileSync(markerPath, "utf8")) as {
    world: { organizationId: string };
    cleanup: {
      storeIds: string[];
      warehouseId: string;
      taxCategoryId: string;
      taxRateId: string;
      priceListId: string;
      itemId: string;
      customerId: string;
      userIds: string[];
    };
  };
  const { organizationId } = marker.world;
  const { storeIds, warehouseId, taxCategoryId, taxRateId, priceListId, itemId, customerId, userIds } = marker.cleanup;

  const client = new Client({ connectionString: MIGRATION_DATABASE_URL });
  await client.connect();
  // A bare try/catch around a single statement inside a transaction only
  // swallows the JS-level rejection -- Postgres still marks the whole
  // transaction aborted, so every later statement (including COMMIT) fails
  // too. A real per-statement SAVEPOINT is required to make one delete's
  // failure (e.g. an FK held by a permanently-retained row, see the
  // day-end-report note below) not poison the rest of this cleanup.
  async function tryDelete(sql: string, params: unknown[]) {
    await client.query("SAVEPOINT tear");
    try {
      await client.query(sql, params);
      await client.query("RELEASE SAVEPOINT tear");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT tear");
      console.warn("[pos-global-teardown] best-effort delete skipped:", error instanceof Error ? error.message : error);
    }
  }
  try {
    const { setTenantContext } = await import("../../../packages/database/src/index.js");
    await client.query("BEGIN");
    await setTenantContext(client, organizationId);
    // pos_receipt_print_events (migration 129) and pos_return_payment_refunds
    // (migration 130) are deliberately immutable in production (a
    // BEFORE UPDATE OR DELETE trigger that raises) -- correct there, but it
    // also blocks this script's own test-data cleanup. SET LOCAL scopes
    // the bypass to this transaction only, using the exact standard
    // Postgres mechanism for administrative bulk operations that must
    // skip row-level triggers without weakening what the trigger protects
    // against for a normal application caller (this connection uses
    // MIGRATION_DATABASE_URL, an elevated role, not the app's own
    // runtime role).
    await client.query("SET LOCAL session_replication_role = replica");

    await client.query(`DELETE FROM tenant.operation_idempotency WHERE organization_id=$1 AND created_by = ANY($2::uuid[])`, [organizationId, userIds]);
    await client.query(
      `DELETE FROM tenant.pos_events WHERE organization_id=$1 AND aggregate_id IN (
         SELECT id FROM tenant.pos_carts WHERE store_id = ANY($2::uuid[])
         UNION SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[])
         UNION SELECT id FROM tenant.pos_shifts WHERE store_id = ANY($2::uuid[])
         UNION SELECT id FROM tenant.pos_returns WHERE sale_id IN (SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[]))
       )`,
      [organizationId, storeIds],
    );
    await client.query(`DELETE FROM tenant.pos_coupon_redemptions WHERE organization_id=$1 AND cart_id IN (SELECT id FROM tenant.pos_carts WHERE store_id = ANY($2::uuid[]))`, [
      organizationId,
      storeIds,
    ]);
    await client.query(
      `DELETE FROM tenant.pos_promotion_applications WHERE organization_id=$1 AND sale_id IN (SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[]))`,
      [organizationId, storeIds],
    );
    await client.query(
      `DELETE FROM tenant.pos_cart_discount_approvals WHERE organization_id=$1 AND cart_id IN (SELECT id FROM tenant.pos_carts WHERE store_id = ANY($2::uuid[]))`,
      [organizationId, storeIds],
    );
    await client.query(`DELETE FROM tenant.pos_cart_lines WHERE organization_id=$1 AND cart_id IN (SELECT id FROM tenant.pos_carts WHERE store_id = ANY($2::uuid[]))`, [
      organizationId,
      storeIds,
    ]);
    await client.query(`DELETE FROM tenant.pos_carts WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
    // Real bug found and fixed (POS Completion Program Prompt 2): both
    // pos_receipt_print_events (F289, migration 129) and
    // pos_return_payment_refunds (Gap B fix, migration 130) hard-FK onto
    // pos_sales/pos_returns and were added after this teardown script was
    // written -- left undeleted, they made this script fail outright with
    // a foreign-key violation the moment any spec printed a receipt or
    // completed a return, aborting cleanup for every row after them.
    await client.query(
      `DELETE FROM tenant.pos_receipt_print_events WHERE organization_id=$1 AND sale_id IN (SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[]))`,
      [organizationId, storeIds],
    );
    await client.query(
      `DELETE FROM tenant.pos_return_payment_refunds WHERE organization_id=$1 AND sale_id IN (SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[]))`,
      [organizationId, storeIds],
    );
    await client.query(
      `DELETE FROM tenant.pos_return_lines WHERE organization_id=$1 AND return_id IN (SELECT id FROM tenant.pos_returns WHERE sale_id IN (SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[])))`,
      [organizationId, storeIds],
    );
    await client.query(`DELETE FROM tenant.pos_returns WHERE organization_id=$1 AND sale_id IN (SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[]))`, [
      organizationId,
      storeIds,
    ]);
    await client.query(`DELETE FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id IN (SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[]))`, [
      organizationId,
      storeIds,
    ]);
    await client.query(`DELETE FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id IN (SELECT id FROM tenant.pos_sales WHERE store_id = ANY($2::uuid[]))`, [
      organizationId,
      storeIds,
    ]);
    await client.query(`DELETE FROM tenant.pos_cash_movements WHERE organization_id=$1 AND shift_id IN (SELECT id FROM tenant.pos_shifts WHERE store_id = ANY($2::uuid[]))`, [
      organizationId,
      storeIds,
    ]);
    await client.query(`DELETE FROM tenant.pos_sales WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
    // F303/F304 (day-end reports + reconciliation) both hard-FK onto
    // pos_shifts, so they must be torn down before it: corrections ->
    // reconciliations -> day-end reports, in that order. But a CLOSED
    // day-end report / a RESOLVED reconciliation is deliberately immutable
    // (tenant.pos_day_end_report_protect_closed() /
    // pos_reconciliation_protect_resolved(), migrations 121/127) -- real
    // audit-integrity protection, not a bug -- so once a spec (like
    // pos-visual-qa.spec.ts) actually closes one, its whole store/shift/
    // terminal chain becomes permanently undeletable by design, the same
    // way public.users below is disabled rather than deleted. A SAVEPOINT
    // scopes that expected failure to just this chain so it doesn't roll
    // back the rest of this transaction's otherwise-successful cleanup.
    await client.query("SAVEPOINT day_end_chain");
    try {
      await client.query(
        `DELETE FROM tenant.pos_reconciliation_corrections WHERE organization_id=$1 AND reconciliation_id IN (
           SELECT id FROM tenant.pos_reconciliations WHERE day_end_report_id IN (SELECT id FROM tenant.pos_day_end_reports WHERE store_id = ANY($2::uuid[]))
         )`,
        [organizationId, storeIds],
      );
      await client.query(
        `DELETE FROM tenant.pos_reconciliations WHERE organization_id=$1 AND day_end_report_id IN (SELECT id FROM tenant.pos_day_end_reports WHERE store_id = ANY($2::uuid[]))`,
        [organizationId, storeIds],
      );
      await client.query(`DELETE FROM tenant.pos_day_end_reports WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
      await client.query(`DELETE FROM tenant.pos_shifts WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
      await client.query(`DELETE FROM tenant.pos_store_access WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
      await client.query(`DELETE FROM tenant.pos_terminals WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
      await client.query(`DELETE FROM tenant.pos_stores WHERE organization_id=$1 AND id = ANY($2::uuid[])`, [organizationId, storeIds]);
      await client.query("RELEASE SAVEPOINT day_end_chain");
    } catch (error) {
      await client.query("ROLLBACK TO SAVEPOINT day_end_chain");
      console.warn(
        "[pos-global-teardown] this run closed a day-end report / resolved a reconciliation -- its store/shift/terminal chain is permanently retained by design:",
        error instanceof Error ? error.message : error,
      );
    }
    // From here on, every statement is defensively best-effort (tryDelete):
    // a surviving pos_stores row from the day_end_chain rollback above
    // still holds its own FK onto warehouse_id/price_list_id, which would
    // otherwise turn one retained store into a hard failure for these
    // shared (all-stores) fixture rows too.
    await tryDelete(`DELETE FROM tenant.price_list_items WHERE organization_id=$1 AND item_id=$2`, [organizationId, itemId]);
    await tryDelete(`DELETE FROM tenant.stock_valuation_layers WHERE organization_id=$1 AND item_id=$2`, [organizationId, itemId]);
    await tryDelete(`DELETE FROM tenant.stock_movements WHERE organization_id=$1 AND item_id=$2`, [organizationId, itemId]);
    await tryDelete(`DELETE FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2`, [organizationId, itemId]);
    await tryDelete(`DELETE FROM tenant.items WHERE organization_id=$1 AND id=$2`, [organizationId, itemId]);
    await tryDelete(`DELETE FROM tenant.price_lists WHERE organization_id=$1 AND id=$2`, [organizationId, priceListId]);
    await tryDelete(`DELETE FROM tenant.tax_rates WHERE organization_id=$1 AND id=$2`, [organizationId, taxRateId]);
    await tryDelete(`DELETE FROM tenant.tax_categories WHERE organization_id=$1 AND id=$2`, [organizationId, taxCategoryId]);
    await tryDelete(`DELETE FROM tenant.warehouses WHERE organization_id=$1 AND id=$2`, [organizationId, warehouseId]);
    await tryDelete(`DELETE FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [organizationId, customerId]);

    await client.query("COMMIT");

    // Approval requests live in public schema, outside tenant RLS scope,
    // and every persona this suite created is brand new -- deleting all of
    // their approval activity is unambiguously safe.
    await client.query(`DELETE FROM public.approval_requests WHERE organization_id=$1 AND requested_by = ANY($2::uuid[])`, [organizationId, userIds]);
    await client.query(`DELETE FROM membership_branch_access WHERE organization_id=$1 AND user_id = ANY($2::uuid[])`, [organizationId, userIds]);
    await client.query(`DELETE FROM membership_company_access WHERE organization_id=$1 AND user_id = ANY($2::uuid[])`, [organizationId, userIds]);
    await client.query(`DELETE FROM public.user_role_assignments WHERE organization_id=$1 AND user_id = ANY($2::uuid[])`, [organizationId, userIds]);
    await client.query(`DELETE FROM organization_memberships WHERE organization_id=$1 AND user_id = ANY($2::uuid[])`, [organizationId, userIds]);
    await client.query(`DELETE FROM sessions WHERE user_id = ANY($1::uuid[])`, [userIds]);
    // NOT deleted: public.users rows for the 3 personas. Real login events
    // this run created wrote public.audit_events rows with actor_user_id
    // pointing at them, and audit_events is enforced immutable at the DB
    // level (prevent_audit_event_mutation() blocks even the ON DELETE
    // SET NULL a `DELETE FROM users` would trigger) -- by design, an audit
    // trail can't be scrubbed just because the actor was a test fixture.
    // Deactivating instead is the correct real-world equivalent of
    // deleting a test user: their unique, run-suffixed email can never be
    // reused, and 'disabled' status (users_status_check: active/disabled/
    // suspended) already fails every login/permission check the same way
    // a deleted user would.
    await client.query(`UPDATE public.users SET status='disabled' WHERE id = ANY($1::uuid[])`, [userIds]);
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    console.error("[pos-global-teardown] cleanup failed, POS E2E fixture rows may remain:", error);
  } finally {
    await client.end();
    fs.rmSync(markerPath, { force: true });
  }
}
