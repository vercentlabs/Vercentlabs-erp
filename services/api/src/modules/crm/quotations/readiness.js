// What the Create Quotation dialog needs, in one read: whether the
// opportunity is ready to be quoted, how its account resolves to a customer,
// the account's contacts and addresses, the opportunity's product lines and
// the Sales defaults (price list, payment terms, validity, currency).
// Nothing is written.
import { findDuplicateAccounts } from "../accounts/duplicates.js";
import { requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { getOpportunity } from "../opportunities/records.js";
import { CrmError } from "../data-management/errors.js";

const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const trimmed = (value) => (value === null || value === undefined ? null : String(value).trim() || null);

export function quotationCapabilities(context) {
  return {
    createFromOpportunity: can(context, OPPORTUNITY_PERMISSIONS.createQuotation) && can(context, "sales.quotation.create"),
    viewSales: can(context, "sales.view"),
    overridePrice: can(context, "sales.price.override"),
    applyDiscount: can(context, "sales.discount.apply") || can(context, "sales.price.override"),
    createCustomer: can(context, "crm.accounts.create_customer"),
    send: can(context, "sales.quotation.send"),
    revise: can(context, "sales.quotation.revise"),
    accept: can(context, "sales.quotation.accept_on_behalf"),
    reject: can(context, "sales.quotation.reject"),
    cancel: can(context, "sales.quotation.cancel"),
    createOrder: can(context, "sales.order.create"),
  };
}

export async function loadAccount(client, context, partyId) {
  const { rows } = await client.query(
    `SELECT id, code, display_name, legal_name, customer_number, party_type, gstin, pan, payment_term_id, currency_code, default_price_list_id,
            sales_block, sales_block_reason, website, phone, email, status
       FROM tenant.business_parties WHERE organization_id = $1 AND id = $2`,
    [context.organizationId, partyId],
  );
  return rows[0] ?? null;
}
export const isCustomer = (account) => Boolean(account && (account.customer_number || ["customer", "both"].includes(account.party_type)));

// Existing customers that look like this account (GSTIN, company or legal
// name, phone, email domain, website domain). A customer the caller cannot
// open is still reported, without its details.
export async function customerMatches(client, context, account) {
  const { matches } = await findDuplicateAccounts(client, context, {
    displayName: account.display_name, legalName: account.legal_name, website: account.website, email: account.email, phone: account.phone, gstin: account.gstin,
  }, { excludeId: account.id });
  return matches
    .filter((match) => match.canOpen ? match.isCustomer : match.strength === "exact")
    .map((match) => (match.canOpen
      ? { id: match.id, code: match.code, name: match.name, legalName: match.legalName ?? null, customerNumber: match.customerNumber ?? null, website: match.website ?? null,
          city: match.city ?? null, ownerName: match.ownerName ?? null, strength: match.strength, signals: match.signals, canOpen: true }
      : { id: match.id, code: null, name: "A record you do not have access to", strength: match.strength, signals: match.signals, canOpen: false }));
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// The first open stage named Proposal, when the opportunity is still before it.
export async function proposalStageSuggestion(client, context, opportunity) {
  const { rows } = await client.query(
    `SELECT proposal.id, proposal.name, proposal.sequence, current_stage.sequence AS current_sequence
       FROM tenant.crm_pipeline_stages proposal
       JOIN tenant.crm_pipeline_stages current_stage ON current_stage.organization_id = proposal.organization_id AND current_stage.id = $3
      WHERE proposal.organization_id = $1 AND proposal.pipeline_id = $2 AND proposal.status = 'active' AND NOT proposal.is_won AND NOT proposal.is_lost
        AND (proposal.code = 'proposal' OR lower(proposal.name) LIKE 'proposal%')
      ORDER BY proposal.sequence LIMIT 1`,
    [context.organizationId, opportunity.pipelineId, opportunity.stageId],
  );
  const proposal = rows[0];
  if (!proposal || Number(proposal.current_sequence) >= Number(proposal.sequence)) return null;
  return { stageId: proposal.id, stageName: proposal.name };
}

export async function getQuotationReadiness(client, context, opportunityId) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.createQuotation, "You do not have permission to create quotations from opportunities.");
  if (!can(context, "sales.view")) throw new CrmError(403, "You need access to Sales to create quotations.", "PERMISSION_DENIED");
  const opportunity = await getOpportunity(client, context, opportunityId);
  const account = opportunity.accountId ? await loadAccount(client, context, opportunity.accountId) : null;
  const capabilities = quotationCapabilities(context);
  const customer = isCustomer(account);

  // One connection, one query at a time.
  const queries = [
    () => account ? client.query(
      `SELECT contact.id, contact.display_name, contact.designation, contact.email, contact.mobile, contact.phone
         FROM tenant.contacts contact
        WHERE contact.organization_id = $1 AND contact.status = 'active' AND contact.archived_at IS NULL AND COALESCE(contact.privacy_status, 'active') = 'active'
          AND (contact.party_id = $2 OR EXISTS (SELECT 1 FROM tenant.crm_contact_account_relationships link
                WHERE link.organization_id = contact.organization_id AND link.contact_id = contact.id AND link.party_id = $2 AND link.status = 'active'))
        ORDER BY contact.display_name`,
      [context.organizationId, account.id]) : { rows: [] },
    () => account ? client.query(
      `SELECT id, address_type, line1, line2, city, state, state_code, postal_code, country_code, is_default_billing, is_default_shipping
         FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active'
        ORDER BY is_default_billing DESC, is_default_shipping DESC, created_at`,
      [context.organizationId, account.id]) : { rows: [] },
    () => client.query(
      `SELECT line.id, line.item_id, line.description, line.quantity, line.unit_price, line.discount_percent, item.code AS item_code, item.name AS item_name,
              item.status AS item_status, uom.code AS uom_code
         FROM tenant.crm_opportunity_items line
         JOIN tenant.items item ON item.organization_id = line.organization_id AND item.id = line.item_id
         LEFT JOIN tenant.units_of_measure uom ON uom.id = item.uom_id
        WHERE line.organization_id = $1 AND line.opportunity_id = $2 ORDER BY line.created_at, line.id`,
      [context.organizationId, opportunity.id]),
    () => client.query(
      `SELECT id, code, name, currency_code, tax_inclusive FROM tenant.price_lists
        WHERE organization_id = $1 AND price_list_type = 'sales' AND status = 'active'
          AND (valid_from IS NULL OR valid_from <= current_date) AND (valid_to IS NULL OR valid_to >= current_date) ORDER BY name`,
      [context.organizationId]),
    () => client.query(`SELECT id, code, name FROM tenant.payment_terms WHERE organization_id = $1 AND status = 'active' ORDER BY name`, [context.organizationId]),
    () => client.query(`SELECT code, is_base FROM tenant.currencies WHERE organization_id = $1 AND status = 'active' ORDER BY is_base DESC, code`, [context.organizationId]),
    () => client.query(`SELECT * FROM tenant.sales_settings WHERE organization_id = $1`, [context.organizationId]),
    () => client.query(`SELECT current_date::text AS today`),
  ];
  const results = [];
  for (const run of queries) results.push(await run());
  const [contacts, addresses, lines, priceLists, paymentTerms, currencies, settingsRow, today] = results;
  const settings = settingsRow.rows[0] ?? {};
  const baseCurrency = String(currencies.rows.find((row) => row.is_base)?.code ?? currencies.rows[0]?.code ?? "INR").trim();
  const currencyCode = opportunity.currencyCode || account?.currency_code?.trim() || baseCurrency;
  const activeCurrencies = currencies.rows.map((row) => String(row.code).trim());
  const contactIds = new Set(contacts.rows.map((row) => row.id));
  const billing = addresses.rows.find((row) => row.is_default_billing) ?? addresses.rows.find((row) => ["billing", "registered"].includes(row.address_type)) ?? null;
  // Shipping is optional at quotation stage; only an address Sales accepts as a ship-to is suggested.
  const shipping = addresses.rows.find((row) => row.is_default_shipping && ["shipping", "plant", "office", "registered"].includes(row.address_type)) ?? null;
  const defaultPriceListId = [account?.default_price_list_id, settings.default_price_list_id]
    .find((id) => id && priceLists.rows.some((row) => row.id === id && String(row.currency_code).trim() === currencyCode)) ?? null;
  const matches = account && !customer ? await customerMatches(client, context, account) : [];

  const checks = [
    { key: "status", label: "Opportunity is open", met: opportunity.status === "open" && !opportunity.archivedAt, blocking: true,
      value: opportunity.status === "open" ? "Open" : `${opportunity.status[0].toUpperCase()}${opportunity.status.slice(1)}: a closed opportunity is not quoted` },
    { key: "account", label: "Account", met: Boolean(account && account.status === "active"), blocking: true, value: account?.display_name ?? "No account" },
    { key: "salesBlock", label: "Customer not blocked for sales", met: !account || account.sales_block !== "all", blocking: true,
      value: account?.sales_block === "all" ? `Blocked: ${account.sales_block_reason}` : "Not blocked" },
    { key: "customer", label: "Customer master", met: customer, blocking: false,
      value: customer ? `${account.display_name} (${account.customer_number ?? account.code})` : "The account is a prospect: create or link its customer in the dialog" },
    { key: "contact", label: "Contact person", met: Boolean(opportunity.contactId && contactIds.has(opportunity.contactId)), blocking: false,
      value: opportunity.contactName ?? "None on the opportunity: choose one in the dialog" },
    { key: "currency", label: "Currency", met: activeCurrencies.includes(currencyCode), blocking: true, value: currencyCode },
    { key: "lines", label: "Products or services", met: lines.rows.length > 0, blocking: false,
      value: lines.rows.length ? `${lines.rows.length} line(s) on the opportunity` : "None on the opportunity: add lines in the dialog" },
    { key: "owner", label: "Opportunity owner", met: Boolean(opportunity.ownerUserId), blocking: true, value: opportunity.ownerName ?? "Unassigned" },
    { key: "sales", label: "Permission to create quotations in Sales", met: capabilities.createFromOpportunity, blocking: true,
      value: capabilities.createFromOpportunity ? "Yes" : "Ask for the Sales quotation permission" },
  ];
  const recommended = [
    { key: "amount", label: "Estimated value", met: Number(opportunity.amount) > 0, value: Number(opportunity.amount) > 0 ? String(opportunity.amount) : "Not set" },
    { key: "closeDate", label: "Expected close date", met: Boolean(opportunity.expectedCloseDate), value: opportunity.expectedCloseDate ?? "Not set" },
    { key: "productInterest", label: "Product / service interest", met: Boolean(trimmed(opportunity.productInterest)), value: trimmed(opportunity.productInterest) ?? "Not set" },
  ];

  return {
    opportunity: {
      id: opportunity.id, code: opportunity.code, name: opportunity.name, status: opportunity.status, stageName: opportunity.stageName,
      amount: opportunity.amount, currencyCode: opportunity.currencyCode, expectedCloseDate: opportunity.expectedCloseDate, productInterest: opportunity.productInterest,
      ownerUserId: opportunity.ownerUserId, ownerName: opportunity.ownerName, quotationCount: opportunity.quotationCount,
      // Internal context for the salesperson; never copied onto the customer's quotation.
      internalContext: [opportunity.requirements, opportunity.commercialNotes].map(trimmed).filter(Boolean).join("\n\n") || null,
    },
    account: account ? {
      id: account.id, code: account.code, name: account.display_name, legalName: account.legal_name, isCustomer: customer, customerNumber: account.customer_number,
      gstin: account.gstin, pan: account.pan, website: account.website, phone: account.phone, email: account.email, paymentTermId: account.payment_term_id,
      currencyCode: account.currency_code?.trim() ?? null, hasBillingAddress: Boolean(billing),
    } : null,
    customerMatches: matches,
    capabilities,
    checks,
    recommended,
    canCreate: checks.every((check) => !check.blocking || check.met),
    contacts: contacts.rows.map((row) => ({ id: row.id, name: row.display_name, jobTitle: row.designation, email: row.email, phone: row.mobile ?? row.phone })),
    addresses: addresses.rows.map((row) => ({
      id: row.id, type: row.address_type, label: [row.line1, row.city, row.state].filter(Boolean).join(", "), stateCode: row.state_code,
      isDefaultBilling: row.is_default_billing, isDefaultShipping: row.is_default_shipping,
    })),
    lines: lines.rows.map((row) => ({
      id: row.id, itemId: row.item_id, itemCode: row.item_code, itemName: row.item_name, active: row.item_status === "active", uom: row.uom_code,
      description: row.description, quantity: Number(row.quantity), estimatedUnitPrice: Number(row.unit_price), estimatedDiscountPercent: Number(row.discount_percent ?? 0),
    })),
    priceLists: priceLists.rows.map((row) => ({ id: row.id, code: row.code, name: row.name, currencyCode: String(row.currency_code).trim(), taxInclusive: row.tax_inclusive })),
    paymentTerms: paymentTerms.rows.map((row) => ({ id: row.id, code: row.code, name: row.name })),
    currencies: activeCurrencies,
    sellerStateCode: settings.seller_state_code ?? null,
    stageSuggestion: await proposalStageSuggestion(client, context, opportunity),
    defaults: {
      contactId: opportunity.contactId && contactIds.has(opportunity.contactId) ? opportunity.contactId : contacts.rows[0]?.id ?? null,
      billingAddressId: billing?.id ?? null,
      shippingAddressId: shipping?.id ?? null,
      quotationDate: today.rows[0].today,
      validUntil: addDays(today.rows[0].today, Number(settings.default_quote_validity_days) > 0 ? Number(settings.default_quote_validity_days) : 15),
      currencyCode,
      priceListId: defaultPriceListId,
      paymentTermId: account?.payment_term_id ?? settings.default_payment_term_id ?? null,
    },
  };
}
