// Expired quotations (Shared Platform plan 1): a quotation is shown as Expired once its Valid Until date has passed (constants.js
// displayStatus — Expired is never stored). This daily check tells the salesperson once, the day after, and puts "Expired" on the
// quotation's history, so an offer never lapses unnoticed. A quotation already noted as expired is skipped, so a re-run tells nobody twice.
import { createNotification } from "../../../core/platform/notifications/index.js";

import { OPEN_STATUSES } from "./constants.js";
import { recordQuotationEvent } from "./versions.js";

export const QUOTATION_EXPIRY_LIMIT = 500;

export async function noteExpiredQuotations(client, context, { limit = QUOTATION_EXPIRY_LIMIT } = {}) {
  const { rows } = await client.query(
    `SELECT quote.id, quote.quotation_number, quote.lifecycle_status, to_char(quote.valid_until, 'YYYY-MM-DD') AS valid_until,
            COALESCE(quote.owner_user_id, quote.created_by) AS notify_user_id, party.display_name AS customer_name
       FROM tenant.sales_quotations quote
       LEFT JOIN tenant.business_parties party ON party.organization_id = quote.organization_id AND party.id = quote.party_id
      WHERE quote.organization_id = $1 AND quote.lifecycle_status = ANY($2::text[]) AND quote.valid_until IS NOT NULL
        AND quote.valid_until < (now() AT TIME ZONE COALESCE((SELECT timezone FROM public.organizations WHERE id = $1), 'Asia/Kolkata'))::date
        AND NOT EXISTS (SELECT 1 FROM tenant.sales_document_events event WHERE event.organization_id = quote.organization_id
                         AND event.entity_type = 'quotation' AND event.entity_id = quote.id AND event.event_type = 'quotation.expired')
      ORDER BY quote.valid_until, quote.id
      LIMIT $3`,
    [context.organizationId, OPEN_STATUSES, limit]);
  let notified = 0;
  for (const quote of rows) {
    await recordQuotationEvent(client, context, quote.id, "quotation.expired", quote.lifecycle_status, quote.lifecycle_status, { validUntil: quote.valid_until });
    if (await createNotification(client, {
      organizationId: context.organizationId, userId: quote.notify_user_id, category: "sales_quotation_expired",
      title: `Quotation ${quote.quotation_number} has expired`,
      message: `${quote.customer_name ? `${quote.customer_name}: the` : "The"} offer was valid until ${quote.valid_until}. Make a revision with a new date to send it again.`,
      href: `/sales/quotations/${quote.id}`, entityType: "sales.quotation", entityId: quote.id,
    })) notified += 1;
  }
  return { expired: rows.length, notified };
}
