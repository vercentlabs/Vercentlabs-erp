// A second opportunity for the same deal. One account can honestly have
// several similar deals, so this only warns: the same account, still open,
// with a similar name or the same product interest. The user opens the
// existing one or continues.
import { opportunityScopeSql, requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { isUuid } from "./records.js";

const SIMILAR = 0.35;
const text = (value) => String(value ?? "").trim();

// input: { accountId, name?, productInterest? }. Returns { matches }.
export async function findDuplicateOpportunities(client, context, input = {}, { excludeId = null, limit = 5 } = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.view, "You do not have permission to view opportunities.");
  if (!isUuid(input.accountId) || (!text(input.name) && !text(input.productInterest))) return { matches: [] };
  const values = [context.organizationId, input.accountId, text(input.name).toLowerCase(), text(input.productInterest).toLowerCase(), isUuid(excludeId) ? excludeId : null, SIMILAR];
  const visible = opportunityScopeSql(context, values, "opportunity");
  const { rows } = await client.query(
    `SELECT opportunity.id, opportunity.code, opportunity.name, opportunity.amount, opportunity.currency_code, opportunity.product_interest,
            stage.name AS stage_name, owner.full_name AS owner_name, (true${visible}) AS can_open,
            similarity(lower(opportunity.name), $3) AS name_similarity,
            ($4 <> '' AND lower(COALESCE(opportunity.product_interest, '')) = $4) AS same_product
       FROM tenant.crm_opportunities opportunity
       LEFT JOIN tenant.crm_pipeline_stages stage ON stage.organization_id = opportunity.organization_id AND stage.id = opportunity.stage_id
       LEFT JOIN public.users owner ON owner.id = opportunity.owner_user_id
      WHERE opportunity.organization_id = $1 AND opportunity.party_id = $2 AND opportunity.status = 'open' AND opportunity.archived_at IS NULL
        AND ($5::uuid IS NULL OR opportunity.id <> $5)
        AND (($3 <> '' AND similarity(lower(opportunity.name), $3) >= $6) OR ($4 <> '' AND lower(COALESCE(opportunity.product_interest, '')) = $4))
      ORDER BY name_similarity DESC, opportunity.updated_at DESC
      LIMIT ${Number(limit)}`,
    values,
  );
  return {
    matches: rows.map((row) => {
      const reasons = [Number(row.name_similarity) >= SIMILAR && "Similar name", row.same_product && "Same product interest"].filter(Boolean);
      if (!row.can_open) return { id: row.id, canOpen: false, reasons };
      return {
        id: row.id, canOpen: true, reasons, code: row.code, name: row.name, amount: Number(row.amount ?? 0), currencyCode: row.currency_code?.trim() ?? null,
        stageName: row.stage_name, ownerName: row.owner_name ?? null, productInterest: row.product_interest,
      };
    }),
  };
}
