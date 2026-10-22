// What every app needs for its first record, added when a workspace is created: a "General" product category, the default payment
// term for Sales and Purchase, project types and four asset categories (tenant.seed_starter_data, migration 0216_every_app_alone, which also filled in existing workspaces).
// Nobody is sent to Settings before they can make the first product, order, project or asset. The standard TDS sections (194C, 194J,
// 194I, 194H, 194Q) come with them (tenant.seed_tds_sections, migration 0221_procurement_plan), so a purchase bill can withhold from day one; purchase indents and RFQs start on.
export async function seedStarterData(client, { organizationId, userId }) {
  await client.query(`SELECT tenant.seed_starter_data($1, $2)`, [organizationId, userId ?? null]);
  await client.query(`SELECT tenant.seed_tds_sections($1, $2)`, [organizationId, userId ?? null]);
  // A new company starts with purchase indents and RFQs on (Procurement plan Phase 2); existing ones keep them off until they turn them on.
  await client.query(`INSERT INTO tenant.procurement_settings (organization_id, use_indents, use_rfqs) VALUES ($1, true, true)
                      ON CONFLICT (organization_id) DO UPDATE SET use_indents = true, use_rfqs = true`, [organizationId]);
}
