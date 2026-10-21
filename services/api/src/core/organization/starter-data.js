// What every app needs for its first record, added when a workspace is created: a "General" product category, the default payment
// term for Sales and Purchase, project types and four asset categories (tenant.seed_starter_data, migration 0216_every_app_alone, which also filled in existing workspaces).
// Nobody is sent to Settings before they can make the first product, order, project or asset.
export async function seedStarterData(client, { organizationId, userId }) {
  await client.query(`SELECT tenant.seed_starter_data($1, $2)`, [organizationId, userId ?? null]);
}
