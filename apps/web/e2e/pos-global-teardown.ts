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
  try {
    const { setTenantContext } = await import("../../../packages/database/src/index.js");
    await client.query("BEGIN");
    await setTenantContext(client, organizationId);

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
    await client.query(`DELETE FROM tenant.pos_shifts WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
    await client.query(`DELETE FROM tenant.pos_store_access WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
    await client.query(`DELETE FROM tenant.pos_terminals WHERE organization_id=$1 AND store_id = ANY($2::uuid[])`, [organizationId, storeIds]);
    await client.query(`DELETE FROM tenant.pos_stores WHERE organization_id=$1 AND id = ANY($2::uuid[])`, [organizationId, storeIds]);
    await client.query(`DELETE FROM tenant.price_list_items WHERE organization_id=$1 AND item_id=$2`, [organizationId, itemId]);
    await client.query(`DELETE FROM tenant.stock_valuation_layers WHERE organization_id=$1 AND item_id=$2`, [organizationId, itemId]).catch(() => undefined);
    await client.query(`DELETE FROM tenant.stock_movements WHERE organization_id=$1 AND item_id=$2`, [organizationId, itemId]).catch(() => undefined);
    await client.query(`DELETE FROM tenant.stock_balances WHERE organization_id=$1 AND item_id=$2`, [organizationId, itemId]);
    await client.query(`DELETE FROM tenant.items WHERE organization_id=$1 AND id=$2`, [organizationId, itemId]);
    await client.query(`DELETE FROM tenant.price_lists WHERE organization_id=$1 AND id=$2`, [organizationId, priceListId]);
    await client.query(`DELETE FROM tenant.tax_rates WHERE organization_id=$1 AND id=$2`, [organizationId, taxRateId]);
    await client.query(`DELETE FROM tenant.tax_categories WHERE organization_id=$1 AND id=$2`, [organizationId, taxCategoryId]);
    await client.query(`DELETE FROM tenant.warehouses WHERE organization_id=$1 AND id=$2`, [organizationId, warehouseId]);
    await client.query(`DELETE FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`, [organizationId, customerId]);

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
