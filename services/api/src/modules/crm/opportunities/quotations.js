// Opportunity → Quotation. A deal can have any number of quotations (an
// initial proposal, a revised scope, a final offer); one can be marked as the
// primary one. Creating a quotation never wins the deal: it stays open until
// someone marks it won.
//
// The quotation itself is a Sales document. This module hands Sales
// everything the opportunity already knows (customer, contact, products,
// quantities, estimated prices, currency, salesperson) so nothing is typed
// twice; Sales then settles the price list, discounts, taxes and terms and
// saves it, with an idempotency key so a retried save makes one quotation.
import { CrmError } from "../data-management/errors.js";
import { requireOpportunityPermission } from "./access.js";
import { OPPORTUNITY_PERMISSIONS } from "./constants.js";
import { recordOpportunityHistory } from "./history.js";
import { assertOpen, getOpportunity, lockOpportunity, requireUuid } from "./records.js";

export async function listOpportunityQuotations(client, context, opportunityId) {
  const opportunity = await getOpportunity(client, context, opportunityId);
  const { rows } = await client.query(
    `SELECT quote.id, quote.quotation_number, quote.lifecycle_status, quote.valid_until, quote.created_at, quote.converted_order_id,
            version.version_number, version.grand_total, version.currency_code, salesperson.full_name AS owner_name, sales_order.sales_order_number
       FROM tenant.sales_quotations quote
       LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id = quote.organization_id AND version.id = quote.current_version_id
       LEFT JOIN public.users salesperson ON salesperson.id = quote.owner_user_id
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = quote.organization_id AND sales_order.id = quote.converted_order_id
      WHERE quote.organization_id = $1 AND quote.source_opportunity_id = $2
      ORDER BY quote.created_at DESC`,
    [context.organizationId, opportunity.id],
  );
  return rows.map((row, index) => ({
    id: row.id, number: row.quotation_number, version: row.version_number ?? 1, status: row.lifecycle_status, validUntil: row.valid_until,
    total: row.grand_total === null ? null : Number(row.grand_total), currencyCode: row.currency_code?.trim() ?? null, ownerName: row.owner_name ?? null,
    createdAt: row.created_at, salesOrderId: row.converted_order_id, salesOrderNumber: row.sales_order_number ?? null,
    isLatest: index === 0, isPrimary: row.id === opportunity.primaryQuotationId, isWinning: row.id === opportunity.winningQuotationId,
  }));
}

// Everything a new quotation starts from. The caller opens the Sales
// quotation form with it. Refused on a closed deal: a won or lost
// opportunity gets new work as a new opportunity.
export async function createQuotationFromOpportunity(client, context, opportunityId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.createQuotation, "You do not have permission to create quotations from opportunities.");
  const row = await lockOpportunity(client, context, opportunityId);
  assertOpen(row, "quoted");
  if (!row.party_id) throw new CrmError(409, "Add the account to this opportunity before creating a quotation.", "CRM_OPPORTUNITY_ACCOUNT_REQUIRED");
  const lines = await client.query(
    `SELECT line.item_id, line.description, line.quantity, line.unit_price, line.discount_percent, item.name AS item_name
       FROM tenant.crm_opportunity_items line
       JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
      WHERE line.organization_id = $1 AND line.opportunity_id = $2 ORDER BY line.created_at, line.id`,
    [context.organizationId, row.id],
  );
  await recordOpportunityHistory(client, context, row.id, "quotation_created", "Quotation started from this opportunity", { lines: lines.rows.length });
  return {
    opportunityId: row.id,
    opportunityCode: row.code,
    // The key Sales sends with the save: a double-click or a retried request creates one quotation.
    idempotencyKey: `opportunity-quotation:${row.id}:${Date.now()}`,
    partyId: row.party_id,
    accountName: row.account_name,
    // Sales quotes a customer: an account that is still a prospect becomes one first.
    accountIsCustomer: Boolean(row.account_customer_number),
    contactId: row.contact_id,
    ownerUserId: row.owner_user_id,
    currencyCode: row.currency_code?.trim() ?? null,
    notes: [row.requirements, row.commercial_notes].filter(Boolean).join("\n\n") || null,
    lines: lines.rows.map((line) => ({
      itemId: line.item_id, name: line.item_name, description: line.description, quantity: Number(line.quantity), unitPrice: Number(line.unit_price),
      discountPercent: Number(line.discount_percent ?? 0),
    })),
  };
}

// Marks one of the deal's quotations as the one that counts. input: { quotationId | null }
export async function setPrimaryOpportunityQuotation(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.edit, "You do not have permission to edit opportunities.");
  const row = await lockOpportunity(client, context, opportunityId);
  let quotation = null;
  if (input.quotationId) {
    quotation = (await client.query(
      `SELECT id, quotation_number FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2 AND source_opportunity_id = $3`,
      [context.organizationId, requireUuid(input.quotationId, "Quotation"), row.id],
    )).rows[0];
    if (!quotation) throw new CrmError(409, "Choose a quotation raised from this opportunity.", "CRM_OPPORTUNITY_QUOTATION_INVALID");
  }
  await client.query(`UPDATE tenant.crm_opportunities SET primary_quotation_id = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, quotation?.id ?? null, context.userId ?? null]);
  return { primaryQuotationId: quotation?.id ?? null };
}
