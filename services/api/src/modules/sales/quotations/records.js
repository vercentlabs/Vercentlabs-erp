// Creating, editing, reading and listing quotations, and the two ways to
// start one from another: Duplicate (a new, independent quotation priced
// from today's lists) and Create Revision (the next revision of a confirmed
// quotation, keeping its prices, which supersedes it once sent).
//
// A quotation is always for a Customer Master. It starts as a Draft that can
// be edited freely (each save is kept as a version); once confirmed its
// commercial content is locked and changes go through a revision.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { nextDocumentNumber } from "../../../core/platform/numbering/index.js";
import { SalesError, previewSalesDocument, redactMargin } from "../index.js";
import { quotationCan, quotationCapabilities, quotationScopeSql, requireQuotationAccess, requireQuotationPermission, teamOwnersSql } from "./access.js";
import {
  ACTIVE_STATUSES, OPEN_STATUSES, QUOTATION_PERMISSIONS, QUOTATION_VIEWS, QuotationError, STATUS, dayOf, displayStatus, has, isUuid, requireUuid, text,
} from "./constants.js";
import { inputFromQuotation, insertQuotationVersion, lockQuotation, recordQuotationEvent } from "./versions.js";

const DATE = /^\d{4}-\d{2}-\d{2}$/;
// One connection runs one query at a time.
const inOrder = async (queries) => { const results = []; for (const query of queries) results.push(await query()); return results; };

export async function databaseToday(client) {
  return (await client.query(`SELECT current_date::text AS today`)).rows[0].today;
}
function addDays(day, days) {
  const value = new Date(`${day}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return value.toISOString().slice(0, 10);
}
function readDate(value, label) {
  const result = text(value, 10);
  if (!result) return null;
  if (!DATE.test(result)) throw new QuotationError(400, `${label} must be a date.`, "SALES_QUOTATION_VALIDATION", { field: label });
  return result;
}

// Errors from the pricing core keep their status and code.
async function priced(client, context, input, options) {
  try {
    return await previewSalesDocument(client, context, input, options);
  } catch (error) {
    if (error instanceof SalesError) throw new QuotationError(error.status, error.message, error.code);
    throw error;
  }
}

// What a new quotation starts with when the form leaves it out: today's date,
// validity from Sales settings, the company's standard terms, and the
// customer's currency, default contact, billing and shipping addresses.
async function withDefaults(client, context, input, today) {
  const partyId = requireUuid(input.partyId, "Customer");
  const { rows } = await client.query(
    `SELECT party.currency_code, organization.base_currency, settings.default_quote_validity_days, settings.default_quotation_terms,
            (SELECT id FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND is_default_billing LIMIT 1) AS billing_id,
            (SELECT id FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND is_default_shipping LIMIT 1) AS shipping_id,
            (SELECT link.contact_id FROM tenant.crm_contact_account_relationships link
               JOIN tenant.contacts contact ON contact.organization_id = link.organization_id AND contact.id = link.contact_id AND contact.status = 'active'
                    AND contact.archived_at IS NULL AND COALESCE(contact.privacy_status, 'active') = 'active'
              WHERE link.organization_id = $1 AND link.party_id = $2 AND link.status = 'active'
              ORDER BY link.is_primary_contact DESC, link.is_billing_contact DESC, link.created_at LIMIT 1) AS contact_id
       FROM public.organizations organization
       LEFT JOIN tenant.business_parties party ON party.organization_id = organization.id AND party.id = $2
       LEFT JOIN tenant.sales_settings settings ON settings.organization_id = organization.id
      WHERE organization.id = $1`,
    [context.organizationId, partyId]);
  const defaults = rows[0] ?? {};
  const quotationDate = readDate(input.quotationDate, "Quotation date") ?? today;
  const validityDays = Number(defaults.default_quote_validity_days ?? 15) || 15;
  return {
    ...input,
    partyId,
    quotationDate,
    validUntil: readDate(input.validUntil, "Valid until") ?? addDays(quotationDate, validityDays),
    currencyCode: text(input.currencyCode, 3) ?? defaults.currency_code?.trim() ?? defaults.base_currency?.trim(),
    contactId: input.contactId !== undefined ? input.contactId || null : defaults.contact_id ?? null,
    billingAddressId: input.billingAddressId || defaults.billing_id || null,
    shippingAddressId: input.shippingAddressId || defaults.shipping_id || input.billingAddressId || defaults.billing_id || null,
    termsAndConditions: input.termsAndConditions !== undefined ? input.termsAndConditions : defaults.default_quotation_terms ?? null,
  };
}

// The quotation date is today unless the caller may date it; Valid Until is
// on or after it and not already past.
function checkDates(context, input, today, { previousDate = null } = {}) {
  if (input.quotationDate !== today && input.quotationDate !== previousDate)
    requireQuotationPermission(context, QUOTATION_PERMISSIONS.changeDate, "Only an authorised user can give a quotation a date other than today.");
  if (!input.validUntil) throw new QuotationError(400, "Choose the date the quotation is valid until.", "SALES_QUOTATION_VALIDATION", { field: "validUntil" });
  if (input.validUntil < today) throw new QuotationError(422, "Valid until cannot be in the past.", "SALES_QUOTATION_VALIDITY_PAST", { field: "validUntil" });
  if (input.validUntil < input.quotationDate)
    throw new QuotationError(422, "Valid until cannot be before the quotation date.", "SALES_QUOTATION_VALIDITY_INVALID", { field: "validUntil" });
}

// A quotation may cite only an open opportunity of this organization for the same customer.
async function checkOpportunity(client, context, opportunityId, partyId) {
  if (!opportunityId) return null;
  const { rows } = await client.query(
    `SELECT id, party_id, status FROM tenant.crm_opportunities WHERE organization_id = $1 AND id = $2 AND status <> 'archived'`,
    [context.organizationId, requireUuid(opportunityId, "Opportunity")]);
  if (!rows[0]) throw new QuotationError(404, "The linked opportunity was not found.", "SALES_QUOTATION_OPPORTUNITY_INVALID");
  if (rows[0].party_id && rows[0].party_id !== partyId)
    throw new QuotationError(422, "The quotation customer must match the opportunity's account.", "SALES_QUOTATION_OPPORTUNITY_INVALID");
  return rows[0];
}

// input: partyId, contactId?, opportunityId?, ownerUserId?, quotationDate?, validUntil?, currencyCode?, priceListId?, paymentTermId?,
//        billingAddressId?, shippingAddressId?, placeOfSupply?, supplyType?, customerReference?, headerDiscountPercent?,
//        customerNotes?, termsAndConditions?, internalNotes?, lines[], charges[]?, idempotencyKey?
export async function createQuotation(client, context, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.create, "You do not have permission to create quotations.");
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "sales.quotation.create", key: text(input.idempotencyKey, 200), payload: { ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };
  const today = await databaseToday(client);
  const document = await withDefaults(client, context, input, today);
  checkDates(context, document, today);
  const preview = await priced(client, context, document);
  await checkOpportunity(client, context, document.opportunityId, preview.master.partyId);
  const number = await nextDocumentNumber(client, { organizationId: context.organizationId }, { documentType: "quotation", at: document.quotationDate });
  const quotation = (await client.query(
    `INSERT INTO tenant.sales_quotations (organization_id, quotation_number, source_opportunity_id, party_id, contact_id, owner_user_id, quotation_date, valid_until,
        customer_reference, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10) RETURNING id, quotation_number`,
    [context.organizationId, number, document.opportunityId || null, preview.master.partyId, preview.master.contact?.id ?? null, preview.master.ownerUserId,
      document.quotationDate, document.validUntil, text(document.customerReference, 200), context.userId ?? null])).rows[0];
  const version = await insertQuotationVersion(client, context, quotation.id, document, preview);
  await client.query(`UPDATE tenant.sales_quotations SET current_version_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, quotation.id, version.id]);
  await recordQuotationEvent(client, context, quotation.id, "quotation.created", null, STATUS.draft,
    { versionId: version.id, versionNumber: version.version_number, opportunityId: document.opportunityId || null, source: input.source ?? (document.opportunityId ? "opportunity" : "direct") });
  const response = { id: quotation.id, quotation_number: quotation.quotation_number, quotationNumber: quotation.quotation_number, currentVersionId: version.id, versionNumber: 1, replayed: false };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "sales_quotation", aggregateId: quotation.id });
  return response;
}

// Saves changes to a Draft as its next version. expectedVersionNumber is the
// version the editor opened; a save over someone else's change is refused.
export async function updateQuotation(client, context, quotationId, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.create, "You do not have permission to edit quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  await assertVisible(client, context, quote.id);
  if (quote.lifecycle_status !== STATUS.draft)
    throw new QuotationError(409, "Only a draft can be edited. Create a revision to change a confirmed quotation.", "SALES_QUOTATION_LOCKED");
  if (input.expectedVersionNumber == null || Number(input.expectedVersionNumber) !== Number(quote.version_number))
    throw new QuotationError(409, "Someone else changed this quotation. Reload it and make your change again.", "SALES_QUOTATION_VERSION_CONFLICT");
  const today = await databaseToday(client);
  const document = await withDefaults(client, context, {
    ...input,
    termsAndConditions: has(input, "termsAndConditions") ? input.termsAndConditions : null,
    opportunityId: has(input, "opportunityId") ? input.opportunityId || null : quote.source_opportunity_id,
  }, today);
  checkDates(context, document, today, { previousDate: dayOf(quote.quotation_date) });
  // A revision stays an offer to the same customer.
  if (quote.revision_of_quotation_id && document.partyId !== quote.party_id)
    throw new QuotationError(409, "A revision cannot change the customer. Create a new quotation instead.", "SALES_QUOTATION_CUSTOMER_LOCKED");
  const preview = await priced(client, context, document);
  await checkOpportunity(client, context, document.opportunityId, preview.master.partyId);
  const version = await insertQuotationVersion(client, context, quote.id, document, preview);
  await client.query(
    `UPDATE tenant.sales_quotations
        SET current_version_id = $3, party_id = $4, contact_id = $5, owner_user_id = $6, source_opportunity_id = $7, quotation_date = $8, valid_until = $9,
            customer_reference = $10, approval_status = 'not_required', updated_by = $11, updated_at = now()
      WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, quote.id, version.id, preview.master.partyId, preview.master.contact?.id ?? null, preview.master.ownerUserId, document.opportunityId || null,
      document.quotationDate, document.validUntil, text(document.customerReference, 200), context.userId ?? null]);
  await recordQuotationEvent(client, context, quote.id, "quotation.updated", STATUS.draft, STATUS.draft, { versionId: version.id, versionNumber: version.version_number });
  return { id: quote.id, currentVersionId: version.id, versionNumber: Number(version.version_number) };
}

async function assertVisible(client, context, quotationId) {
  requireQuotationAccess(context);
  const values = [context.organizationId, quotationId];
  const scope = quotationScopeSql(context, values, "quotation");
  if (!scope) return;
  const { rows } = await client.query(`SELECT 1 FROM tenant.sales_quotations quotation WHERE quotation.organization_id = $1 AND quotation.id = $2${scope}`, values);
  if (!rows[0]) throw new QuotationError(404, "Quotation not found.", "SALES_QUOTATION_NOT_FOUND");
}
export { assertVisible as assertQuotationVisible };

function lineView(line) {
  return {
    ...line,
    is_price_overridden: Boolean(line.manual_price_override),
  };
}

// Everything the quotation page shows. `quotation` is the quotation joined
// with its current version (the shape the PDF renderer reads).
export async function getQuotation(client, context, quotationId) {
  const id = requireUuid(quotationId);
  await assertVisible(client, context, id);
  const today = await databaseToday(client);
  const { rows } = await client.query(
    `SELECT quotation.*, version.*, quotation.id AS quotation_id, quotation.created_at AS quotation_created_at, quotation.updated_at AS quotation_updated_at,
            quotation.created_by AS quotation_created_by, version.id AS version_id,
            opportunity.code AS source_opportunity_code, opportunity.name AS source_opportunity_name, opportunity.status AS source_opportunity_status,
            price_list.code AS price_list_code, price_list.name AS price_list_name, price_list.tax_inclusive AS price_list_tax_inclusive,
            owner.full_name AS owner_name, creator.full_name AS created_by_name, confirmer.full_name AS confirmed_by_name, sender.full_name AS sent_by_name,
            accepter.full_name AS accepted_by_name, rejecter.full_name AS rejected_by_name, canceller.full_name AS cancelled_by_name,
            sales_order.sales_order_number AS converted_order_number, sales_order.lifecycle_status AS converted_order_status,
            original.quotation_number AS revision_of_number, superseder.quotation_number AS superseded_by_number,
            party.customer_number, party.status AS customer_status
       FROM tenant.sales_quotations quotation
       JOIN tenant.sales_quotation_versions version ON version.organization_id = quotation.organization_id AND version.id = quotation.current_version_id
       LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = quotation.organization_id AND opportunity.id = quotation.source_opportunity_id
       LEFT JOIN tenant.price_lists price_list ON price_list.organization_id = quotation.organization_id AND price_list.id = version.price_list_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = quotation.organization_id AND party.id = quotation.party_id
       LEFT JOIN public.users owner ON owner.id = quotation.owner_user_id
       LEFT JOIN public.users creator ON creator.id = quotation.created_by
       LEFT JOIN public.users confirmer ON confirmer.id = quotation.confirmed_by
       LEFT JOIN public.users sender ON sender.id = quotation.sent_by
       LEFT JOIN public.users accepter ON accepter.id = quotation.accepted_by
       LEFT JOIN public.users rejecter ON rejecter.id = quotation.rejected_by
       LEFT JOIN public.users canceller ON canceller.id = quotation.cancelled_by
       LEFT JOIN tenant.sales_orders sales_order ON sales_order.organization_id = quotation.organization_id AND sales_order.id = quotation.converted_order_id
       LEFT JOIN tenant.sales_quotations original ON original.organization_id = quotation.organization_id AND original.id = quotation.revision_of_quotation_id
       LEFT JOIN tenant.sales_quotations superseder ON superseder.organization_id = quotation.organization_id AND superseder.id = quotation.superseded_by_quotation_id
      WHERE quotation.organization_id = $1 AND quotation.id = $2`,
    [context.organizationId, id]);
  const quote = rows[0];
  if (!quote) throw new QuotationError(404, "Quotation not found.", "SALES_QUOTATION_NOT_FOUND");
  quote.id = quote.quotation_id;
  quote.created_at = quote.quotation_created_at;
  quote.updated_at = quote.quotation_updated_at;
  quote.created_by = quote.quotation_created_by;
  quote.currency_code = quote.currency_code?.trim();
  const status = displayStatus(quote, today);
  const [lines, charges, taxLines, versions, events, revisions, decisions] = await inOrder([
    () => client.query(`SELECT * FROM tenant.sales_quotation_lines WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`, [context.organizationId, quote.current_version_id]),
    () => client.query(`SELECT * FROM tenant.sales_quotation_charges WHERE organization_id = $1 AND quotation_version_id = $2 ORDER BY sequence`, [context.organizationId, quote.current_version_id]),
    () => client.query(`SELECT tax_type, label, rate, sum(taxable_amount) AS taxable_amount, sum(tax_amount) AS tax_amount FROM tenant.sales_quotation_tax_lines
                   WHERE organization_id = $1 AND quotation_version_id = $2 GROUP BY tax_type, label, rate ORDER BY tax_type, rate`, [context.organizationId, quote.current_version_id]),
    () => client.query(`SELECT version.id, version.version_number, version.revision_reason, version.grand_total, version.currency_code, version.created_at, version.created_by, author.full_name AS created_by_name
                    FROM tenant.sales_quotation_versions version LEFT JOIN public.users author ON author.id = version.created_by
                   WHERE version.organization_id = $1 AND version.quotation_id = $2 ORDER BY version.version_number DESC`, [context.organizationId, id]),
    () => client.query(`SELECT event.id, event.event_type, event.from_status, event.to_status, event.metadata, event.occurred_at, event.actor_user_id, actor.full_name AS actor_name
                    FROM tenant.sales_document_events event LEFT JOIN public.users actor ON actor.id = event.actor_user_id
                   WHERE event.organization_id = $1 AND event.entity_type = 'quotation' AND event.entity_id = $2 ORDER BY event.occurred_at DESC, event.id DESC LIMIT 300`, [context.organizationId, id]),
    // Every quotation in this revision chain, oldest first.
    () => client.query(`SELECT chain.id, chain.quotation_number, chain.revision_number, chain.lifecycle_status, chain.valid_until, chain.created_at, version.grand_total
                    FROM tenant.sales_quotations chain JOIN tenant.sales_quotation_versions version ON version.organization_id = chain.organization_id AND version.id = chain.current_version_id
                   WHERE chain.organization_id = $1 AND (chain.id = $2 OR chain.revision_root_id = $2) ORDER BY chain.revision_number`,
      [context.organizationId, quote.revision_root_id ?? id]),
    () => client.query(`SELECT decision, customer_name, note, decided_at, recorded_by FROM tenant.sales_quote_decisions WHERE organization_id = $1 AND quotation_id = $2 ORDER BY decided_at DESC`, [context.organizationId, id]),
  ]);
  const detail = {
    quotation: { ...quote, status: status.key, status_label: status.label, is_expired: status.isExpired },
    lines: lines.rows.map(lineView),
    charges: charges.rows,
    taxLines: taxLines.rows,
    versions: versions.rows,
    events: events.rows,
    revisions: revisions.rows.map((row) => ({ ...row, status: displayStatus(row, today) })),
    decisions: decisions.rows,
    capabilities: quotationCapabilities(context),
    actions: availableActions(context, quote, status, today),
  };
  return redactMargin(detail, context);
}

// What the caller can do with the quotation now; the server checks again on each action.
function availableActions(context, quote, status, today) {
  const can = (permission) => quotationCan(context, permission);
  const stored = quote.lifecycle_status;
  const open = OPEN_STATUSES.includes(stored);
  const validUntil = dayOf(quote.valid_until);
  const notExpired = !validUntil || validUntil >= today;
  return {
    edit: stored === STATUS.draft && can(QUOTATION_PERMISSIONS.create),
    confirm: stored === STATUS.draft && can(QUOTATION_PERMISSIONS.confirm),
    approve: stored === STATUS.awaitingApproval && can(QUOTATION_PERMISSIONS.approve),
    rejectApproval: stored === STATUS.awaitingApproval && can(QUOTATION_PERMISSIONS.approve),
    send: open && notExpired && can(QUOTATION_PERMISSIONS.send),
    accept: open && notExpired && can(QUOTATION_PERMISSIONS.accept),
    reject: open && can(QUOTATION_PERMISSIONS.reject),
    revise: open && can(QUOTATION_PERMISSIONS.revise),
    duplicate: can(QUOTATION_PERMISSIONS.create),
    cancel: [STATUS.draft, STATUS.awaitingApproval, STATUS.confirmed, STATUS.sent].includes(stored) && can(QUOTATION_PERMISSIONS.cancel),
    createOrder: stored === STATUS.accepted && !quote.converted_order_id && can(QUOTATION_PERMISSIONS.createOrder),
    print: can(QUOTATION_PERMISSIONS.export),
    expired: status.isExpired,
  };
}

const SORTS = Object.freeze({
  date: "quotation.quotation_date", number: "quotation.quotation_number", customer: "customer_name", validUntil: "quotation.valid_until",
  total: "version.grand_total", status: "quotation.lifecycle_status", updated: "quotation.updated_at",
});

// filters: view, search, status, partyId, contactId, opportunityId, ownerUserId, currencyCode, priceListId,
//          dateFrom, dateTo, validFrom, validTo, amountMin, amountMax, sort, direction, limit, offset
export async function listQuotations(client, context, filters = {}) {
  requireQuotationAccess(context);
  const today = await databaseToday(client);
  const values = [context.organizationId, today];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  let where = quotationScopeSql(context, values, "quotation");
  const expired = `(quotation.lifecycle_status IN ('${OPEN_STATUSES.join("','")}') AND quotation.valid_until < $2::date)`;
  switch (filters.view) {
    case "mine": where += ` AND quotation.owner_user_id = ${bind(context.userId ?? null)}`; break;
    case "team": if (quotationCan(context, QUOTATION_PERMISSIONS.viewTeam) || quotationCan(context, QUOTATION_PERMISSIONS.viewAll)) {
      const me = bind(context.userId ?? null);
      where += ` AND quotation.owner_user_id IN ${teamOwnersSql(me)}`;
    } else where += " AND false"; break;
    case "draft": where += ` AND quotation.lifecycle_status IN ('${STATUS.draft}','${STATUS.awaitingApproval}')`; break;
    case "sent": where += ` AND quotation.lifecycle_status = '${STATUS.sent}'`; break;
    case "awaiting": where += ` AND quotation.lifecycle_status = '${STATUS.sent}' AND NOT ${expired}`; break;
    case "accepted": where += ` AND quotation.lifecycle_status = '${STATUS.accepted}'`; break;
    case "rejected": where += ` AND quotation.lifecycle_status = '${STATUS.rejected}'`; break;
    case "expired": where += ` AND ${expired}`; break;
    case "cancelled": where += ` AND quotation.lifecycle_status = '${STATUS.cancelled}'`; break;
    default: break;
  }
  if (filters.status) {
    const key = String(filters.status);
    if (key === "expired") where += ` AND ${expired}`;
    else {
      const stored = { confirmed: STATUS.confirmed, superseded: STATUS.superseded, awaiting_approval: STATUS.awaitingApproval }[key] ?? key;
      where += ` AND quotation.lifecycle_status = ${bind(stored)}`;
      if (OPEN_STATUSES.includes(stored)) where += ` AND NOT ${expired}`;
    }
  }
  const search = text(filters.search, 200);
  if (search) {
    const term = bind(`%${search.replace(/[\\%_]/g, (character) => `\\${character}`)}%`);
    where += ` AND (quotation.quotation_number ILIKE ${term} OR quotation.customer_reference ILIKE ${term} OR version.customer_snapshot->>'displayName' ILIKE ${term}
      OR party.customer_number ILIKE ${term} OR opportunity.name ILIKE ${term} OR opportunity.code ILIKE ${term}
      OR concat_ws(' ', version.contact_snapshot->>'first_name', version.contact_snapshot->>'last_name') ILIKE ${term}
      OR EXISTS (SELECT 1 FROM tenant.sales_quotation_lines line WHERE line.organization_id = quotation.organization_id AND line.quotation_version_id = version.id
                  AND (line.item_name_snapshot ILIKE ${term} OR line.item_code_snapshot ILIKE ${term})))`;
  }
  const uuidFilter = (key, column, label) => { if (filters[key]) where += ` AND ${column} = ${bind(requireUuid(filters[key], label))}`; };
  uuidFilter("partyId", "quotation.party_id", "Customer");
  uuidFilter("contactId", "quotation.contact_id", "Contact");
  uuidFilter("opportunityId", "quotation.source_opportunity_id", "Opportunity");
  uuidFilter("ownerUserId", "quotation.owner_user_id", "Owner");
  uuidFilter("priceListId", "version.price_list_id", "Price list");
  if (filters.currencyCode) where += ` AND version.currency_code = ${bind(String(filters.currencyCode).trim().toUpperCase().slice(0, 3))}`;
  const dateFilter = (key, sql, label) => { const day = readDate(filters[key], label); if (day) where += sql(bind(day)); };
  dateFilter("dateFrom", (p) => ` AND quotation.quotation_date >= ${p}::date`, "From date");
  dateFilter("dateTo", (p) => ` AND quotation.quotation_date <= ${p}::date`, "To date");
  dateFilter("validFrom", (p) => ` AND quotation.valid_until >= ${p}::date`, "Valid from");
  dateFilter("validTo", (p) => ` AND quotation.valid_until <= ${p}::date`, "Valid to");
  for (const [key, operator] of [["amountMin", ">="], ["amountMax", "<="]])
    if (filters[key] !== undefined && filters[key] !== null && filters[key] !== "") {
      const amount = Number(filters[key]);
      if (!Number.isFinite(amount)) throw new QuotationError(400, "Enter a valid amount.", "SALES_QUOTATION_VALIDATION");
      where += ` AND version.grand_total ${operator} ${bind(amount)}`;
    }
  const sort = SORTS[filters.sort] ?? SORTS.date;
  const direction = filters.direction === "asc" ? "ASC" : "DESC";
  const limit = Math.min(200, Math.max(1, Number.parseInt(filters.limit, 10) || 50));
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  const from = `FROM tenant.sales_quotations quotation
       JOIN tenant.sales_quotation_versions version ON version.organization_id = quotation.organization_id AND version.id = quotation.current_version_id
       LEFT JOIN tenant.business_parties party ON party.organization_id = quotation.organization_id AND party.id = quotation.party_id
       LEFT JOIN tenant.crm_opportunities opportunity ON opportunity.organization_id = quotation.organization_id AND opportunity.id = quotation.source_opportunity_id
       LEFT JOIN public.users owner ON owner.id = quotation.owner_user_id
      WHERE quotation.organization_id = $1 AND $2::date IS NOT NULL`;
  const countValues = [...values];
  const [result, count] = await inOrder([
    () => client.query(
      `SELECT quotation.id, quotation.quotation_number, quotation.quotation_date, quotation.valid_until, quotation.lifecycle_status, quotation.revision_number,
              quotation.customer_reference, quotation.sent_at, quotation.converted_order_id, quotation.updated_at, quotation.party_id, quotation.owner_user_id,
              version.version_number, version.currency_code, version.subtotal, version.tax_total, version.grand_total, version.margin_percent,
              version.customer_snapshot->>'displayName' AS customer_name, party.customer_number,
              NULLIF(concat_ws(' ', version.contact_snapshot->>'first_name', version.contact_snapshot->>'last_name'), '') AS contact_name,
              opportunity.id AS opportunity_id, opportunity.name AS opportunity_name, opportunity.code AS opportunity_code, owner.full_name AS owner_name
         ${from}${where}
        ORDER BY ${sort} ${direction} NULLS LAST, quotation.quotation_number DESC
        LIMIT ${bind(limit)} OFFSET ${bind(offset)}`, values),
    () => client.query(`SELECT count(*)::int AS total ${from}${where}`, countValues),
  ]);
  return redactMargin({
    rows: result.rows.map((row) => {
      const status = displayStatus(row, today);
      return { ...row, currency_code: row.currency_code?.trim(), status: status.key, status_label: status.label, is_expired: status.isExpired };
    }),
    total: count.rows[0].total,
    limit,
    offset,
    views: QUOTATION_VIEWS.filter((view) => view.key !== "team" || quotationCan(context, QUOTATION_PERMISSIONS.viewTeam) || quotationCan(context, QUOTATION_PERMISSIONS.viewAll)),
    capabilities: quotationCapabilities(context),
  }, context);
}

// A new, independent draft with the same customer and lines, priced from
// today's lists (manual prices are kept, with their reasons).
export async function duplicateQuotation(client, context, quotationId, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.create, "You do not have permission to create quotations.");
  const quote = await lockQuotation(client, context, quotationId);
  await assertVisible(client, context, quote.id);
  const source = await inputFromQuotation(client, context, quote, { carryPrices: false });
  const created = await createQuotation(client, context, {
    ...source,
    ownerUserId: context.userId ?? source.ownerUserId,
    quotationDate: undefined,
    validUntil: undefined,
    idempotencyKey: input.idempotencyKey ? `duplicate:${quote.id}:${input.idempotencyKey}` : undefined,
    source: "duplicate",
  });
  if (!created.replayed)
    await recordQuotationEvent(client, context, created.id, "quotation.duplicated", null, STATUS.draft, { fromQuotationId: quote.id, fromQuotationNumber: quote.quotation_number });
  return created;
}

// The next revision of a confirmed or sent quotation: a new draft quotation
// (QT-2026-000124-R1) with the same content and prices, linked to the one it
// revises. The original stays as it is until the revision is sent; then it
// is superseded. input: { reason, idempotencyKey? }
export async function createQuotationRevision(client, context, quotationId, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.revise, "You do not have permission to revise quotations.");
  const reason = text(input.reason ?? input.revisionReason, 1000);
  if (!reason) throw new QuotationError(400, "Give the reason for this revision.", "SALES_QUOTATION_REVISION_REASON_REQUIRED", { field: "reason" });
  const quote = await lockQuotation(client, context, quotationId);
  await assertVisible(client, context, quote.id);
  if (!OPEN_STATUSES.includes(quote.lifecycle_status))
    throw new QuotationError(409, quote.lifecycle_status === STATUS.draft
      ? "A draft can be edited directly; a revision is only needed once a quotation is confirmed."
      : "This quotation can no longer be revised.", "SALES_QUOTATION_NOT_REVISABLE");
  const existing = (await client.query(`SELECT id, quotation_number FROM tenant.sales_quotations WHERE organization_id = $1 AND revision_of_quotation_id = $2`,
    [context.organizationId, quote.id])).rows[0];
  if (existing) {
    if (input.idempotencyKey) return { id: existing.id, quotationNumber: existing.quotation_number, quotation_number: existing.quotation_number, replayed: true };
    throw new QuotationError(409, `This quotation already has a revision, ${existing.quotation_number}.`, "SALES_QUOTATION_REVISION_EXISTS", { quotationId: existing.id });
  }
  const today = await databaseToday(client);
  const source = await inputFromQuotation(client, context, quote, { carryPrices: true });
  const settings = (await client.query(`SELECT default_quote_validity_days FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId])).rows[0];
  const validUntil = dayOf(quote.valid_until) >= today ? dayOf(quote.valid_until) : addDays(today, Number(settings?.default_quote_validity_days ?? 15) || 15);
  const document = { ...source, quotationDate: today, validUntil, revisionReason: reason };
  // The quoted prices are carried as they were agreed; the revision is then edited as a draft.
  const preview = await priced(client, context, document, { carryQuotedPrices: true });
  const rootId = quote.revision_root_id ?? quote.id;
  const root = (await client.query(`SELECT quotation_number FROM tenant.sales_quotations WHERE organization_id = $1 AND id = $2`, [context.organizationId, rootId])).rows[0];
  const revisionNumber = Number(quote.revision_number ?? 0) + 1;
  const number = `${root.quotation_number}-R${revisionNumber}`;
  const revision = (await client.query(
    `INSERT INTO tenant.sales_quotations (organization_id, quotation_number, source_opportunity_id, party_id, contact_id, owner_user_id, quotation_date, valid_until,
        customer_reference, revision_of_quotation_id, revision_root_id, revision_number, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $13) RETURNING id, quotation_number`,
    [context.organizationId, number, quote.source_opportunity_id, quote.party_id, preview.master.contact?.id ?? null, quote.owner_user_id, today, validUntil,
      quote.customer_reference, quote.id, rootId, revisionNumber, context.userId ?? null])).rows[0];
  const version = await insertQuotationVersion(client, context, revision.id, document, preview);
  await client.query(`UPDATE tenant.sales_quotations SET current_version_id = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, revision.id, version.id]);
  await recordQuotationEvent(client, context, revision.id, "quotation.created", null, STATUS.draft,
    { versionId: version.id, versionNumber: 1, source: "revision", revisionOf: quote.id, revisionOfNumber: quote.quotation_number, reason });
  await recordQuotationEvent(client, context, quote.id, "quotation.revision_created", quote.lifecycle_status, quote.lifecycle_status,
    { revisionId: revision.id, revisionNumber: revision.quotation_number, reason });
  return { id: revision.id, quotationNumber: revision.quotation_number, quotation_number: revision.quotation_number, revisionNumber, replayed: false };
}

// A comment on the quotation's timeline (never printed). input: { note }
export async function addQuotationNote(client, context, quotationId, input = {}) {
  requireQuotationAccess(context);
  const note = text(input.note, 4000);
  if (!note) throw new QuotationError(400, "Write the note.", "SALES_QUOTATION_VALIDATION", { field: "note" });
  const quote = await lockQuotation(client, context, quotationId);
  await assertVisible(client, context, quote.id);
  await recordQuotationEvent(client, context, quote.id, "quotation.note_added", quote.lifecycle_status, quote.lifecycle_status, { note });
  return { added: true };
}

// What the New Quotation form needs for a customer: its defaults.
export async function getQuotationDefaults(client, context, input = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.create, "You do not have permission to create quotations.");
  const today = await databaseToday(client);
  const settings = (await client.query(`SELECT default_quote_validity_days, default_quotation_terms FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId])).rows[0] ?? {};
  const base = {
    quotationDate: today,
    validUntil: addDays(today, Number(settings.default_quote_validity_days ?? 15) || 15),
    termsAndConditions: settings.default_quotation_terms ?? "",
    canChangeDate: quotationCan(context, QUOTATION_PERMISSIONS.changeDate),
  };
  if (!isUuid(input.partyId)) return base;
  const document = await withDefaults(client, context, { partyId: input.partyId }, today);
  const party = (await client.query(`SELECT payment_term_id, default_price_list_id FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, document.partyId])).rows[0] ?? {};
  return {
    ...base,
    currencyCode: document.currencyCode ?? null,
    contactId: document.contactId,
    billingAddressId: document.billingAddressId,
    shippingAddressId: document.shippingAddressId,
    paymentTermId: party.payment_term_id ?? null,
    priceListId: party.default_price_list_id ?? null,
  };
}

export { ACTIVE_STATUSES };

const csvCell = (value) => {
  const result = value === null || value === undefined ? "" : String(value);
  // A cell starting with a formula character is read as text by spreadsheets.
  const safe = /^[=+\-@\t\r]/.test(result) ? `'${result}` : result;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

// The list as filtered on screen, as CSV (up to 5,000 rows).
export async function exportQuotations(client, context, filters = {}) {
  requireQuotationPermission(context, QUOTATION_PERMISSIONS.export, "You do not have permission to export quotations.");
  const rows = [];
  for (let offset = 0; offset < 5000; offset += 200) {
    const page = await listQuotations(client, context, { ...filters, limit: 200, offset });
    rows.push(...page.rows);
    if (page.rows.length < 200) break;
  }
  const header = ["Quotation", "Date", "Customer", "Customer number", "Contact", "Opportunity", "Owner", "Status", "Valid until", "Currency", "Subtotal", "Tax", "Total", "Reference"];
  const body = rows.map((row) => [row.quotation_number, dayOf(row.quotation_date), row.customer_name, row.customer_number, row.contact_name, row.opportunity_name, row.owner_name,
    row.status_label, dayOf(row.valid_until), row.currency_code, row.subtotal, row.tax_total, row.grand_total, row.customer_reference].map(csvCell).join(","));
  return { csv: [header.join(","), ...body].join("\r\n") + "\r\n", fileName: `quotations-${await databaseToday(client)}.csv`, rows: rows.length };
}
