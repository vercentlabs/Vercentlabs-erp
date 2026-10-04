// createQuotationFromOpportunity: the opportunity becomes a Draft Sales
// quotation in the caller's one transaction.
//
//   check the opportunity (open, owned, with an account) and the caller's Sales rights
//   resolve the customer: the account itself when it is already a customer;
//     otherwise create its customer master (after a duplicate check), or link it
//     to an existing customer (the account is merged into that customer)
//   build the lines: the opportunity's products (Sales prices them from the
//     price list; the opportunity's estimate is used only on request, as a
//     price override) plus any lines added for the quotation
//   create the quotation through Sales (numbering, pricing, discounts, tax,
//     snapshots, idempotency), with the opportunity as its source
//   mark it the opportunity's primary quotation when there is none; record it
//
// The opportunity stays open: a quotation never wins a deal. A Proposal stage
// move is only suggested, never made here.
import { beginIdempotentOperation, completeIdempotentOperation } from "../../../core/idempotency.js";
import { addAccountAddress } from "../accounts/addresses.js";
import { createCustomerFromAccount, linkCustomer } from "../accounts/customer.js";
import { CrmError } from "../data-management/errors.js";
import { requireOpportunityPermission } from "../opportunities/access.js";
import { OPPORTUNITY_PERMISSIONS } from "../opportunities/constants.js";
import { recordOpportunityHistory } from "../opportunities/history.js";
import { assertOpen, lockOpportunity, requireUuid } from "../opportunities/records.js";
import { createQuotation } from "../../sales/index.js";
import { customerMatches, isCustomer, loadAccount, proposalStageSuggestion } from "./readiness.js";

const can = (context, permission) => Boolean(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(permission));
const text = (value, maximum = 4000) => {
  const result = value === null || value === undefined ? "" : String(value).trim();
  return result ? result.slice(0, maximum) : null;
};
const DATE = /^\d{4}-\d{2}-\d{2}$/;

// The account becomes (or is linked to) a customer. Returns the customer's party id.
async function resolveCustomer(client, context, opportunityRow, input) {
  const account = await loadAccount(client, context, opportunityRow.party_id);
  if (!account || account.status !== "active") throw new CrmError(409, "Add an active account to this opportunity before creating a quotation.", "CRM_OPPORTUNITY_ACCOUNT_REQUIRED");
  if (isCustomer(account)) return { partyId: account.id, decision: "existing" };
  const mode = input?.mode;
  if (mode === "link") {
    const customerId = requireUuid(input.customerId, "Customer");
    // The prospect account is merged into the customer: its contacts, this opportunity and its history move there.
    await linkCustomer(client, context, account.id, { customerId });
    return { partyId: customerId, decision: "linked" };
  }
  if (mode === "create") {
    const matches = await customerMatches(client, context, account);
    const strong = matches.filter((match) => match.strength === "exact");
    if (strong.length)
      throw new CrmError(409, "This company is already a customer. Link the account to the existing customer instead of creating another.", "CRM_QUOTATION_CUSTOMER_EXISTS", { matches });
    if (matches.length && input.confirmNoMatch !== true)
      throw new CrmError(409, "Possible matching customers found. Link one of them, or confirm this is a new customer.", "CRM_QUOTATION_CUSTOMER_POSSIBLE_MATCH", { matches });
    if (input.billingAddress) await addAccountAddress(client, context, account.id, { ...input.billingAddress, addressType: input.billingAddress.addressType || "billing", isDefaultBilling: true });
    await createCustomerFromAccount(client, context, account.id, {
      gstin: input.gstin, pan: input.pan, paymentTermId: input.paymentTermId, currencyCode: input.currencyCode, creditLimit: input.creditLimit,
    });
    return { partyId: account.id, decision: "created" };
  }
  throw new CrmError(409, "This account is not a customer yet. Create its customer master or link it to an existing customer.", "CRM_QUOTATION_CUSTOMER_REQUIRED", {
    matches: await customerMatches(client, context, account),
  });
}

function readLines(input) {
  if (!Array.isArray(input.lines) || !input.lines.length) throw new CrmError(400, "Add at least one product or service line.", "CRM_QUOTATION_LINES_REQUIRED");
  if (input.lines.length > 500) throw new CrmError(400, "A quotation cannot have more than 500 lines.", "CRM_QUOTATION_VALIDATION");
  return input.lines.map((line, index) => {
    const quantity = Number(line.quantity);
    if (!Number.isFinite(quantity) || quantity <= 0) throw new CrmError(400, `Line ${index + 1}: enter a quantity greater than zero.`, "CRM_QUOTATION_VALIDATION", { line: index + 1 });
    const discountPercent = line.discountPercent === undefined || line.discountPercent === null || line.discountPercent === "" ? 0 : Number(line.discountPercent);
    if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100)
      throw new CrmError(400, `Line ${index + 1}: the discount must be between 0 and 100%.`, "CRM_QUOTATION_VALIDATION", { line: index + 1 });
    const unitPrice = line.unitPrice === undefined || line.unitPrice === null || line.unitPrice === "" ? null : Number(line.unitPrice);
    if (unitPrice !== null && (!Number.isFinite(unitPrice) || unitPrice < 0))
      throw new CrmError(400, `Line ${index + 1}: enter a price of zero or more.`, "CRM_QUOTATION_VALIDATION", { line: index + 1 });
    return {
      itemId: requireUuid(line.itemId, `Line ${index + 1} product`),
      ...(text(line.uomId) ? { uomId: requireUuid(line.uomId, `Line ${index + 1} unit`) } : {}),
      description: text(line.description, 4000),
      quantity,
      discountPercent,
      // No price: Sales prices the line from the price list. A price is an override, with a reason.
      ...(unitPrice !== null ? { unitPrice, manualPriceReason: text(line.manualPriceReason, 1000) } : {}),
    };
  });
}

// input:
//   idempotencyKey      a retried request returns the first quotation
//   customer            { mode: "create", gstin?, pan?, paymentTermId?, currencyCode?, billingAddress?, confirmNoMatch? } | { mode: "link", customerId }
//                       (not needed when the account is already a customer)
//   contactId, billingAddressId, shippingAddressId, placeOfSupply
//   validUntil, currencyCode, priceListId, paymentTermId, customerReference
//   customerNotes, termsAndConditions (printed), internalNotes (never printed)
//   lines               [{ itemId, description?, quantity, discountPercent?, unitPrice? + manualPriceReason }]
//   makePrimary         mark it the opportunity's primary quotation (default: when it has none)
export async function createQuotationFromOpportunity(client, context, opportunityId, input = {}) {
  requireOpportunityPermission(context, OPPORTUNITY_PERMISSIONS.createQuotation, "You do not have permission to create quotations from opportunities.");
  if (!can(context, "sales.quotation.create")) throw new CrmError(403, "You need the Sales permission to create quotations.", "PERMISSION_DENIED");
  const idempotencyKey = text(input.idempotencyKey, 200);
  const idempotency = await beginIdempotentOperation(client, context, {
    operation: "crm.opportunity.quotation",
    key: idempotencyKey,
    payload: { opportunityId, ...input, idempotencyKey: undefined },
  });
  if (idempotency.replayed) return { ...idempotency.response, replayed: true };

  // The row lock serialises two people quoting the same deal.
  const opportunity = await lockOpportunity(client, context, opportunityId);
  assertOpen(opportunity, "quoted");
  if (!opportunity.owner_user_id) throw new CrmError(409, "Assign an owner to this opportunity before creating a quotation.", "CRM_QUOTATION_OWNER_REQUIRED");
  const validUntil = text(input.validUntil, 10);
  if (!validUntil || !DATE.test(validUntil)) throw new CrmError(400, "Choose the date the quotation is valid until.", "CRM_QUOTATION_VALIDATION", { field: "validUntil" });
  const lines = readLines(input);
  const currencyCode = (text(input.currencyCode, 3) ?? opportunity.currency_code ?? "").toString().trim().toUpperCase();

  const customer = await resolveCustomer(client, context, opportunity, input.customer);
  const defaults = (await client.query(
    `SELECT (SELECT id FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND is_default_billing LIMIT 1) AS billing_id,
            (SELECT id FROM tenant.addresses WHERE organization_id = $1 AND party_id = $2 AND status = 'active' AND is_default_shipping AND address_type IN ('shipping', 'plant', 'office', 'registered') LIMIT 1) AS shipping_id,
            (SELECT id FROM tenant.contacts WHERE organization_id = $1 AND party_id = $2 AND id = $3 AND status = 'active') AS contact_id`,
    [context.organizationId, customer.partyId, opportunity.contact_id],
  )).rows[0];
  const quotation = await createQuotation(client, context, {
    partyId: customer.partyId,
    contactId: text(input.contactId) ?? defaults.contact_id ?? undefined,
    ownerUserId: opportunity.owner_user_id,
    opportunityId: opportunity.id,
    currencyCode,
    priceListId: text(input.priceListId) ?? undefined,
    paymentTermId: text(input.paymentTermId) ?? undefined,
    billingAddressId: text(input.billingAddressId) ?? defaults.billing_id ?? undefined,
    shippingAddressId: text(input.shippingAddressId) ?? defaults.shipping_id ?? undefined,
    placeOfSupply: text(input.placeOfSupply, 80) ?? undefined,
    validUntil,
    customerReference: text(input.customerReference, 200),
    customerNotes: text(input.customerNotes, 10000),
    termsAndConditions: text(input.termsAndConditions, 20000),
    internalNotes: text(input.internalNotes, 10000),
    lines,
    idempotencyKey: idempotencyKey ? `crm:${idempotencyKey}` : undefined,
  });

  const makePrimary = input.makePrimary === true || !opportunity.primary_quotation_id;
  if (makePrimary)
    await client.query(`UPDATE tenant.crm_opportunities SET primary_quotation_id = $3, updated_by = $4 WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, opportunity.id, quotation.id, context.userId ?? null]);
  const actor = (await client.query(`SELECT full_name FROM public.users WHERE id = $1`, [context.userId])).rows[0]?.full_name ?? "someone";
  await recordOpportunityHistory(client, context, opportunity.id, "quotation_created", `Quotation ${quotation.quotation_number} created by ${actor}`, {
    quotationId: quotation.id, customer: customer.decision, lines: lines.length, primary: makePrimary,
  });
  const stageSuggestion = await proposalStageSuggestion(client, context, { pipelineId: opportunity.pipeline_id, stageId: opportunity.stage_id });
  const response = {
    quotationId: quotation.id,
    quotationNumber: quotation.quotation_number,
    opportunityId: opportunity.id,
    partyId: customer.partyId,
    customerDecision: customer.decision,
    primary: makePrimary,
    stageSuggestion,
    replayed: false,
  };
  await completeIdempotentOperation(client, context, idempotency, { response, aggregateType: "sales_quotation", aggregateId: quotation.id });
  return response;
}
