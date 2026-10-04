// An opportunity's quotations: every quotation raised from it, newest first,
// with its current revision, status (Expired is derived from the validity
// date), amount, validity, how it was sent and any sales order it became.
// One can be marked as the primary quotation of the deal.
import { CrmError } from "../data-management/errors.js";
import { requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { getOpportunity, lockOpportunity, requireUuid } from "../opportunities/records.js";
import { quotationCapabilities } from "./readiness.js";

const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const STATUS_LABELS = Object.freeze({
  draft: "Draft", pending_approval: "Awaiting approval", approved: "Confirmed", sent: "Sent", viewed: "Viewed", accepted: "Accepted", rejected: "Rejected",
  expired: "Expired", withdrawn: "Withdrawn", converted: "Sales order created", cancelled: "Cancelled",
});

export async function listOpportunityQuotations(client, context, opportunityId) {
  const opportunity = await getOpportunity(client, context, opportunityId);
  // Sales documents are shown only to those who may see Sales.
  if (!can(context, "sales.view")) return { quotations: [], visible: false, capabilities: quotationCapabilities(context) };
  const { rows } = await client.query(
    `SELECT quote.id, quote.quotation_number, quote.lifecycle_status, quote.valid_until, quote.created_at, quote.converted_order_id, quote.sent_at, quote.sent_to,
            quote.sent_channel, quote.accepted_at, quote.rejected_at, quote.cancelled_at, quote.customer_reference, quote.decision_reference, quote.decision_notes,
            quote.cancel_reason, version.version_number, version.grand_total, version.currency_code, version.revision_reason, owner.full_name AS owner_name,
            sales_order.sales_order_number, (quote.valid_until < current_date AND quote.lifecycle_status IN ('draft','pending_approval','approved','sent','viewed')) AS is_expired,
            (SELECT count(*) FROM tenant.sales_quotation_versions earlier WHERE earlier.organization_id = quote.organization_id AND earlier.quotation_id = quote.id)::int AS revision_count
       FROM tenant.sales_quotations quote
       LEFT JOIN tenant.sales_quotation_versions version ON version.organization_id = quote.organization_id AND version.id = quote.current_version_id
       LEFT JOIN public.users owner ON owner.id = quote.owner_user_id
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = quote.organization_id AND sales_order.id = quote.converted_order_id
      WHERE quote.organization_id = $1 AND quote.source_opportunity_id = $2
      ORDER BY quote.created_at DESC, quote.quotation_number DESC`,
    [context.organizationId, opportunity.id],
  );
  const latestActive = rows.find((row) => row.lifecycle_status !== "cancelled");
  return {
    visible: true,
    capabilities: quotationCapabilities(context),
    quotations: rows.map((row) => ({
      id: row.id,
      number: row.quotation_number,
      revision: Number(row.version_number ?? 1),
      revisionCount: row.revision_count,
      revisionReason: row.revision_reason ?? null,
      status: row.lifecycle_status,
      statusLabel: row.is_expired ? "Expired" : STATUS_LABELS[row.lifecycle_status] ?? row.lifecycle_status,
      isExpired: Boolean(row.is_expired),
      validUntil: row.valid_until,
      total: row.grand_total === null ? null : Number(row.grand_total),
      currencyCode: row.currency_code?.trim() ?? null,
      ownerName: row.owner_name ?? null,
      createdAt: row.created_at,
      sentAt: row.sent_at, sentTo: row.sent_to, sentChannel: row.sent_channel,
      acceptedAt: row.accepted_at, rejectedAt: row.rejected_at, cancelledAt: row.cancelled_at,
      customerReference: row.customer_reference, decisionReference: row.decision_reference, decisionNotes: row.decision_notes, cancelReason: row.cancel_reason,
      salesOrderId: row.converted_order_id, salesOrderNumber: row.sales_order_number ?? null,
      isLatest: row.id === latestActive?.id,
      isPrimary: row.id === opportunity.primaryQuotationId,
      isWinning: row.id === opportunity.winningQuotationId,
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
      `SELECT id, quotation_number, lifecycle_status FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2 AND source_opportunity_id = $3`,
      [context.organizationId, requireUuid(input.quotationId, "Quotation"), row.id],
    )).rows[0];
    if (!quotation) throw new CrmError(409, "Choose a quotation raised from this opportunity.", "CRM_OPPORTUNITY_QUOTATION_INVALID");
    if (quotation.lifecycle_status === "cancelled") throw new CrmError(409, "A cancelled quotation cannot be the primary one.", "CRM_OPPORTUNITY_QUOTATION_INVALID");
  }
  await client.query(`UPDATE tenant.crm_opportunities SET primary_quotation_id = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, row.id, quotation?.id ?? null, context.userId ?? null]);
  return { primaryQuotationId: quotation?.id ?? null };
}
