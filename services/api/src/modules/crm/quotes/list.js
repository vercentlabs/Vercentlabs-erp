// Every CRM quote on the deals the person may see (CRM audit navigation: a Quotations link in CRM), newest first.
import { hasApp, loadApps } from "../../../core/access/apps.js";
import { opportunityCan, opportunityScopeSql } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { CrmError } from "../data-management/errors.js";

const STATUSES = new Set(["draft", "sent", "accepted", "declined", "upgraded"]);

// filters: { status?, limit?, offset? }. salesOn: whether quotations are made in Sales now (the page then links there).
export async function listAllDealQuotes(client, context, filters = {}) {
  if (!opportunityCan(context, OPPORTUNITY_PERMISSIONS.view)) throw new CrmError(403, "You do not have permission to view deals.", "PERMISSION_DENIED");
  await loadApps(client, context);
  const limit = Math.min(Math.max(Number(filters.limit) || 50, 1), 200);
  const offset = Math.max(Number(filters.offset) || 0, 0);
  const values = [context.organizationId];
  const scope = opportunityScopeSql(context, values, "opportunity");
  const status = STATUSES.has(filters.status) ? (values.push(filters.status), ` AND quote.status = $${values.length}`) : "";
  const from = `FROM tenant.crm_quotes quote
    JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = quote.organization_id AND opportunity.id = quote.opportunity_id
    LEFT JOIN tenant.business_parties party ON party.organization_id = quote.organization_id AND party.id = quote.party_id
   WHERE quote.organization_id = $1${status}${scope}`;
  const total = (await client.query(`SELECT count(*)::int AS total ${from}`, values)).rows[0].total;
  const { rows } = await client.query(
    `SELECT quote.id, quote.quote_number, quote.kind, quote.status, quote.grand_total, quote.currency_code, to_char(quote.quote_date, 'YYYY-MM-DD') AS quote_on,
            to_char(quote.valid_until, 'YYYY-MM-DD') AS valid_on, opportunity.id AS deal_id, opportunity.name AS deal_name, party.display_name AS company_name
       ${from} ORDER BY quote.created_at DESC LIMIT ${limit} OFFSET ${offset}`, values);
  return {
    total, limit, offset, salesOn: hasApp(context, "sales"),
    quotes: rows.map((row) => ({ id: row.id, number: row.quote_number, kind: row.kind, status: row.status, grandTotal: row.grand_total, currencyCode: String(row.currency_code).trim(),
      quoteDate: row.quote_on, validUntil: row.valid_on, dealId: row.deal_id, dealName: row.deal_name, companyName: row.company_name })),
  };
}
