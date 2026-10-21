// The sales stages every organization starts with, and the one pipeline that
// holds them. Created the first time a stage is needed (lead conversion, the
// opportunity form, the pipeline); administrators can rename, reorder, add to
// and deactivate the stages afterwards. Idempotent: does nothing once an
// active pipeline exists.
//
// Won and Lost are kept as two closing rows of the same table so a closed
// deal has somewhere to sit, but they are outcomes, not sales stages: they are
// reached only through Mark won and Mark lost and are never listed, renamed
// or reordered with the stages.
export const DEFAULT_SALES_STAGES = Object.freeze([
  {
    // Stage names an Indian SMB uses (CRM audit); the codes stay, so rules and reports hold.
    code: "DISCOVERY", name: "Enquiry", probability: 10, forecastCategory: "pipeline",
    description: "A customer has enquired and you are understanding what they need.",
    guidance: "Understand the business problem\nIdentify the stakeholders\nUnderstand the high-level scope\nEstablish whether the deal is real",
  },
  {
    code: "NEEDS_ANALYSIS", name: "Requirement understood", probability: 25, forecastCategory: "pipeline",
    description: "You know what they need: items, quantities, delivery and who decides.",
    guidance: "Confirm what is needed: modules, users, locations, processes\nUnderstand implementation and technical requirements\nUnderstand the decision process and commercial constraints",
  },
  {
    code: "PROPOSAL", name: "Quotation sent", probability: 50, forecastCategory: "best_case",
    description: "The quotation (or proforma) has been sent to the customer.",
    guidance: "Define the scope and the solution\nCreate the quotation\nShare the pricing\nPresent the proposal or demo",
  },
  {
    code: "NEGOTIATION", name: "Negotiation", probability: 75, forecastCategory: "committed",
    description: "The customer is actively discussing commercial or contractual terms.",
    guidance: "Confirm the final scope\nResolve pricing and discounts\nAgree payment terms\nAgree the implementation schedule",
  },
  {
    code: "CLOSING", name: "Order expected", probability: 90, forecastCategory: "committed",
    description: "The customer is about to place the order. The deal stays open until the order or the answer comes.",
    guidance: "Get the final approval or purchase order\nGet the final quotation accepted\nGet the contract signed\nThen mark the deal won or lost",
  },
  { code: "WON", name: "Closed Won", probability: 100, forecastCategory: "closed", isWon: true },
  { code: "LOST", name: "Closed Lost", probability: 0, forecastCategory: "closed", isLost: true },
]);

// The stable codes of the standard stages. Rules that depend on a stage use its code, never its name.
export const DEFAULT_STAGE_CODES = Object.freeze(DEFAULT_SALES_STAGES.map((stage) => stage.code));

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
  for (const [index, stage] of DEFAULT_SALES_STAGES.entries()) {
    await client.query(
      `INSERT INTO tenant.crm_pipeline_stages (organization_id, pipeline_id, name, code, sequence, probability, forecast_category, is_won, is_lost,
                                               description, guidance, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $12)
       ON CONFLICT (organization_id, pipeline_id, code) DO NOTHING`,
      [context.organizationId, pipeline.rows[0].id, stage.name, stage.code, (index + 1) * 10, stage.probability, stage.forecastCategory,
        Boolean(stage.isWon), Boolean(stage.isLost), stage.description ?? null, stage.guidance ?? null, context.userId ?? null],
    );
  }
}
