// F276 -- customer search-select. Reuses tenant.business_parties (the same
// authoritative customer master setPosCartCustomer/completePointOfSale
// already validate against) through a bounded, server-side search rather
// than forking a second customer record or trusting a cashier-typed UUID.
// Selects only fields safe for a cashier to see (no gstin/pan/credit_limit/
// msme_number) -- the checkout screen needs a name to recognize, not a
// customer's financial/compliance profile.
function requirePermission(context, permission) {
  if (!context.roleSlugs?.includes("organization_owner") && !context.permissions?.includes(permission)) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

const MAX_LIMIT = 25;
const MAX_TERM_LENGTH = 100;

export async function searchPointOfSaleCustomers(client, context, input = {}) {
  requirePermission(context, "pos.view");
  const term = String(input.query || "").trim().slice(0, MAX_TERM_LENGTH);
  const limit = Math.min(Math.max(Number(input.limit) || 20, 1), MAX_LIMIT);
  const offset = Math.max(Number(input.offset) || 0, 0);

  const values = [context.organizationId, context.companyId];
  let filter = "";
  if (term) {
    values.push(`%${term.toLowerCase()}%`);
    filter = ` AND (lower(display_name) LIKE $${values.length} OR lower(code) LIKE $${values.length} OR phone LIKE $${values.length} OR lower(email) LIKE $${values.length})`;
  }
  values.push(limit, offset);

  const result = await client.query(
    `SELECT id,code,display_name,phone,email
       FROM tenant.business_parties
      WHERE organization_id=$1 AND (company_id IS NULL OR company_id=$2)
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
