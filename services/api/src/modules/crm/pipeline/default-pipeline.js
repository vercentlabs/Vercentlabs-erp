// Every organization needs one sales pipeline before it can hold an
// opportunity. This creates the standard one the first time it is needed
// (lead conversion, the conversion dialog); administrators can change its
// stages afterwards. Idempotent: does nothing once any active pipeline exists.
const DEFAULT_STAGES = Object.freeze([
  { code: "DISCOVERY", name: "Discovery", probability: 10, forecastCategory: "pipeline" },
  { code: "NEEDS_ANALYSIS", name: "Needs Analysis", probability: 25, forecastCategory: "pipeline" },
  { code: "PROPOSAL", name: "Proposal", probability: 50, forecastCategory: "best_case" },
  { code: "NEGOTIATION", name: "Negotiation", probability: 75, forecastCategory: "committed" },
  { code: "CLOSING", name: "Closing", probability: 90, forecastCategory: "committed" },
  { code: "WON", name: "Closed Won", probability: 100, forecastCategory: "closed", isWon: true },
  { code: "LOST", name: "Closed Lost", probability: 0, forecastCategory: "closed", isLost: true },
]);

export async function ensureDefaultSalesPipeline(client, context) {
  const existing = await client.query(
    `SELECT 1 FROM tenant.crm_pipelines WHERE organization_id = $1 AND status = 'active' LIMIT 1`,
    [context.organizationId],
  );
  if (existing.rows[0]) return;
  const pipeline = await client.query(
    `INSERT INTO tenant.crm_pipelines (organization_id, name, code, is_default, created_by, updated_by)
     VALUES ($1, 'Sales Pipeline', 'SALES', true, $2, $2)
     ON CONFLICT (organization_id, code) DO UPDATE SET status = 'active', is_default = true
     RETURNING id`,
    [context.organizationId, context.userId ?? null],
  );
  for (const [index, stage] of DEFAULT_STAGES.entries()) {
    await client.query(
      `INSERT INTO tenant.crm_pipeline_stages (organization_id, pipeline_id, name, code, sequence, probability, forecast_category, is_won, is_lost, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
       ON CONFLICT (organization_id, pipeline_id, code) DO NOTHING`,
      [context.organizationId, pipeline.rows[0].id, stage.name, stage.code, (index + 1) * 10, stage.probability, stage.forecastCategory,
        Boolean(stage.isWon), Boolean(stage.isLost), context.userId ?? null],
    );
  }
}
