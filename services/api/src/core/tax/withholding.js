// TDS / withholding sections: the share of a supplier's bill (its taxable value) the buyer withholds and pays to the tax authority. Part of
// the shared tax set-up, managed with the tax rates; a supplier carries its usual section, and a bill may use another or none.
import { TAX_PERMISSIONS, TaxError, isUuid, requireTaxPermission, text } from "./constants.js";

const toSection = (row) => ({ id: row.id, code: row.code, name: row.name, rate: String(row.rate), status: row.status });

export async function listWithholdingSections(client, context, { includeInactive = false } = {}) {
  const { rows } = await client.query(`SELECT * FROM tenant.withholding_tax_sections WHERE organization_id = $1${includeInactive ? "" : " AND status = 'active'"} ORDER BY code`, [context.organizationId]);
  return rows.map(toSection);
}

// input: { code, name, rate, status? }
export async function saveWithholdingSection(client, context, sectionId, input = {}) {
  requireTaxPermission(context, TAX_PERMISSIONS.manageRates, "You do not have permission to manage TDS sections.");
  const code = text(input.code, 20);
  const name = text(input.name, 200);
  const rate = String(input.rate ?? "").trim();
  if (!code) throw new TaxError(400, "Enter the section code (for example 194C).", "WITHHOLDING_CODE_REQUIRED");
  if (!name) throw new TaxError(400, "Describe the section.", "WITHHOLDING_NAME_REQUIRED");
  if (!/^\d{1,3}(?:\.\d{1,4})?$/.test(rate) || Number(rate) > 100) throw new TaxError(400, "Enter the rate as a percentage between 0 and 100.", "WITHHOLDING_RATE_INVALID");
  const status = input.status === "inactive" ? "inactive" : "active";
  try {
    if (sectionId) {
      if (!isUuid(sectionId)) throw new TaxError(404, "TDS section not found.", "WITHHOLDING_NOT_FOUND");
      const row = (await client.query(`UPDATE tenant.withholding_tax_sections SET code = $3, name = $4, rate = $5, status = $6, updated_at = now() WHERE organization_id = $1 AND id = $2 RETURNING *`,
        [context.organizationId, sectionId, code, name, rate, status])).rows[0];
      if (!row) throw new TaxError(404, "TDS section not found.", "WITHHOLDING_NOT_FOUND");
      return toSection(row);
    }
    return toSection((await client.query(`INSERT INTO tenant.withholding_tax_sections (organization_id, code, name, rate, status, created_by) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [context.organizationId, code, name, rate, status, context.userId ?? null])).rows[0]);
  } catch (error) {
    if (error.code === "23505") throw new TaxError(409, `A TDS section ${code} already exists.`, "WITHHOLDING_DUPLICATE");
    throw error;
  }
}
