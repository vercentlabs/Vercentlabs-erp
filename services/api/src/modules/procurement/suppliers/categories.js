import { createHash } from "node:crypto";

import { SUPPLIER_CATEGORIES } from "./constants.js";

// Supplier categories are the managed list in Procurement Setup (tenant.procurement_categories). A company without any gets the eight
// usual ones the first time the list is read. Codes are matched without regard to case: suppliers saved before the list was managed
// carry the lowercase codes.
export async function listSupplierCategories(client, organizationId, { includeInactive = false } = {}) {
  await ensureSupplierCategories(client, organizationId);
  const { rows } = await client.query(
    `SELECT data->>'code' AS code, data->>'name' AS label, status FROM tenant.procurement_categories
      WHERE organization_id = $1 ${includeInactive ? "" : "AND status = 'active'"} ORDER BY data->>'name'`, [organizationId]);
  return rows.map(({ code, label }) => ({ code, label }));
}

export async function ensureSupplierCategories(client, organizationId, userId = null) {
  const existing = await client.query(`SELECT 1 FROM tenant.procurement_categories WHERE organization_id = $1 LIMIT 1`, [organizationId]);
  if (existing.rowCount) return;
  const actor = userId ?? (await client.query(
    `SELECT user_id FROM public.organization_memberships WHERE organization_id = $1 ORDER BY created_at LIMIT 1`, [organizationId])).rows[0]?.user_id;
  if (!actor) return;
  for (const { code, label } of SUPPLIER_CATEGORIES) {
    const data = { code: code.toUpperCase(), name: label };
    await client.query(
      `INSERT INTO tenant.procurement_categories (organization_id, status, search_text, data, content_hash, created_by, updated_by, idempotency_key)
       VALUES ($1, 'active', $2, $3::jsonb, $4, $5, $5, $6) ON CONFLICT DO NOTHING`,
      [organizationId, `${data.code} ${data.name}`, JSON.stringify(data), createHash("sha256").update(JSON.stringify(data)).digest("hex"), actor, `default-category:${code}`]);
  }
}

// The managed code a typed code or name stands for, or null.
export function matchSupplierCategory(categories, value) {
  const key = String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  if (!key) return null;
  return categories.find((entry) => [entry.code, entry.label].some((candidate) => String(candidate).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim() === key))?.code ?? null;
}
