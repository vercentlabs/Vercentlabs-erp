// F276 -- customer search-select. Reuses tenant.business_parties (the same
// authoritative customer master setPosCartCustomer/completePointOfSale
// already validate against) through a bounded, server-side search rather
// than forking a second customer record or trusting a cashier-typed UUID.
// Selects only fields safe for a cashier to see (no gstin/pan/credit_limit/
// msme_number) -- the checkout screen needs a name to recognize, not a
// customer's financial/compliance profile.
import { assertPosStoreAccess, requirePermission } from "../shared/access-control.js";
import { posError } from "../shared/errors.js";
import { assertPosAction } from "../permissions/index.js";
import { createCustomer } from "../../sales/customers/records.js";

const MAX_LIMIT = 25;
const MAX_TERM_LENGTH = 100;

export async function searchPointOfSaleCustomers(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const term = String(input.query || "").trim().slice(0, MAX_TERM_LENGTH);
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), MAX_LIMIT);
  const offset = Math.max(Number(input.offset) || 0, 0);

  const values = [context.organizationId];
  let filter = "";
  if (term) {
    values.push(`%${term.toLowerCase()}%`);
    filter = ` AND (lower(display_name) LIKE $${values.length} OR lower(code) LIKE $${values.length} OR phone LIKE $${values.length} OR lower(email) LIKE $${values.length})`;
  }
  values.push(limit, offset);

  const result = await client.query(
    `SELECT id,code,display_name,phone,email
       FROM tenant.business_parties
      WHERE organization_id=$1
        AND party_type IN ('customer','both') AND status='active'${filter}
      ORDER BY display_name
      LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );

  return result.rows.map((row) => ({
    id: row.id,
    code: row.code,
    displayName: row.display_name,
    phone: row.phone,
    email: row.email,
  }));
}

// A customer created at the counter (CUSTOMER_QUICK_CREATE) — through the shared Customer Master's own create, with its validation and
// duplicate check, never a separate POS customer list. A walk-in sale needs no customer at all. input: name, phone, email, gstin, cartId (the
// bill it is for, which decides the outlet).
export async function quickCreatePosCustomer(client, context, input = {}) {
  requirePermission(context, "pos.view");
  let outletId = null;
  let currencyCode = null;
  if (input.cartId) {
    const cart = (await client.query(`SELECT store_id, currency_code FROM tenant.pos_carts WHERE organization_id=$1 AND id=$2`, [context.organizationId, input.cartId])).rows[0];
    if (!cart) throw posError(404, "POS cart was not found.", "POS_CART_NOT_FOUND");
    outletId = cart.store_id;
    currencyCode = cart.currency_code;
  } else {
    const session = (await client.query(
      `SELECT shift.store_id, store.currency_code FROM tenant.pos_shifts shift JOIN tenant.pos_stores store ON store.organization_id = shift.organization_id AND store.id = shift.store_id
        WHERE shift.organization_id=$1 AND shift.cashier_user_id=$2 AND shift.status='open' LIMIT 1`, [context.organizationId, context.userId])).rows[0];
    if (!session) throw posError(409, "Open a POS session to continue.", "POS_SESSION_REQUIRED");
    outletId = session.store_id;
    currencyCode = session.currency_code;
  }
  await assertPosStoreAccess(client, context, outletId);
  await assertPosAction(client, context, { permission: "CUSTOMER_QUICK_CREATE", outletId });
  const name = String(input.name ?? "").trim();
  if (!name) {
    const error = posError(400, "Enter the customer's name.", "VALIDATION_FAILED");
    error.details = { issues: [{ field: "name", message: "Enter the customer's name." }] };
    throw error;
  }
  const gstin = String(input.gstin ?? "").trim().toUpperCase() || null;
  const created = await createCustomer(client, { ...context, permissions: [...new Set([...(context.permissions ?? []), "sales.customers.create", "sales.customers.view"])] }, {
    displayName: name, customerKind: gstin ? "business" : "individual", phone: String(input.phone ?? "").trim() || null, email: String(input.email ?? "").trim() || null,
    gstin, gstRegistrationType: gstin ? "registered_regular" : "consumer", countryCode: "IN", currencyCode: String(currencyCode ?? "INR").trim(),
  });
  return { id: created.id, code: created.code ?? null, displayName: created.displayName ?? name, phone: created.phone ?? null, email: created.email ?? null };
}
