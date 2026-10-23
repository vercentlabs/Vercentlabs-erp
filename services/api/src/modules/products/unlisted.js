// The "Unlisted item" (Create-Where-You-Are): one system item per company that a line which is just a description points at — a deal
// product, a quotation or order line, a POS open item — so every line keeps an item while the line itself carries the name, HSN/SAC,
// GST and price that were typed. A service without stock, neither sold nor bought from the catalogue, so no catalogue list, picker or
// price list offers it; reports show its lines as unlisted (the name on each line).
export const UNLISTED_ITEM_ROLE = "unlisted";

// Its id, created on first use (in the caller's transaction): the company's "Numbers" unit (or Each, else any unit).
export async function ensureUnlistedItem(client, organizationId) {
  const found = (await client.query("SELECT id FROM tenant.items WHERE organization_id = $1 AND system_role = $2", [organizationId, UNLISTED_ITEM_ROLE])).rows[0];
  if (found) return found.id;
  const uom = (await client.query(
    `SELECT id FROM tenant.units_of_measure WHERE organization_id = $1 AND status = 'active' ORDER BY (code = 'NOS') DESC, (code = 'EA') DESC, (code = 'PCS') DESC, code LIMIT 1`,
    [organizationId])).rows[0];
  if (!uom) throw Object.assign(new Error("Add a unit of measure (Products › Units) before adding a line without an item."), { status: 409, code: "UNLISTED_ITEM_NO_UNIT" });
  // A company's own item may already use the code: the next free one is taken.
  const taken = new Set((await client.query("SELECT code FROM tenant.items WHERE organization_id = $1 AND code LIKE 'UNLISTED%'", [organizationId])).rows.map((row) => row.code));
  let code = "UNLISTED";
  for (let suffix = 2; taken.has(code); suffix += 1) code = `UNLISTED-${suffix}`;
  const row = (await client.query(
    `INSERT INTO tenant.items (organization_id, code, name, item_type, uom_id, sales_uom_id, purchase_uom_id, track_inventory, is_sellable, is_purchasable, status, lifecycle_status,
                               system_role, description)
     VALUES ($1, $2, 'Unlisted item', 'service', $3, $3, $3, false, false, false, 'active', 'active', $4,
             'Stands in for a line typed without a catalogue item; the line keeps its own name, HSN/SAC and GST.')
     ON CONFLICT (organization_id, system_role) WHERE system_role IS NOT NULL DO NOTHING RETURNING id`,
    [organizationId, code, uom.id, UNLISTED_ITEM_ROLE])).rows[0];
  if (row) return row.id;
  return (await client.query("SELECT id FROM tenant.items WHERE organization_id = $1 AND system_role = $2", [organizationId, UNLISTED_ITEM_ROLE])).rows[0].id;
}

export async function isUnlistedItem(client, organizationId, itemId) {
  if (!itemId) return false;
  return Boolean((await client.query("SELECT 1 FROM tenant.items WHERE organization_id = $1 AND id = $2 AND system_role = $3", [organizationId, itemId, UNLISTED_ITEM_ROLE])).rows[0]);
}

// HSN (goods) or SAC (services): a SAC code is a 99… code.
export const hsnSacKindOf = (code) => (!code ? null : String(code).trim().startsWith("99") ? "sac" : "hsn");
