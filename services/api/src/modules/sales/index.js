import { createHash, randomBytes } from "node:crypto";
import {
  decimal,
  add,
  sub,
  mul,
  div,
  percent,
  max,
  roundMoney,
  asDatabaseDecimal,
  formatDecimal,
} from "./money.js";

export class SalesError extends Error {
  constructor(status, message, code = "SALES_ERROR") {
    super(message);
    this.name = "SalesError";
    this.status = status;
    this.code = code;
  }
}

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function uuid(value, label) {
  if (!uuidPattern.test(String(value || "")))
    throw new SalesError(400, `${label} is invalid.`);
  return String(value);
}
function text(value, maximum = 4000) {
  const result = value == null ? null : String(value).trim();
  return result ? result.slice(0, maximum) : null;
}
function bool(value) {
  return value === true;
}
function date(value, label, required = false) {
  const result = text(value, 10);
  if (!result && !required) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(result || ""))
    throw new SalesError(400, `${label} must be a date.`);
  return result;
}
function hasPermission(context, permission) {
  return (
    context.permissions?.includes(permission) ||
    context.roleSlugs?.includes("organization_owner")
  );
}
function requirePermission(context, permission) {
  if (!hasPermission(context, permission))
    throw new SalesError(
      403,
      "You do not have permission to perform this action.",
    );
}

async function allocateNumber(client, organizationId, entityType) {
  const result = await client.query(
    `UPDATE public.numbering_series SET next_number=next_number+1,updated_at=now()
      WHERE organization_id=$1 AND entity_type=$2 AND status='active'
      RETURNING prefix,next_number-1 AS number,padding`,
    [organizationId, entityType],
  );
  const row = result.rows[0];
  if (!row)
    throw new SalesError(
      409,
      `Numbering series ${entityType} is not configured.`,
    );
  return `${row.prefix}${String(row.number).padStart(Number(row.padding || 5), "0")}`;
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(",")}}`;
  return JSON.stringify(value);
}

async function loadDocumentContext(client, context, input, options = {}) {
  const companyId = uuid(input.companyId || context.activeCompanyId, "Company");
  const branchId = input.branchId
    ? uuid(input.branchId, "Branch")
    : context.activeBranchId;
  const partyId = uuid(input.partyId, "Customer");
  const ownerUserId = uuid(input.ownerUserId || context.userId, "Owner");
  const currencyCode = String(input.currencyCode || "")
    .trim()
    .toUpperCase();
  if (!/^[A-Z]{3}$/.test(currencyCode))
    throw new SalesError(400, "Currency is required.");

  const companyResult = await client.query(
    `SELECT company.id,company.name,company.base_currency,company.country_code
       FROM public.companies company
      WHERE company.organization_id=$1 AND company.id=$2`,
    [context.organizationId, companyId],
  );
  const company = companyResult.rows[0];
  if (!company)
    throw new SalesError(
      409,
      "The selected company is outside this organisation.",
    );
  if (
    !context.allowAllCompanies &&
    context.activeCompanyId &&
    companyId !== context.activeCompanyId
  )
    throw new SalesError(
      403,
      "Select the active company before creating this document.",
    );

  if (branchId) {
    const branch = await client.query(
      `SELECT 1 FROM public.branches WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
      [context.organizationId, companyId, branchId],
    );
    if (!branch.rows[0])
      throw new SalesError(
        409,
        "The selected branch does not belong to the company.",
      );
  }

  const partyResult = await client.query(
    `SELECT id,company_id,code,party_type,display_name,legal_name,gstin,pan,currency_code,credit_limit,payment_term_id,status
       FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, partyId],
  );
  const party = partyResult.rows[0];
  if (!party || party.status !== "active")
    throw new SalesError(
      409,
      "The selected customer or prospect is not active.",
    );
  const allowedPartyTypes = options.order
    ? ["customer", "both"]
    : ["customer", "prospect", "both"];
  if (!allowedPartyTypes.includes(party.party_type))
    throw new SalesError(
      409,
      options.order
        ? "Sales orders require an active customer."
        : "The selected party cannot receive a quotation.",
    );
  if (party.company_id && party.company_id !== companyId)
    throw new SalesError(
      409,
      "The selected customer belongs to another company.",
    );

  const owner = await client.query(
    `SELECT users.id,users.full_name FROM public.organization_memberships membership
       JOIN public.users users ON users.id=membership.user_id AND users.status='active'
      WHERE membership.organization_id=$1 AND membership.user_id=$2 AND membership.status='active'`,
    [context.organizationId, ownerUserId],
  );
  if (!owner.rows[0])
    throw new SalesError(
      409,
      "The selected owner is not an active organisation member.",
    );

  let contact = null;
  if (input.contactId) {
    const result = await client.query(
      `SELECT id,first_name,last_name,designation,email,phone,mobile FROM tenant.contacts WHERE organization_id=$1 AND party_id=$2 AND id=$3 AND status='active'`,
      [context.organizationId, partyId, uuid(input.contactId, "Contact")],
    );
    contact = result.rows[0];
    if (!contact)
      throw new SalesError(
        409,
        "The selected contact does not belong to the customer.",
      );
  }
  async function addressSnapshot(addressId, label) {
    if (!addressId) return { id: null, row: null };
    const result = await client.query(
      `SELECT id,address_type,line1,line2,city,district,state,state_code,postal_code,country_code,gstin FROM tenant.addresses WHERE organization_id=$1 AND party_id=$2 AND id=$3 AND status='active'`,
      [context.organizationId, partyId, uuid(addressId, label)],
    );
    if (!result.rows[0])
      throw new SalesError(
        409,
        `The selected ${label.toLowerCase()} does not belong to the customer.`,
      );
    return { id: addressId, row: result.rows[0] };
  }
  const billing = await addressSnapshot(
    input.billingAddressId,
    "Billing address",
  );
  const shipping = await addressSnapshot(
    input.shippingAddressId,
    "Shipping address",
  );

  const currencyResult = await client.query(
    `SELECT code,decimal_places,status FROM tenant.currencies WHERE organization_id=$1 AND code=$2`,
    [context.organizationId, currencyCode],
  );
  const currency = currencyResult.rows[0];
  if (!currency || currency.status !== "active")
    throw new SalesError(409, "The selected currency is not active.");
  const baseCurrencyCode = String(company.base_currency).trim();
  let exchangeRate = decimal(input.exchangeRate || 1);
  if (currencyCode === baseCurrencyCode) exchangeRate = decimal(1);
  else if (exchangeRate <= 0n || input.exchangeRate == null) {
    const rate = await client.query(
      `SELECT rate FROM tenant.exchange_rates WHERE organization_id=$1 AND (company_id=$2 OR company_id IS NULL) AND from_currency_code=$3 AND to_currency_code=$4 AND rate_date<=current_date AND status='active' ORDER BY company_id NULLS LAST,rate_date DESC LIMIT 1`,
      [context.organizationId, companyId, currencyCode, baseCurrencyCode],
    );
    if (!rate.rows[0])
      throw new SalesError(
        409,
        `An exchange rate from ${currencyCode} to ${baseCurrencyCode} is required.`,
      );
    exchangeRate = decimal(rate.rows[0].rate);
  }

  let priceList = null;
  if (input.priceListId) {
    const result = await client.query(
      `SELECT id,code,name,currency_code,tax_inclusive FROM tenant.price_lists WHERE organization_id=$1 AND id=$2 AND price_list_type='sales' AND currency_code=$3 AND status='active' AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date)`,
      [
        context.organizationId,
        uuid(input.priceListId, "Price list"),
        currencyCode,
      ],
    );
    priceList = result.rows[0];
    if (!priceList)
      throw new SalesError(
        409,
        "The selected Sales price list is inactive, expired or uses another currency.",
      );
  }
  let paymentTerm = null;
  const paymentTermId = input.paymentTermId || party.payment_term_id;
  if (paymentTermId) {
    const result = await client.query(
      `SELECT id,code,name,description,default_due_days FROM tenant.payment_terms WHERE organization_id=$1 AND id=$2 AND status='active'`,
      [context.organizationId, uuid(paymentTermId, "Payment term")],
    );
    paymentTerm = result.rows[0];
    if (!paymentTerm)
      throw new SalesError(409, "The selected payment term is not active.");
  }
  const settingsResult = await client.query(
    `SELECT * FROM tenant.sales_settings WHERE organization_id=$1`,
    [context.organizationId],
  );
  const settings = settingsResult.rows[0] || {};
  return {
    companyId,
    branchId: branchId || null,
    partyId,
    ownerUserId,
    currencyCode,
    baseCurrencyCode,
    exchangeRate,
    company,
    party,
    contact,
    billing,
    shipping,
    currency,
    priceList,
    paymentTerm,
    settings,
  };
}

async function calculateLine(client, context, master, line, sequence, input) {
  const itemId = uuid(line.itemId, `Line ${sequence} item`);
  const itemResult = await client.query(
    `SELECT item.id,item.company_id,item.code,item.name,item.description,item.hsn_sac_code,item.uom_id,item.standard_cost,item.sales_price,item.tax_category_id,uom.code AS uom_code,uom.name AS uom_name FROM tenant.items item JOIN tenant.units_of_measure uom ON uom.id=item.uom_id WHERE item.organization_id=$1 AND item.id=$2 AND item.status='active'`,
    [context.organizationId, itemId],
  );
  const item = itemResult.rows[0];
  if (!item || (item.company_id && item.company_id !== master.companyId))
    throw new SalesError(
      409,
      `Line ${sequence} item is inactive or belongs to another company.`,
    );
  const uomId = line.uomId
    ? uuid(line.uomId, `Line ${sequence} UOM`)
    : item.uom_id;
  let conversionFactor = decimal(1);
  let uomCode = item.uom_code;
  if (uomId !== item.uom_id) {
    const conversion = await client.query(
      `SELECT conversion_factor,uom.code AS uom_code FROM tenant.item_uom_conversions conversion JOIN tenant.units_of_measure uom ON uom.id=conversion.from_uom_id WHERE conversion.organization_id=$1 AND conversion.item_id=$2 AND conversion.from_uom_id=$3 AND conversion.to_uom_id=$4 AND uom.status='active' UNION ALL SELECT (1/conversion_factor),uom.code FROM tenant.item_uom_conversions conversion JOIN tenant.units_of_measure uom ON uom.id=conversion.to_uom_id WHERE conversion.organization_id=$1 AND conversion.item_id=$2 AND conversion.to_uom_id=$3 AND conversion.from_uom_id=$4 AND uom.status='active' LIMIT 1`,
      [context.organizationId, itemId, uomId, item.uom_id],
    );
    if (!conversion.rows[0])
      throw new SalesError(
        409,
        `Line ${sequence} has no conversion to the item's base UOM.`,
      );
    conversionFactor = decimal(conversion.rows[0].conversion_factor);
    uomCode = conversion.rows[0].uom_code;
  }
  const quantity = decimal(line.quantity);
  if (quantity <= 0n)
    throw new SalesError(
      400,
      `Line ${sequence} quantity must be greater than zero.`,
    );
  const baseQuantity = mul(quantity, conversionFactor);
  let listUnitPrice = decimal(item.sales_price || 0);
  let priceSource = "item.sales_price";
  const appliedRules = [];
  if (master.priceList) {
    const priceResult = await client.query(
      `SELECT rate,id FROM tenant.price_list_items WHERE organization_id=$1 AND price_list_id=$2 AND item_id=$3 AND (uom_id=$4 OR uom_id IS NULL) AND minimum_quantity<=$5 AND status='active' AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date) ORDER BY (uom_id=$4) DESC,minimum_quantity DESC,valid_from DESC NULLS LAST LIMIT 1`,
      [
        context.organizationId,
        master.priceList.id,
        itemId,
        uomId,
        asDatabaseDecimal(quantity),
      ],
    );
    if (priceResult.rows[0]) {
      listUnitPrice = decimal(priceResult.rows[0].rate);
      priceSource = `price_list_item:${priceResult.rows[0].id}`;
    }
  }
  const rules = await client.query(
    `SELECT id,code,adjustment_type,adjustment_value FROM tenant.sales_pricing_rules WHERE organization_id=$1 AND status='active' AND (company_id IS NULL OR company_id=$2) AND (party_id IS NULL OR party_id=$3) AND (party_type IS NULL OR party_type=$4 OR party_type='both') AND (item_id IS NULL OR item_id=$5) AND (item_group_id IS NULL OR item_group_id=(SELECT group_id FROM tenant.items WHERE id=$5)) AND (price_list_id IS NULL OR price_list_id=$6) AND minimum_quantity<=$7 AND (valid_from IS NULL OR valid_from<=current_date) AND (valid_to IS NULL OR valid_to>=current_date) ORDER BY priority,id`,
    [
      context.organizationId,
      master.companyId,
      master.partyId,
      master.party.party_type,
      itemId,
      master.priceList?.id || null,
      asDatabaseDecimal(quantity),
    ],
  );
  let calculatedUnitPrice = listUnitPrice;
  for (const rule of rules.rows) {
    const value = decimal(rule.adjustment_value);
    if (rule.adjustment_type === "discount_percent")
      calculatedUnitPrice = sub(
        calculatedUnitPrice,
        percent(calculatedUnitPrice, value),
      );
    if (rule.adjustment_type === "discount_amount")
      calculatedUnitPrice = max(0, sub(calculatedUnitPrice, value));
    if (rule.adjustment_type === "fixed_rate") calculatedUnitPrice = value;
    appliedRules.push({
      id: rule.id,
      code: rule.code,
      type: rule.adjustment_type,
      value: formatDecimal(value),
    });
  }
  const requestedUnitPrice =
    line.unitPrice == null || line.unitPrice === ""
      ? calculatedUnitPrice
      : decimal(line.unitPrice);
  const manualOverride = requestedUnitPrice !== calculatedUnitPrice;
  if (manualOverride) {
    requirePermission(context, "sales.price.override");
    if (!text(line.manualPriceReason, 1000))
      throw new SalesError(
        400,
        `Line ${sequence} requires a manual price reason.`,
      );
  }
  const discountPercent = decimal(line.discountPercent || 0);
  if (discountPercent < 0n || discountPercent > decimal(100))
    throw new SalesError(
      400,
      `Line ${sequence} discount must be between 0 and 100.`,
    );
  const gross = mul(quantity, requestedUnitPrice);
  const discountAmount = roundMoney(
    percent(gross, discountPercent),
    master.currency.decimal_places,
  );
  let netAmount = roundMoney(
    sub(gross, discountAmount),
    master.currency.decimal_places,
  );

  let taxRate = decimal(0);
  let components = [];
  if (
    item.tax_category_id &&
    input.supplyType !== "exempt" &&
    input.supplyType !== "non_gst" &&
    input.supplyType !== "export"
  ) {
    const rateResult = await client.query(
      `SELECT tax_type,rate,name,code FROM tenant.tax_rates WHERE organization_id=$1 AND tax_category_id=$2 AND (company_id=$3 OR company_id IS NULL) AND status='active' AND (effective_from IS NULL OR effective_from<=current_date) AND (effective_to IS NULL OR effective_to>=current_date) ORDER BY company_id NULLS LAST,effective_from DESC NULLS LAST,rate DESC LIMIT 1`,
      [context.organizationId, item.tax_category_id, master.companyId],
    );
    const rate = rateResult.rows[0];
    if (rate) {
      taxRate = decimal(rate.rate);
      const sellerState = String(
        master.settings.seller_state_code || "",
      ).trim();
      const buyerState = String(
        input.placeOfSupply ||
          master.shipping.row?.state_code ||
          master.billing.row?.state_code ||
          "",
      ).trim();
      const intra = sellerState && buyerState && sellerState === buyerState;
      if (rate.tax_type === "gst" && intra)
        components = [
          { type: "cgst", label: "CGST", rate: div(taxRate, 2) },
          { type: "sgst", label: "SGST", rate: div(taxRate, 2) },
        ];
      else if (rate.tax_type === "gst")
        components = [{ type: "igst", label: "IGST", rate: taxRate }];
      else
        components = [{ type: rate.tax_type, label: rate.name, rate: taxRate }];
    }
  }
  let taxableAmount = netAmount;
  let taxAmount = decimal(0);
  if (master.priceList?.tax_inclusive && taxRate > 0n) {
    taxableAmount = roundMoney(
      div(mul(netAmount, 100), add(100, taxRate)),
      master.currency.decimal_places,
    );
    taxAmount = sub(netAmount, taxableAmount);
    netAmount = taxableAmount;
  } else
    taxAmount = roundMoney(
      percent(taxableAmount, taxRate),
      master.currency.decimal_places,
    );
  const taxLines = components.map((component, index) => ({
    sequence: index + 1,
    taxType: component.type,
    label: component.label,
    rate: asDatabaseDecimal(component.rate),
    taxableAmount: asDatabaseDecimal(taxableAmount),
    taxAmount: asDatabaseDecimal(
      roundMoney(
        percent(taxableAmount, component.rate),
        master.currency.decimal_places,
      ),
    ),
  }));
  const costAmount = roundMoney(
    mul(baseQuantity, decimal(item.standard_cost || 0)),
    master.currency.decimal_places,
  );
  const lineTotal = add(netAmount, taxAmount);
  const marginAmount = sub(netAmount, costAmount);
  const marginPercent =
    netAmount === 0n ? 0n : mul(div(marginAmount, netAmount), 100);
  if (line.warehouseId) {
    const warehouse = await client.query(
      `SELECT 1 FROM tenant.warehouses WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='active'`,
      [
        context.organizationId,
        master.companyId,
        uuid(line.warehouseId, `Line ${sequence} warehouse`),
      ],
    );
    if (!warehouse.rows[0])
      throw new SalesError(
        409,
        `Line ${sequence} warehouse is inactive or belongs to another company.`,
      );
  }
  return {
    sequence,
    itemId,
    uomId,
    warehouseId: line.warehouseId || null,
    itemCodeSnapshot: item.code,
    itemNameSnapshot: item.name,
    descriptionSnapshot: text(line.description, 4000) || item.description,
    hsnSacSnapshot: item.hsn_sac_code,
    uomSnapshot: uomCode,
    quantity: asDatabaseDecimal(quantity),
    baseQuantity: asDatabaseDecimal(baseQuantity),
    conversionFactor: asDatabaseDecimal(conversionFactor),
    listUnitPrice: asDatabaseDecimal(listUnitPrice),
    unitPrice: asDatabaseDecimal(requestedUnitPrice),
    discountPercent: asDatabaseDecimal(discountPercent),
    discountAmount: asDatabaseDecimal(discountAmount),
    netAmount: asDatabaseDecimal(netAmount),
    taxAmount: asDatabaseDecimal(taxAmount),
    lineTotal: asDatabaseDecimal(lineTotal),
    standardCost: asDatabaseDecimal(item.standard_cost || 0),
    costAmount: asDatabaseDecimal(costAmount),
    marginAmount: asDatabaseDecimal(marginAmount),
    marginPercent: asDatabaseDecimal(marginPercent),
    taxCategoryId: item.tax_category_id,
    requestedDeliveryDate: date(
      line.requestedDeliveryDate,
      `Line ${sequence} requested delivery date`,
    ),
    manualPriceOverride: manualOverride,
    manualPriceReason: manualOverride
      ? text(line.manualPriceReason, 1000)
      : null,
    pricingTrace: {
      priceSource,
      listPrice: asDatabaseDecimal(listUnitPrice),
      calculatedUnitPrice: asDatabaseDecimal(calculatedUnitPrice),
      finalUnitPrice: asDatabaseDecimal(requestedUnitPrice),
      appliedRules,
      manualOverride,
    },
    taxTrace: taxLines,
    taxLines,
  };
}

export async function previewSalesDocument(
  client,
  context,
  input,
  options = {},
) {
  if (!Array.isArray(input.lines) || !input.lines.length)
    throw new SalesError(400, "Add at least one item line.");
  if (input.lines.length > 500)
    throw new SalesError(400, "A document cannot contain more than 500 lines.");
  const master = await loadDocumentContext(client, context, input, options);
  const lines = [];
  for (let i = 0; i < input.lines.length; i++)
    lines.push(
      await calculateLine(
        client,
        context,
        master,
        input.lines[i],
        i + 1,
        input,
      ),
    );
  let subtotal = decimal(0),
    discountTotal = decimal(0),
    taxTotal = decimal(0),
    costTotal = decimal(0),
    maximumDiscount = decimal(0);
  for (const line of lines) {
    subtotal = add(subtotal, line.netAmount);
    discountTotal = add(discountTotal, line.discountAmount);
    taxTotal = add(taxTotal, line.taxAmount);
    costTotal = add(costTotal, line.costAmount);
    maximumDiscount = max(maximumDiscount, line.discountPercent);
  }
  const charges = [];
  let chargeTotal = decimal(0);
  for (let i = 0; i < (input.charges || []).length; i++) {
    const charge = input.charges[i];
    const value = decimal(charge.value);
    if (value < 0n)
      throw new SalesError(400, "Charge values cannot be negative.");
    const amount = roundMoney(
      charge.calculationType === "percentage"
        ? percent(subtotal, value)
        : value,
      master.currency.decimal_places,
    );
    chargeTotal = add(chargeTotal, amount);
    charges.push({
      sequence: i + 1,
      chargeType: charge.chargeType || "other",
      label: text(charge.label, 120) || "Charge",
      calculationType: charge.calculationType,
      value: asDatabaseDecimal(value),
      amount: asDatabaseDecimal(amount),
      taxable: charge.taxable !== false,
    });
  }
  // Header/document-level discount: a single reduction across the whole
  // document total, distinct from per-line discounts. Applied after tax
  // (tax was already computed on each line's own pre-header-discount
  // taxable amount, so this never retroactively adjusts a tax line) -
  // matches how the "charges" (freight/handling) layer already sits
  // outside line-level calculation. Folded into discountTotal/
  // maximumDiscount so it's visible in reporting and still caught by
  // submitQuotation's discount-threshold approval gate.
  const headerDiscountPercent = decimal(input.headerDiscountPercent || 0);
  if (headerDiscountPercent < 0n || headerDiscountPercent > decimal(100))
    throw new SalesError(400, "Header discount must be between 0 and 100.");
  if (headerDiscountPercent > 0n)
    requirePermission(context, "sales.price.override");
  const headerDiscountAmount = roundMoney(
    percent(subtotal, headerDiscountPercent),
    master.currency.decimal_places,
  );
  discountTotal = add(discountTotal, headerDiscountAmount);
  maximumDiscount = max(maximumDiscount, headerDiscountPercent);
  const beforeRounding = sub(
    add(subtotal, chargeTotal, taxTotal),
    headerDiscountAmount,
  );
  const grandTotal = roundMoney(beforeRounding, master.currency.decimal_places);
  const roundingAdjustment = sub(grandTotal, beforeRounding);
  const baseCurrencyTotal = roundMoney(
    mul(grandTotal, master.exchangeRate),
    master.currency.decimal_places,
  );
  const marginAmount = sub(subtotal, costTotal);
  const marginPercent =
    subtotal === 0n ? 0n : mul(div(marginAmount, subtotal), 100);
  const snapshots = {
    customer: {
      id: master.party.id,
      code: master.party.code,
      displayName: master.party.display_name,
      legalName: master.party.legal_name,
      gstin: master.party.gstin,
      pan: master.party.pan,
      partyType: master.party.party_type,
    },
    contact: master.contact || {},
    billingAddress: master.billing.row || {},
    shippingAddress: master.shipping.row || {},
    paymentTerm: master.paymentTerm || {},
  };
  return {
    master,
    lines,
    charges,
    snapshots,
    totals: {
      subtotal: asDatabaseDecimal(subtotal),
      discountTotal: asDatabaseDecimal(discountTotal),
      chargeTotal: asDatabaseDecimal(chargeTotal),
      taxTotal: asDatabaseDecimal(taxTotal),
      roundingAdjustment: asDatabaseDecimal(roundingAdjustment),
      grandTotal: asDatabaseDecimal(grandTotal),
      baseCurrencyTotal: asDatabaseDecimal(baseCurrencyTotal),
      costTotal: asDatabaseDecimal(costTotal),
      marginAmount: asDatabaseDecimal(marginAmount),
      marginPercent: asDatabaseDecimal(marginPercent),
      maximumDiscountPercent: asDatabaseDecimal(maximumDiscount),
      headerDiscountPercent: asDatabaseDecimal(headerDiscountPercent),
      headerDiscountAmount: asDatabaseDecimal(headerDiscountAmount),
    },
    pricingTrace: lines.map((line) => ({
      sequence: line.sequence,
      ...line.pricingTrace,
    })),
    taxTrace: lines.flatMap((line) =>
      line.taxTrace.map((tax) => ({ lineSequence: line.sequence, ...tax })),
    ),
  };
}

async function insertQuotationVersion(
  client,
  context,
  quotationId,
  input,
  preview,
) {
  const next = await client.query(
    `SELECT COALESCE(max(version_number),0)+1 AS version FROM tenant.sales_quotation_versions WHERE organization_id=$1 AND quotation_id=$2`,
    [context.organizationId, quotationId],
  );
  const versionNumber = Number(next.rows[0].version);
  const contentHash = sha256(
    stable({
      input,
      preview: {
        lines: preview.lines,
        charges: preview.charges,
        totals: preview.totals,
      },
    }),
  );
  const version = await client.query(
    `INSERT INTO tenant.sales_quotation_versions (organization_id,quotation_id,version_number,revision_reason,currency_code,base_currency_code,exchange_rate,price_list_id,payment_term_id,billing_address_id,shipping_address_id,customer_snapshot,contact_snapshot,billing_address_snapshot,shipping_address_snapshot,payment_term_snapshot,delivery_terms,shipping_method,incoterm,place_of_supply,supply_type,internal_notes,customer_notes,terms_and_conditions,subtotal,discount_total,charge_total,tax_total,rounding_adjustment,grand_total,base_currency_total,cost_total,margin_amount,margin_percent,maximum_discount_percent,pricing_trace,tax_trace,content_hash,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36::jsonb,$37::jsonb,$38,$39) RETURNING *`,
    [
      context.organizationId,
      quotationId,
      versionNumber,
      text(input.revisionReason, 1000),
      preview.master.currencyCode,
      preview.master.baseCurrencyCode,
      asDatabaseDecimal(preview.master.exchangeRate),
      preview.master.priceList?.id || null,
      preview.master.paymentTerm?.id || null,
      preview.master.billing.id,
      preview.master.shipping.id,
      JSON.stringify(preview.snapshots.customer),
      JSON.stringify(preview.snapshots.contact),
      JSON.stringify(preview.snapshots.billingAddress),
      JSON.stringify(preview.snapshots.shippingAddress),
      JSON.stringify(preview.snapshots.paymentTerm),
      text(input.deliveryTerms),
      text(input.shippingMethod),
      text(input.incoterm, 40),
      text(input.placeOfSupply, 80),
      input.supplyType || "domestic",
      text(input.internalNotes, 10000),
      text(input.customerNotes, 10000),
      text(input.termsAndConditions, 20000),
      preview.totals.subtotal,
      preview.totals.discountTotal,
      preview.totals.chargeTotal,
      preview.totals.taxTotal,
      preview.totals.roundingAdjustment,
      preview.totals.grandTotal,
      preview.totals.baseCurrencyTotal,
      preview.totals.costTotal,
      preview.totals.marginAmount,
      preview.totals.marginPercent,
      preview.totals.maximumDiscountPercent,
      JSON.stringify(preview.pricingTrace),
      JSON.stringify(preview.taxTrace),
      contentHash,
      context.userId,
    ],
  );
  const versionId = version.rows[0].id;
  for (const line of preview.lines) {
    const inserted = await client.query(
      `INSERT INTO tenant.sales_quotation_lines (organization_id,quotation_version_id,sequence,item_id,uom_id,warehouse_id,item_code_snapshot,item_name_snapshot,description_snapshot,hsn_sac_snapshot,uom_snapshot,quantity,base_quantity,conversion_factor,list_unit_price,unit_price,discount_percent,discount_amount,net_amount,tax_amount,line_total,standard_cost,cost_amount,margin_amount,margin_percent,tax_category_id,requested_delivery_date,manual_price_override,manual_price_reason,pricing_trace,tax_trace,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb,$32) RETURNING id`,
      [
        context.organizationId,
        versionId,
        line.sequence,
        line.itemId,
        line.uomId,
        line.warehouseId,
        line.itemCodeSnapshot,
        line.itemNameSnapshot,
        line.descriptionSnapshot,
        line.hsnSacSnapshot,
        line.uomSnapshot,
        line.quantity,
        line.baseQuantity,
        line.conversionFactor,
        line.listUnitPrice,
        line.unitPrice,
        line.discountPercent,
        line.discountAmount,
        line.netAmount,
        line.taxAmount,
        line.lineTotal,
        line.standardCost,
        line.costAmount,
        line.marginAmount,
        line.marginPercent,
        line.taxCategoryId,
        line.requestedDeliveryDate,
        line.manualPriceOverride,
        line.manualPriceReason,
        JSON.stringify(line.pricingTrace),
        JSON.stringify(line.taxTrace),
        context.userId,
      ],
    );
    for (const tax of line.taxLines)
      await client.query(
        `INSERT INTO tenant.sales_quotation_tax_lines (organization_id,quotation_version_id,quotation_line_id,sequence,tax_type,label,rate,taxable_amount,tax_amount) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          context.organizationId,
          versionId,
          inserted.rows[0].id,
          tax.sequence,
          tax.taxType,
          tax.label,
          tax.rate,
          tax.taxableAmount,
          tax.taxAmount,
        ],
      );
  }
  for (const charge of preview.charges)
    await client.query(
      `INSERT INTO tenant.sales_quotation_charges (organization_id,quotation_version_id,sequence,charge_type,label,calculation_type,value,amount,taxable,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [
        context.organizationId,
        versionId,
        charge.sequence,
        charge.chargeType,
        charge.label,
        charge.calculationType,
        charge.value,
        charge.amount,
        charge.taxable,
        context.userId,
      ],
    );
  await client.query(
    `UPDATE tenant.sales_quotations SET current_version_id=$1,company_id=$2,branch_id=$3,party_id=$4,contact_id=$5,owner_user_id=$6,source_opportunity_id=COALESCE($7,source_opportunity_id),valid_until=$8,lifecycle_status='draft',approval_status='not_required',acceptance_status='not_sent',updated_by=$9,updated_at=now() WHERE organization_id=$10 AND id=$11`,
    [
      versionId,
      preview.master.companyId,
      preview.master.branchId,
      preview.master.partyId,
      preview.master.contact?.id || null,
      preview.master.ownerUserId,
      input.opportunityId || null,
      date(input.validUntil, "Valid until", true),
      context.userId,
      context.organizationId,
      quotationId,
    ],
  );
  return version.rows[0];
}

export async function createQuotation(client, context, input) {
  requirePermission(context, "sales.quotation.create");
  const preview = await previewSalesDocument(client, context, input);
  const number = await allocateNumber(
    client,
    context.organizationId,
    "quotation",
  );
  const result = await client.query(
    `INSERT INTO tenant.sales_quotations (organization_id,company_id,branch_id,quotation_number,source_opportunity_id,party_id,contact_id,owner_user_id,valid_until,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$10) RETURNING id,quotation_number`,
    [
      context.organizationId,
      preview.master.companyId,
      preview.master.branchId,
      number,
      input.opportunityId || null,
      preview.master.partyId,
      preview.master.contact?.id || null,
      preview.master.ownerUserId,
      date(input.validUntil, "Valid until", true),
      context.userId,
    ],
  );
  const quotation = result.rows[0];
  const version = await insertQuotationVersion(
    client,
    context,
    quotation.id,
    input,
    preview,
  );
  await event(
    client,
    context,
    "quotation",
    quotation.id,
    "quotation.created",
    null,
    "draft",
    { versionId: version.id, versionNumber: version.version_number },
  );
  return { ...quotation, currentVersionId: version.id };
}
export async function reviseQuotation(client, context, id, input) {
  requirePermission(context, "sales.quotation.create");
  const quote = await lockQuotation(client, context, id);
  if (["accepted", "converted", "cancelled"].includes(quote.lifecycle_status))
    throw new SalesError(409, "This quotation can no longer be revised.");
  const preview = await previewSalesDocument(client, context, input);
  await client.query(
    `UPDATE public.approval_requests SET status='cancelled',decided_at=now(),decision_note='Quotation was revised.',updated_at=now() WHERE organization_id=$1 AND entity_type='sales_quotation' AND entity_id=$2 AND status='pending'`,
    [context.organizationId, id],
  );
  await revokeQuoteLinks(client, context, id);
  const version = await insertQuotationVersion(
    client,
    context,
    id,
    input,
    preview,
  );
  await event(
    client,
    context,
    "quotation",
    id,
    "quotation.revised",
    quote.lifecycle_status,
    "draft",
    { versionId: version.id, versionNumber: version.version_number },
  );
  return version;
}

async function lockQuotation(client, context, id) {
  const result = await client.query(
    `SELECT * FROM tenant.sales_quotations WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, uuid(id, "Quotation")],
  );
  if (!result.rows[0]) throw new SalesError(404, "Quotation not found.");
  return result.rows[0];
}
async function lockOrder(client, context, id) {
  const result = await client.query(
    `SELECT * FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
    [context.organizationId, uuid(id, "Sales order")],
  );
  if (!result.rows[0]) throw new SalesError(404, "Sales order not found.");
  return result.rows[0];
}
async function event(
  client,
  context,
  entityType,
  entityId,
  eventType,
  fromStatus,
  toStatus,
  metadata = {},
) {
  await client.query(
    `INSERT INTO tenant.sales_document_events (organization_id,entity_type,entity_id,event_type,from_status,to_status,metadata,actor_user_id) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      context.organizationId,
      entityType,
      entityId,
      eventType,
      fromStatus,
      toStatus,
      JSON.stringify(metadata),
      context.userId || null,
    ],
  );
}
async function revokeQuoteLinks(client, context, quotationId) {
  const links = await client.query(
    `UPDATE tenant.sales_quote_share_links SET revoked_at=COALESCE(revoked_at,now()) WHERE organization_id=$1 AND quotation_id=$2 AND revoked_at IS NULL RETURNING token_hash`,
    [context.organizationId, quotationId],
  );
  for (const link of links.rows)
    await client.query(
      `UPDATE public.sales_public_quote_tokens SET revoked_at=COALESCE(revoked_at,now()) WHERE token_hash=$1`,
      [link.token_hash],
    );
}

export async function listQuotations(client, context, filters = {}) {
  requirePermission(context, "sales.view");
  const values = [context.organizationId];
  let where = "";
  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    where += ` AND quotation.lifecycle_status=$${values.length}`;
  }
  if (filters.search) {
    values.push(`%${String(filters.search).trim()}%`);
    where += ` AND (quotation.quotation_number ILIKE $${values.length} OR version.customer_snapshot->>'displayName' ILIKE $${values.length})`;
  }
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND quotation.company_id=$${values.length}`;
  }
  const limit = Math.min(
    500,
    Math.max(1, Number.parseInt(filters.limit, 10) || 200),
  );
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  values.push(limit, offset);
  const result = await client.query(
    `SELECT quotation.id,quotation.quotation_number,quotation.lifecycle_status,quotation.approval_status,quotation.acceptance_status,quotation.valid_until,quotation.updated_at,version.version_number,version.currency_code,version.grand_total,version.base_currency_total,version.customer_snapshot->>'displayName' AS customer_name,quotation.owner_user_id FROM tenant.sales_quotations quotation JOIN tenant.sales_quotation_versions version ON version.id=quotation.current_version_id WHERE quotation.organization_id=$1${where} ORDER BY quotation.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows.map((row) => redactMargin(row, context));
}
export async function getQuotation(client, context, id, publicView = false) {
  if (!publicView) requirePermission(context, "sales.view");
  const result = await client.query(
    `SELECT quotation.*,version.*,quotation.id AS quotation_id,quotation.created_at AS quotation_created_at,quotation.updated_at AS quotation_updated_at FROM tenant.sales_quotations quotation JOIN tenant.sales_quotation_versions version ON version.id=quotation.current_version_id WHERE quotation.organization_id=$1 AND quotation.id=$2`,
    [context.organizationId, uuid(id, "Quotation")],
  );
  const quote = result.rows[0];
  if (!quote) throw new SalesError(404, "Quotation not found.");
  const lines = await client.query(
    `SELECT * FROM tenant.sales_quotation_lines WHERE organization_id=$1 AND quotation_version_id=$2 ORDER BY sequence`,
    [context.organizationId, quote.current_version_id],
  );
  const charges = await client.query(
    `SELECT * FROM tenant.sales_quotation_charges WHERE organization_id=$1 AND quotation_version_id=$2 ORDER BY sequence`,
    [context.organizationId, quote.current_version_id],
  );
  const versions = publicView
    ? []
    : (
        await client.query(
          `SELECT id,version_number,revision_reason,grand_total,currency_code,created_at,created_by FROM tenant.sales_quotation_versions WHERE organization_id=$1 AND quotation_id=$2 ORDER BY version_number DESC`,
          [context.organizationId, id],
        )
      ).rows;
  const events = publicView
    ? []
    : (
        await client.query(
          `SELECT event_type,from_status,to_status,metadata,occurred_at,actor_user_id FROM tenant.sales_document_events WHERE organization_id=$1 AND entity_type='quotation' AND entity_id=$2 ORDER BY occurred_at DESC`,
          [context.organizationId, id],
        )
      ).rows;
  return redactMargin(
    {
      quotation: quote,
      lines: lines.rows,
      charges: charges.rows,
      versions,
      events,
    },
    publicView ? { permissions: [], roleSlugs: [] } : context,
    publicView,
  );
}
function redactMargin(value, context, publicView = false) {
  if (!publicView && hasPermission(context, "sales.margin.view")) return value;
  const protectedKeys = new Set([
    "standard_cost",
    "cost_amount",
    "cost_total",
    "margin_amount",
    "margin_percent",
  ]);
  function walk(item) {
    if (Array.isArray(item)) return item.map(walk);
    if (item && typeof item === "object") {
      const output = {};
      for (const [key, v] of Object.entries(item))
        if (!protectedKeys.has(key)) output[key] = walk(v);
      return output;
    }
    return item;
  }
  return walk(value);
}

export async function submitQuotation(client, context, id, assignedTo = null) {
  requirePermission(context, "sales.quotation.create");
  const quote = await lockQuotation(client, context, id);
  if (quote.lifecycle_status !== "draft")
    throw new SalesError(409, "Only draft quotations can be submitted.");
  const version = (
    await client.query(
      `SELECT grand_total,maximum_discount_percent,margin_percent FROM tenant.sales_quotation_versions WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, quote.current_version_id],
    )
  ).rows[0];
  const settings =
    (
      await client.query(
        `SELECT * FROM tenant.sales_settings WHERE organization_id=$1`,
        [context.organizationId],
      )
    ).rows[0] || {};
  const required =
    (decimal(settings.quotation_approval_amount || 0) > 0n &&
      decimal(version.grand_total) >=
        decimal(settings.quotation_approval_amount)) ||
    decimal(version.maximum_discount_percent) >
      decimal(settings.quotation_approval_discount || 100) ||
    decimal(version.margin_percent) <
      decimal(settings.minimum_margin_percent || -100);
  if (!required) {
    await client.query(
      `UPDATE tenant.sales_quotations SET lifecycle_status='approved',approval_status='not_required',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
      [context.userId, context.organizationId, id],
    );
    await event(
      client,
      context,
      "quotation",
      id,
      "quotation.approved_automatically",
      "draft",
      "approved",
      { versionId: quote.current_version_id },
    );
    return { approvalRequired: false };
  }
  const approvalId = cryptoRandomUuid();
  await client.query(
    `INSERT INTO public.approval_requests (id,organization_id,entity_type,entity_id,title,status,requested_by,assigned_to,command_key,command_payload) VALUES ($1,$2,'sales_quotation',$3,$4,'pending',$5,$6,'sales.quotation.approve',$7::jsonb)`,
    [
      approvalId,
      context.organizationId,
      id,
      `Approve quotation ${quote.quotation_number}`,
      context.userId,
      assignedTo || null,
      JSON.stringify({
        quotationId: id,
        quotationVersionId: quote.current_version_id,
      }),
    ],
  );
  await client.query(
    `UPDATE tenant.sales_quotations SET lifecycle_status='pending_approval',approval_status='pending',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, id],
  );
  await event(
    client,
    context,
    "quotation",
    id,
    "quotation.submitted",
    "draft",
    "pending_approval",
    { approvalId, versionId: quote.current_version_id },
  );
  return { approvalRequired: true, approvalId };
}
function cryptoRandomUuid() {
  const bytes = randomBytes(16);
  bytes[6] = (bytes[6] & 15) | 64;
  bytes[8] = (bytes[8] & 63) | 128;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
export async function approveQuotation(
  client,
  context,
  quotationId,
  quotationVersionId,
) {
  requirePermission(context, "sales.quotation.approve");
  const quote = await lockQuotation(client, context, quotationId);
  if (quote.current_version_id !== quotationVersionId)
    throw new SalesError(
      409,
      "The quotation was revised after this approval was requested.",
    );
  if (quote.lifecycle_status !== "pending_approval")
    throw new SalesError(409, "The quotation is not awaiting approval.");
  await client.query(
    `UPDATE tenant.sales_quotations SET lifecycle_status='approved',approval_status='approved',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, quotationId],
  );
  await event(
    client,
    context,
    "quotation",
    quotationId,
    "quotation.approved",
    "pending_approval",
    "approved",
    { versionId: quotationVersionId },
  );
  return { quotationId, quotationVersionId, status: "approved" };
}
export async function rejectQuotationApproval(client, context, quotationId) {
  const quote = await lockQuotation(client, context, quotationId);
  if (quote.lifecycle_status === "pending_approval") {
    await client.query(
      `UPDATE tenant.sales_quotations SET lifecycle_status='draft',approval_status='rejected',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
      [context.userId, context.organizationId, quotationId],
    );
    await event(
      client,
      context,
      "quotation",
      quotationId,
      "quotation.approval_rejected",
      "pending_approval",
      "draft",
    );
  }
}

export async function sendQuotation(client, context, id, expiresInDays = 30) {
  requirePermission(context, "sales.quotation.send");
  const quote = await lockQuotation(client, context, id);
  if (quote.lifecycle_status !== "approved")
    throw new SalesError(409, "Only approved quotations can be sent.");
  await revokeQuoteLinks(client, context, id);
  const token = randomBytes(32).toString("base64url"),
    tokenHash = sha256(token);
  const expiresAt = new Date(
    Date.now() +
      Math.max(1, Math.min(90, Number(expiresInDays || 30))) * 86400000,
  );
  await client.query(
    `INSERT INTO tenant.sales_quote_share_links (organization_id,quotation_id,quotation_version_id,token_hash,expires_at,created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      context.organizationId,
      id,
      quote.current_version_id,
      tokenHash,
      expiresAt,
      context.userId,
    ],
  );
  await client.query(
    `INSERT INTO public.sales_public_quote_tokens (token_hash,organization_id,quotation_id,quotation_version_id,expires_at) VALUES ($1,$2,$3,$4,$5)`,
    [
      tokenHash,
      context.organizationId,
      id,
      quote.current_version_id,
      expiresAt,
    ],
  );
  await client.query(
    `UPDATE tenant.sales_quotations SET lifecycle_status='sent',acceptance_status='pending',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, id],
  );
  await event(
    client,
    context,
    "quotation",
    id,
    "quotation.sent",
    "approved",
    "sent",
    { versionId: quote.current_version_id, expiresAt },
  );
  return { token, expiresAt, quotationNumber: quote.quotation_number };
}
export async function resolvePublicQuoteToken(
  client,
  context,
  tokenHash,
  trackView = true,
) {
  const linkResult = await client.query(
    `SELECT * FROM tenant.sales_quote_share_links WHERE organization_id=$1 AND token_hash=$2 FOR UPDATE`,
    [context.organizationId, tokenHash],
  );
  const link = linkResult.rows[0];
  if (
    !link ||
    link.revoked_at ||
    new Date(link.expires_at).getTime() <= Date.now()
  )
    throw new SalesError(
      410,
      "This quotation link has expired or was revoked.",
    );
  const quote = await lockQuotation(client, context, link.quotation_id);
  if (quote.current_version_id !== link.quotation_version_id)
    throw new SalesError(410, "A newer quotation revision is available.");
  // The share LINK's own expiry (checked above) is a separate, independently
  // configured access window (1-90 days from send) - it says nothing about
  // whether the quotation's own commercial offer is still valid. Without this
  // check a customer could accept pricing/terms past valid_until as long as
  // their link happened to still be live.
  const validUntilDate = new Date(quote.valid_until).toISOString().slice(0, 10);
  const todayDate = new Date().toISOString().slice(0, 10);
  if (validUntilDate < todayDate)
    throw new SalesError(410, "This quotation has expired.");
  if (trackView) {
    await client.query(
      `UPDATE tenant.sales_quote_share_links SET first_viewed_at=COALESCE(first_viewed_at,now()),last_viewed_at=now(),view_count=view_count+1 WHERE id=$1`,
      [link.id],
    );
    if (quote.lifecycle_status === "sent") {
      await client.query(
        `UPDATE tenant.sales_quotations SET lifecycle_status='viewed',updated_at=now() WHERE id=$1`,
        [quote.id],
      );
      await event(
        client,
        { ...context, userId: null },
        "quotation",
        quote.id,
        "quotation.viewed",
        "sent",
        "viewed",
      );
    }
  }
  return {
    link,
    quotation: await getQuotation(client, context, quote.id, true),
  };
}
export async function recordPublicQuoteDecision(
  client,
  context,
  tokenHash,
  input,
  metadata = {},
) {
  const resolved = await resolvePublicQuoteToken(
    client,
    context,
    tokenHash,
    false,
  );
  const decision = input.decision;
  if (!["accepted", "rejected"].includes(decision))
    throw new SalesError(400, "Choose accept or reject.");
  const name = text(input.customerName, 200);
  if (!name) throw new SalesError(400, "Customer name is required.");
  const quote = resolved.quotation.quotation;
  const existing = await client.query(
    `SELECT 1 FROM tenant.sales_quote_decisions WHERE organization_id=$1 AND quotation_id=$2`,
    [context.organizationId, quote.quotation_id],
  );
  if (existing.rows[0])
    throw new SalesError(409, "A decision has already been recorded.");
  await client.query(
    `INSERT INTO tenant.sales_quote_decisions (organization_id,quotation_id,quotation_version_id,share_link_id,decision,customer_name,customer_email,customer_title,typed_signature,note,ip_address,user_agent,recorded_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [
      context.organizationId,
      quote.quotation_id,
      quote.current_version_id,
      resolved.link.id,
      decision,
      name,
      text(input.customerEmail, 320),
      text(input.customerTitle, 160),
      text(input.typedSignature, 300),
      text(input.note, 4000),
      metadata.ipAddress || null,
      metadata.userAgent || null,
      context.userId || null,
    ],
  );
  await client.query(
    `UPDATE tenant.sales_quotations SET lifecycle_status=$1,acceptance_status=$1,accepted_at=CASE WHEN $1='accepted' THEN now() ELSE accepted_at END,rejected_at=CASE WHEN $1='rejected' THEN now() ELSE rejected_at END,updated_by=COALESCE($2,updated_by),updated_at=now() WHERE organization_id=$3 AND id=$4`,
    [
      decision,
      context.userId || null,
      context.organizationId,
      quote.quotation_id,
    ],
  );
  await revokeQuoteLinks(client, context, quote.quotation_id);
  await event(
    client,
    context,
    "quotation",
    quote.quotation_id,
    `quotation.${decision}`,
    quote.lifecycle_status,
    decision,
    { versionId: quote.current_version_id, customerName: name },
  );
  return { quotationId: quote.quotation_id, decision };
}

// F038 gap: valid_until was stored and reportable but nothing ever
// transitioned a quotation to 'expired' - only an offer actively presented
// to a customer (approved/sent/viewed, never a draft that was never sent)
// can go stale. Naturally idempotent: the same WHERE clause that selects a
// row is what excludes it from a later run, so a retried/concurrent scan
// can't double-fire the same transition (same pattern as
// scanLeadSlaBreaches/detectOverdueActivitiesHandler on the CRM side).
export async function scanExpiredQuotations(client, context) {
  requirePermission(context, "sales.settings.manage");
  const result = await client.query(
    `UPDATE tenant.sales_quotations
        SET lifecycle_status='expired',updated_at=now()
      WHERE organization_id=$1 AND lifecycle_status IN ('approved','sent','viewed')
        AND valid_until < current_date
      RETURNING id,current_version_id`,
    [context.organizationId],
  );
  for (const row of result.rows) {
    await event(
      client,
      { ...context, userId: null },
      "quotation",
      row.id,
      "quotation.expired",
      null,
      "expired",
      { versionId: row.current_version_id },
    );
  }
  return { scanned: result.rowCount ?? result.rows.length, expired: result.rows.length };
}

async function insertOrderFromPreview(
  client,
  context,
  input,
  preview,
  source = {},
) {
  const number = await allocateNumber(
    client,
    context.organizationId,
    "sales_order",
  );
  const orderResult = await client.query(
    `INSERT INTO tenant.sales_orders (organization_id,company_id,branch_id,sales_order_number,source_quotation_id,source_quotation_version_id,source_opportunity_id,party_id,contact_id,owner_user_id,order_date,requested_delivery_date,created_by,updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,COALESCE($11,current_date),$12,$13,$13) RETURNING *`,
    [
      context.organizationId,
      preview.master.companyId,
      preview.master.branchId,
      number,
      source.quotationId || null,
      source.quotationVersionId || null,
      input.opportunityId || source.opportunityId || null,
      preview.master.partyId,
      preview.master.contact?.id || null,
      preview.master.ownerUserId,
      date(input.orderDate, "Order date"),
      date(input.requestedDeliveryDate, "Requested delivery date"),
      context.userId,
    ],
  );
  const order = orderResult.rows[0];
  const contentHash = sha256(
    stable({
      input,
      preview: {
        lines: preview.lines,
        charges: preview.charges,
        totals: preview.totals,
      },
    }),
  );
  const versionResult = await client.query(
    `INSERT INTO tenant.sales_order_versions (organization_id,sales_order_id,version_number,amendment_reason,currency_code,base_currency_code,exchange_rate,price_list_id,payment_term_id,billing_address_id,shipping_address_id,customer_snapshot,contact_snapshot,billing_address_snapshot,shipping_address_snapshot,payment_term_snapshot,customer_po_number,customer_po_date,priority,delivery_terms,shipping_method,incoterm,place_of_supply,supply_type,internal_notes,customer_notes,terms_and_conditions,subtotal,discount_total,charge_total,tax_total,rounding_adjustment,grand_total,base_currency_total,cost_total,margin_amount,margin_percent,pricing_trace,tax_trace,content_hash,created_by) VALUES ($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11::jsonb,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37::jsonb,$38::jsonb,$39,$40) RETURNING *`,
    [
      context.organizationId,
      order.id,
      text(input.amendmentReason, 1000),
      preview.master.currencyCode,
      preview.master.baseCurrencyCode,
      asDatabaseDecimal(preview.master.exchangeRate),
      preview.master.priceList?.id || null,
      preview.master.paymentTerm?.id || null,
      preview.master.billing.id,
      preview.master.shipping.id,
      JSON.stringify(preview.snapshots.customer),
      JSON.stringify(preview.snapshots.contact),
      JSON.stringify(preview.snapshots.billingAddress),
      JSON.stringify(preview.snapshots.shippingAddress),
      JSON.stringify(preview.snapshots.paymentTerm),
      text(input.customerPoNumber, 120),
      date(input.customerPoDate, "Customer PO date"),
      input.priority || "normal",
      text(input.deliveryTerms),
      text(input.shippingMethod),
      text(input.incoterm, 40),
      text(input.placeOfSupply, 80),
      input.supplyType || "domestic",
      text(input.internalNotes, 10000),
      text(input.customerNotes, 10000),
      text(input.termsAndConditions, 20000),
      preview.totals.subtotal,
      preview.totals.discountTotal,
      preview.totals.chargeTotal,
      preview.totals.taxTotal,
      preview.totals.roundingAdjustment,
      preview.totals.grandTotal,
      preview.totals.baseCurrencyTotal,
      preview.totals.costTotal,
      preview.totals.marginAmount,
      preview.totals.marginPercent,
      JSON.stringify(preview.pricingTrace),
      JSON.stringify(preview.taxTrace),
      contentHash,
      context.userId,
    ],
  );
  const version = versionResult.rows[0];
  for (const line of preview.lines) {
    const inserted = await client.query(
      `INSERT INTO tenant.sales_order_lines (organization_id,sales_order_version_id,source_quotation_line_id,sequence,item_id,uom_id,warehouse_id,item_code_snapshot,item_name_snapshot,description_snapshot,hsn_sac_snapshot,uom_snapshot,quantity,base_quantity,conversion_factor,list_unit_price,unit_price,discount_percent,discount_amount,net_amount,tax_amount,line_total,standard_cost,cost_amount,margin_amount,margin_percent,tax_category_id,requested_delivery_date,promised_delivery_date,pricing_trace,tax_trace,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30::jsonb,$31::jsonb,$32) RETURNING id`,
      [
        context.organizationId,
        version.id,
        line.sourceQuotationLineId || null,
        line.sequence,
        line.itemId,
        line.uomId,
        line.warehouseId,
        line.itemCodeSnapshot,
        line.itemNameSnapshot,
        line.descriptionSnapshot,
        line.hsnSacSnapshot,
        line.uomSnapshot,
        line.quantity,
        line.baseQuantity,
        line.conversionFactor,
        line.listUnitPrice,
        line.unitPrice,
        line.discountPercent,
        line.discountAmount,
        line.netAmount,
        line.taxAmount,
        line.lineTotal,
        line.standardCost,
        line.costAmount,
        line.marginAmount,
        line.marginPercent,
        line.taxCategoryId,
        line.requestedDeliveryDate,
        line.requestedDeliveryDate,
        JSON.stringify(line.pricingTrace),
        JSON.stringify(line.taxTrace),
        context.userId,
      ],
    );
    await client.query(
      `INSERT INTO tenant.sales_order_line_progress (organization_id,sales_order_line_id,confirmed_quantity,updated_by) VALUES ($1,$2,0,$3)`,
      [context.organizationId, inserted.rows[0].id, context.userId],
    );
    await client.query(
      `INSERT INTO tenant.sales_order_schedules (organization_id,sales_order_line_id,sequence,requested_date,promised_date,quantity,updated_by) VALUES ($1,$2,1,$3,$3,$4,$5)`,
      [
        context.organizationId,
        inserted.rows[0].id,
        line.requestedDeliveryDate,
        line.quantity,
        context.userId,
      ],
    );
  }
  await client.query(
    `UPDATE tenant.sales_orders SET current_version_id=$1 WHERE organization_id=$2 AND id=$3`,
    [version.id, context.organizationId, order.id],
  );
  await event(
    client,
    context,
    "sales_order",
    order.id,
    "sales_order.created",
    null,
    "draft",
    { versionId: version.id },
  );
  return { ...order, current_version_id: version.id };
}
export async function createSalesOrder(client, context, input) {
  requirePermission(context, "sales.order.create");
  const preview = await previewSalesDocument(client, context, input, {
    order: true,
  });
  return insertOrderFromPreview(client, context, input, preview);
}
export async function convertQuotationToOrder(client, context, id) {
  requirePermission(context, "sales.order.create");
  const quote = await lockQuotation(client, context, id);
  if (quote.converted_order_id)
    return { orderId: quote.converted_order_id, idempotent: true };
  if (quote.lifecycle_status !== "accepted")
    throw new SalesError(409, "Only an accepted quotation can be converted.");
  const detail = await getQuotation(client, context, id);
  const q = detail.quotation;
  const input = {
    companyId: q.company_id,
    branchId: q.branch_id,
    partyId: q.party_id,
    contactId: q.contact_id,
    opportunityId: q.source_opportunity_id,
    ownerUserId: q.owner_user_id,
    currencyCode: q.currency_code,
    exchangeRate: q.exchange_rate,
    priceListId: q.price_list_id,
    paymentTermId: q.payment_term_id,
    billingAddressId: q.billing_address_id,
    shippingAddressId: q.shipping_address_id,
    requestedDeliveryDate: null,
    deliveryTerms: q.delivery_terms,
    shippingMethod: q.shipping_method,
    incoterm: q.incoterm,
    placeOfSupply: q.place_of_supply,
    supplyType: q.supply_type,
    internalNotes: q.internal_notes,
    customerNotes: q.customer_notes,
    termsAndConditions: q.terms_and_conditions,
    lines: detail.lines.map((line) => ({
      itemId: line.item_id,
      uomId: line.uom_id,
      warehouseId: line.warehouse_id,
      description: line.description_snapshot,
      quantity: line.quantity,
      unitPrice: line.unit_price,
      discountPercent: line.discount_percent,
      requestedDeliveryDate: line.requested_delivery_date,
      manualPriceReason: line.manual_price_reason,
    })),
    charges: detail.charges.map((charge) => ({
      chargeType: charge.charge_type,
      label: charge.label,
      calculationType: charge.calculation_type,
      value: charge.value,
      taxable: charge.taxable,
    })),
  };
  const preview = await previewSalesDocument(client, context, input, {
    order: true,
  });
  const order = await insertOrderFromPreview(client, context, input, preview, {
    quotationId: id,
    quotationVersionId: quote.current_version_id,
    opportunityId: quote.source_opportunity_id,
  });
  const updated = await client.query(
    `UPDATE tenant.sales_quotations SET lifecycle_status='converted',converted_order_id=$1,updated_by=$2,updated_at=now() WHERE organization_id=$3 AND id=$4 AND converted_order_id IS NULL RETURNING id`,
    [order.id, context.userId, context.organizationId, id],
  );
  if (!updated.rows[0]) {
    const latest = await lockQuotation(client, context, id);
    return { orderId: latest.converted_order_id, idempotent: true };
  }
  await event(
    client,
    context,
    "quotation",
    id,
    "quotation.converted",
    "accepted",
    "converted",
    { orderId: order.id },
  );
  return { orderId: order.id, idempotent: false };
}

export async function listSalesOrders(client, context, filters = {}) {
  requirePermission(context, "sales.view");
  const values = [context.organizationId];
  let where = "";
  if (filters.status && filters.status !== "all") {
    values.push(filters.status);
    where += ` AND sales_order.lifecycle_status=$${values.length}`;
  }
  if (filters.search) {
    values.push(`%${String(filters.search).trim()}%`);
    where += ` AND (sales_order.sales_order_number ILIKE $${values.length} OR version.customer_snapshot->>'displayName' ILIKE $${values.length})`;
  }
  if (!context.allowAllCompanies && context.activeCompanyId) {
    values.push(context.activeCompanyId);
    where += ` AND sales_order.company_id=$${values.length}`;
  }
  const limit = Math.min(
    500,
    Math.max(1, Number.parseInt(filters.limit, 10) || 200),
  );
  const offset = Math.max(0, Number.parseInt(filters.offset, 10) || 0);
  values.push(limit, offset);
  const result = await client.query(
    `SELECT sales_order.id,sales_order.sales_order_number,sales_order.lifecycle_status,sales_order.approval_status,sales_order.credit_status,sales_order.fulfillment_status,sales_order.billing_status,sales_order.order_date,sales_order.requested_delivery_date,sales_order.updated_at,version.currency_code,version.grand_total,version.base_currency_total,version.customer_snapshot->>'displayName' AS customer_name FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id=sales_order.current_version_id WHERE sales_order.organization_id=$1${where} ORDER BY sales_order.updated_at DESC LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  return result.rows.map((row) => redactMargin(row, context));
}
export async function getSalesOrder(client, context, id) {
  requirePermission(context, "sales.view");
  const result = await client.query(
    `SELECT sales_order.*,version.*,sales_order.id AS sales_order_id,sales_order.created_at AS order_created_at,sales_order.updated_at AS order_updated_at FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id=sales_order.current_version_id WHERE sales_order.organization_id=$1 AND sales_order.id=$2`,
    [context.organizationId, uuid(id, "Sales order")],
  );
  const order = result.rows[0];
  if (!order) throw new SalesError(404, "Sales order not found.");
  const lines = await client.query(
    `SELECT line.*,progress.confirmed_quantity,progress.reserved_quantity,progress.fulfilled_quantity,progress.invoiced_quantity,progress.returned_quantity,progress.cancelled_quantity,(line.quantity-progress.fulfilled_quantity-progress.cancelled_quantity) AS remaining_to_fulfill,(line.quantity-progress.invoiced_quantity-progress.cancelled_quantity) AS remaining_to_invoice FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id WHERE line.organization_id=$1 AND line.sales_order_version_id=$2 ORDER BY line.sequence`,
    [context.organizationId, order.current_version_id],
  );
  const holds = await client.query(
    `SELECT * FROM tenant.sales_order_holds WHERE organization_id=$1 AND sales_order_id=$2 ORDER BY placed_at DESC`,
    [context.organizationId, id],
  );
  const fulfillment = await client.query(
    `SELECT id,request_number,status,retry_count,last_error,requested_at,completed_at FROM tenant.sales_fulfillment_requests WHERE organization_id=$1 AND sales_order_id=$2 ORDER BY requested_at DESC`,
    [context.organizationId, id],
  );
  const invoices = await client.query(
    `SELECT id,request_number,quantity_basis,status,retry_count,last_error,requested_at,completed_at FROM tenant.sales_invoice_requests WHERE organization_id=$1 AND sales_order_id=$2 ORDER BY requested_at DESC`,
    [context.organizationId, id],
  );
  const events = await client.query(
    `SELECT * FROM tenant.sales_document_events WHERE organization_id=$1 AND entity_type='sales_order' AND entity_id=$2 ORDER BY occurred_at DESC`,
    [context.organizationId, id],
  );
  return redactMargin(
    {
      order,
      lines: lines.rows,
      holds: holds.rows,
      fulfillmentRequests: fulfillment.rows,
      invoiceRequests: invoices.rows,
      events: events.rows,
    },
    context,
  );
}
export async function submitSalesOrder(client, context, id, assignedTo = null) {
  requirePermission(context, "sales.order.create");
  const order = await lockOrder(client, context, id);
  if (order.lifecycle_status !== "draft")
    throw new SalesError(409, "Only draft orders can be submitted.");
  const version = (
    await client.query(
      `SELECT grand_total FROM tenant.sales_order_versions WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, order.current_version_id],
    )
  ).rows[0];
  const settings =
    (
      await client.query(
        `SELECT order_approval_amount FROM tenant.sales_settings WHERE organization_id=$1`,
        [context.organizationId],
      )
    ).rows[0] || {};
  const approvalRequired =
    decimal(settings.order_approval_amount || 0) > 0n &&
    decimal(version.grand_total || 0) >=
      decimal(settings.order_approval_amount || 0);
  if (!approvalRequired) {
    await client.query(
      `UPDATE tenant.sales_orders
          SET lifecycle_status='approved',approval_status='not_required',updated_by=$1,updated_at=now()
        WHERE organization_id=$2 AND id=$3 AND lifecycle_status='draft'`,
      [context.userId, context.organizationId, id],
    );
    await event(
      client,
      context,
      "sales_order",
      id,
      "sales_order.approved_automatically",
      "draft",
      "approved",
      { versionId: order.current_version_id },
    );
    return {
      approvalRequired: false,
      orderId: id,
      orderVersionId: order.current_version_id,
    };
  }
  const approvalId = cryptoRandomUuid();
  await client.query(
    `INSERT INTO public.approval_requests
      (id,organization_id,entity_type,entity_id,title,status,requested_by,assigned_to,command_key,command_payload)
     VALUES ($1,$2,'sales_order',$3,$4,'pending',$5,$6,'sales.order.approve',$7::jsonb)`,
    [
      approvalId,
      context.organizationId,
      id,
      `Approve sales order ${order.sales_order_number}`,
      context.userId,
      assignedTo || null,
      JSON.stringify({ orderId: id, orderVersionId: order.current_version_id }),
    ],
  );
  await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status='pending_approval',approval_status='pending',updated_by=$1,updated_at=now()
      WHERE organization_id=$2 AND id=$3 AND lifecycle_status='draft'`,
    [context.userId, context.organizationId, id],
  );
  await event(
    client,
    context,
    "sales_order",
    id,
    "sales_order.submitted",
    "draft",
    "pending_approval",
    { approvalId, versionId: order.current_version_id },
  );
  return {
    approvalRequired: true,
    approvalId,
    orderId: id,
    orderVersionId: order.current_version_id,
  };
}

export async function approveSalesOrder(
  client,
  context,
  orderId,
  orderVersionId,
) {
  requirePermission(context, "sales.order.approve");
  const order = await lockOrder(client, context, orderId);
  if (order.current_version_id !== orderVersionId)
    throw new SalesError(
      409,
      "The sales order was amended after approval was requested.",
    );
  if (order.lifecycle_status !== "pending_approval")
    throw new SalesError(409, "The sales order is not awaiting approval.");
  await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status='approved',approval_status='approved',updated_by=$1,updated_at=now()
      WHERE organization_id=$2 AND id=$3 AND lifecycle_status='pending_approval' AND current_version_id=$4`,
    [context.userId, context.organizationId, orderId, orderVersionId],
  );
  await event(
    client,
    context,
    "sales_order",
    orderId,
    "sales_order.approved",
    "pending_approval",
    "approved",
    { versionId: orderVersionId },
  );
  return { orderId, orderVersionId, status: "approved" };
}

export async function rejectSalesOrderApproval(client, context, orderId) {
  const order = await lockOrder(client, context, orderId);
  if (order.lifecycle_status !== "pending_approval") return;
  await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status='draft',approval_status='rejected',updated_by=$1,updated_at=now()
      WHERE organization_id=$2 AND id=$3 AND lifecycle_status='pending_approval'`,
    [context.userId, context.organizationId, orderId],
  );
  await event(
    client,
    context,
    "sales_order",
    orderId,
    "sales_order.approval_rejected",
    "pending_approval",
    "draft",
    { versionId: order.current_version_id },
  );
}

export async function confirmSalesOrder(client, context, id, options = {}) {
  requirePermission(context, "sales.order.confirm");
  let order = await lockOrder(client, context, id);
  if (order.lifecycle_status === "draft") {
    const submission = await submitSalesOrder(
      client,
      context,
      id,
      options.assignedTo || null,
    );
    if (submission.approvalRequired)
      throw new SalesError(
        409,
        "This order requires approval before confirmation.",
        "SALES_ORDER_APPROVAL_REQUIRED",
      );
    order = await lockOrder(client, context, id);
  }
  if (order.lifecycle_status === "pending_approval")
    throw new SalesError(
      409,
      "This order is awaiting approval.",
      "SALES_ORDER_APPROVAL_REQUIRED",
    );
  if (order.lifecycle_status !== "approved")
    throw new SalesError(409, "Only an approved order can be confirmed.");
  await client.query(`SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, [
    `sales-credit:${context.organizationId}:${order.party_id}`,
  ]);
  const version = (
    await client.query(
      `SELECT grand_total,base_currency_total FROM tenant.sales_order_versions WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, order.current_version_id],
    )
  ).rows[0];
  const party = (
    await client.query(
      `SELECT credit_limit FROM tenant.business_parties WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, order.party_id],
    )
  ).rows[0];
  const exposure = (
    await client.query(
      `SELECT COALESCE(sum(version.base_currency_total),0) AS exposure
       FROM tenant.sales_orders active_order
       JOIN tenant.sales_order_versions version ON version.id=active_order.current_version_id
      WHERE active_order.organization_id=$1 AND active_order.party_id=$2 AND active_order.id<>$3
        AND active_order.lifecycle_status IN ('confirmed','on_hold')
        AND active_order.billing_status<>'fully_invoiced'`,
      [context.organizationId, order.party_id, id],
    )
  ).rows[0];
  const creditLimit = decimal(party.credit_limit || 0);
  const totalExposure = add(
    exposure.exposure || 0,
    version.base_currency_total || 0,
  );
  let creditStatus = "passed";
  if (creditLimit > 0n && totalExposure > creditLimit) creditStatus = "blocked";
  if (creditStatus === "blocked") {
    if (!options.overrideCredit)
      throw new SalesError(
        409,
        "Customer credit limit is exceeded. A finance override is required.",
        "SALES_CREDIT_BLOCK",
      );
    requirePermission(context, "sales.credit.override");
    if (!text(options.creditOverrideReason, 1000))
      throw new SalesError(400, "A credit override reason is required.");
    creditStatus = "overridden";
  }
  const confirmed = await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status='confirmed',credit_status=$1,fulfillment_status='not_started',billing_status='ready',
            confirmed_at=now(),updated_by=$2,updated_at=now()
      WHERE organization_id=$3 AND id=$4 AND lifecycle_status='approved' AND current_version_id=$5
      RETURNING id`,
    [
      creditStatus,
      context.userId,
      context.organizationId,
      id,
      order.current_version_id,
    ],
  );
  if (!confirmed.rows[0])
    throw new SalesError(
      409,
      "The order changed before it could be confirmed.",
      "SALES_ORDER_VERSION_CONFLICT",
    );
  await client.query(
    `UPDATE tenant.sales_order_line_progress progress SET confirmed_quantity=line.quantity,updated_by=$1,updated_at=now()
       FROM tenant.sales_order_lines line
      WHERE progress.sales_order_line_id=line.id AND line.organization_id=$2 AND line.sales_order_version_id=$3`,
    [context.userId, context.organizationId, order.current_version_id],
  );
  await event(
    client,
    context,
    "sales_order",
    id,
    "sales_order.confirmed",
    "approved",
    "confirmed",
    {
      creditStatus,
      creditExposure: asDatabaseDecimal(totalExposure),
      creditOverrideReason: text(options.creditOverrideReason, 1000),
    },
  );
  // Closing a source CRM opportunity is CRM's own domain concern (governed
  // stage transitions, outcome reasons, stage-history snapshots) - Sales
  // only reports whether one exists. See
  // orchestration/sales-crm-opportunity-sync.js's confirmSalesOrderWithCrmSync
  // for the actual cross-module call.
  return {
    orderId: id,
    status: "confirmed",
    creditStatus,
    sourceOpportunityId: order.source_opportunity_id || null,
  };
}

export async function placeOrderHold(client, context, id, input) {
  requirePermission(context, "sales.order.hold");
  const order = await lockOrder(client, context, id);
  if (!["confirmed", "on_hold"].includes(order.lifecycle_status))
    throw new SalesError(409, "Only confirmed orders can be placed on hold.");
  const reason = text(input.reason, 2000);
  if (!reason) throw new SalesError(400, "A hold reason is required.");
  const result = await client.query(
    `INSERT INTO tenant.sales_order_holds (organization_id,sales_order_id,hold_type,reason,placed_by) VALUES ($1,$2,$3,$4,$5) RETURNING id`,
    [
      context.organizationId,
      id,
      input.holdType || "other",
      reason,
      context.userId,
    ],
  );
  await client.query(
    `UPDATE tenant.sales_orders SET lifecycle_status='on_hold',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, id],
  );
  await event(
    client,
    context,
    "sales_order",
    id,
    "sales_order.hold_placed",
    order.lifecycle_status,
    "on_hold",
    { holdId: result.rows[0].id, holdType: input.holdType || "other", reason },
  );
  return result.rows[0];
}
export async function releaseOrderHold(client, context, id, input) {
  requirePermission(context, "sales.order.hold");
  const order = await lockOrder(client, context, id);
  const holdId = uuid(input.holdId, "Hold");
  const updated = await client.query(
    `UPDATE tenant.sales_order_holds SET status='released',released_by=$1,released_at=now(),release_note=$2 WHERE organization_id=$3 AND sales_order_id=$4 AND id=$5 AND status='active' RETURNING id`,
    [
      context.userId,
      text(input.note, 2000),
      context.organizationId,
      id,
      holdId,
    ],
  );
  if (!updated.rows[0]) throw new SalesError(404, "Active hold not found.");
  const remaining = await client.query(
    `SELECT 1 FROM tenant.sales_order_holds WHERE organization_id=$1 AND sales_order_id=$2 AND status='active' LIMIT 1`,
    [context.organizationId, id],
  );
  if (!remaining.rows[0])
    await client.query(
      `UPDATE tenant.sales_orders SET lifecycle_status='confirmed',updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
      [context.userId, context.organizationId, id],
    );
  await event(
    client,
    context,
    "sales_order",
    id,
    "sales_order.hold_released",
    "on_hold",
    remaining.rows[0] ? "on_hold" : "confirmed",
    { holdId, note: text(input.note, 2000) },
  );
  return { holdId };
}
export async function cancelSalesOrder(client, context, id, reason) {
  requirePermission(context, "sales.order.cancel");
  const order = await lockOrder(client, context, id);
  if (["cancelled", "closed"].includes(order.lifecycle_status))
    throw new SalesError(409, "This order is already closed.");
  const progress = await client.query(
    `SELECT COALESCE(sum(progress.fulfilled_quantity),0) AS fulfilled,COALESCE(sum(progress.invoiced_quantity),0) AS invoiced FROM tenant.sales_order_lines line JOIN tenant.sales_order_line_progress progress ON progress.sales_order_line_id=line.id WHERE line.organization_id=$1 AND line.sales_order_version_id=$2`,
    [context.organizationId, order.current_version_id],
  );
  if (
    decimal(progress.rows[0].fulfilled) > 0n ||
    decimal(progress.rows[0].invoiced) > 0n
  )
    throw new SalesError(
      409,
      "Orders with fulfilment or invoicing activity cannot be cancelled directly.",
    );
  const note = text(reason, 2000);
  if (!note) throw new SalesError(400, "A cancellation reason is required.");
  await client.query(
    `UPDATE tenant.sales_orders SET lifecycle_status='cancelled',fulfillment_status='cancelled',billing_status='blocked',cancelled_at=now(),updated_by=$1,updated_at=now() WHERE organization_id=$2 AND id=$3`,
    [context.userId, context.organizationId, id],
  );
  await event(
    client,
    context,
    "sales_order",
    id,
    "sales_order.cancelled",
    order.lifecycle_status,
    "cancelled",
    { reason: note },
  );
  return {
    orderId: id,
    status: "cancelled",
    sourceOpportunityId: order.source_opportunity_id || null,
    companyId: order.company_id,
  };
}

async function buildHandoffPayload(
  client,
  context,
  order,
  kind,
  quantityBasis = "ordered",
) {
  const detail = await getSalesOrder(client, context, order.id);
  const lines = detail.lines
    .map((line) => {
      const ordered = decimal(line.quantity),
        fulfilled = decimal(line.fulfilled_quantity || 0),
        invoiced = decimal(line.invoiced_quantity || 0),
        cancelled = decimal(line.cancelled_quantity || 0);
      const eligible = quantityBasis === "fulfilled" ? fulfilled : ordered;
      const remaining = max(0, sub(sub(eligible, invoiced), cancelled));
      return {
        salesOrderLineId: line.id,
        itemId: line.item_id,
        warehouseId: line.warehouse_id,
        uomId: line.uom_id,
        quantity: line.quantity,
        baseQuantity: line.base_quantity,
        remainingQuantity: asDatabaseDecimal(
          kind === "invoice"
            ? remaining
            : max(0, sub(sub(ordered, fulfilled), cancelled)),
        ),
        unitPrice: line.unit_price,
        taxAmount: line.tax_amount,
        lineTotal: line.line_total,
      };
    })
    .filter((line) => decimal(line.remainingQuantity) > 0n);
  if (!lines.length)
    throw new SalesError(
      409,
      kind === "invoice"
        ? "No quantity remains to invoice."
        : "No quantity remains to fulfil.",
    );
  return {
    salesOrderId: order.id,
    salesOrderNumber: order.sales_order_number,
    salesOrderVersionId: order.current_version_id,
    companyId: order.company_id,
    branchId: order.branch_id,
    partyId: order.party_id,
    quantityBasis,
    lines,
  };
}
export async function createFulfillmentRequest(
  client,
  context,
  id,
  idempotencyKey,
) {
  requirePermission(context, "sales.fulfillment.request");
  const order = await lockOrder(client, context, id);
  if (order.lifecycle_status !== "confirmed")
    throw new SalesError(409, "Only confirmed orders can request fulfilment.");
  const key = text(idempotencyKey, 200);
  if (!key) throw new SalesError(400, "An idempotency key is required.");
  const existing = await client.query(
    `SELECT id,request_number,status FROM tenant.sales_fulfillment_requests WHERE organization_id=$1 AND idempotency_key=$2`,
    [context.organizationId, key],
  );
  if (existing.rows[0]) return { ...existing.rows[0], idempotent: true };
  const payload = await buildHandoffPayload(
    client,
    context,
    order,
    "fulfillment",
  );
  const number = await allocateNumber(
    client,
    context.organizationId,
    "sales_fulfillment_request",
  );
  const result = await client.query(
    `INSERT INTO tenant.sales_fulfillment_requests (organization_id,request_number,sales_order_id,sales_order_version_id,idempotency_key,payload,requested_by) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7) RETURNING id,request_number,status`,
    [
      context.organizationId,
      number,
      id,
      order.current_version_id,
      key,
      JSON.stringify(payload),
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "sales_order",
    id,
    "sales_order.fulfillment_requested",
    order.lifecycle_status,
    order.lifecycle_status,
    { requestId: result.rows[0].id, requestNumber: number },
  );
  return { ...result.rows[0], idempotent: false };
}
export async function createInvoiceRequest(client, context, id, input) {
  requirePermission(context, "sales.invoice.request");
  const order = await lockOrder(client, context, id);
  if (order.lifecycle_status !== "confirmed")
    throw new SalesError(409, "Only confirmed orders can request invoicing.");
  const key = text(input.idempotencyKey, 200);
  if (!key) throw new SalesError(400, "An idempotency key is required.");
  const basis = input.quantityBasis || "ordered";
  if (!["ordered", "fulfilled"].includes(basis))
    throw new SalesError(400, "Invoice quantity basis is invalid.");
  const existing = await client.query(
    `SELECT id,request_number,status FROM tenant.sales_invoice_requests WHERE organization_id=$1 AND idempotency_key=$2`,
    [context.organizationId, key],
  );
  if (existing.rows[0]) return { ...existing.rows[0], idempotent: true };
  const payload = await buildHandoffPayload(
    client,
    context,
    order,
    "invoice",
    basis,
  );
  const number = await allocateNumber(
    client,
    context.organizationId,
    "sales_invoice_request",
  );
  const result = await client.query(
    `INSERT INTO tenant.sales_invoice_requests (organization_id,request_number,sales_order_id,sales_order_version_id,quantity_basis,idempotency_key,payload,requested_by) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8) RETURNING id,request_number,status`,
    [
      context.organizationId,
      number,
      id,
      order.current_version_id,
      basis,
      key,
      JSON.stringify(payload),
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "sales_order",
    id,
    "sales_order.invoice_requested",
    order.lifecycle_status,
    order.lifecycle_status,
    {
      requestId: result.rows[0].id,
      requestNumber: number,
      quantityBasis: basis,
    },
  );
  return { ...result.rows[0], idempotent: false };
}

export async function getSalesDashboard(client, context) {
  requirePermission(context, "sales.view");
  const companyFilter =
    !context.allowAllCompanies && context.activeCompanyId
      ? " AND company_id=$2"
      : "";
  const params =
    !context.allowAllCompanies && context.activeCompanyId
      ? [context.organizationId, context.activeCompanyId]
      : [context.organizationId];
  const result = await client.query(
    `SELECT (SELECT count(*) FROM tenant.sales_quotations WHERE organization_id=$1${companyFilter} AND lifecycle_status IN ('draft','pending_approval','approved','sent','viewed')) AS active_quotations,(SELECT count(*) FROM tenant.sales_quotations WHERE organization_id=$1${companyFilter} AND lifecycle_status IN ('sent','viewed') AND valid_until<=current_date+7) AS expiring_quotations,(SELECT count(*) FROM tenant.sales_quotations WHERE organization_id=$1${companyFilter} AND approval_status='pending') AS pending_quote_approvals,(SELECT COALESCE(sum(version.base_currency_total),0) FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id=sales_order.current_version_id WHERE sales_order.organization_id=$1${companyFilter.replaceAll("company_id", "sales_order.company_id")} AND sales_order.lifecycle_status='confirmed') AS confirmed_order_value,(SELECT count(*) FROM tenant.sales_orders WHERE organization_id=$1${companyFilter} AND lifecycle_status='on_hold') AS orders_on_hold,(SELECT count(*) FROM tenant.sales_orders WHERE organization_id=$1${companyFilter} AND billing_status='ready') AS ready_to_invoice`,
    params,
  );
  return result.rows[0];
}
export async function getSalesReport(client, context, key) {
  requirePermission(context, "sales.reports.view");
  if (key === "margin") requirePermission(context, "sales.margin.view");
  const allowed = new Set([
    "quotation-conversion",
    "order-intake",
    "expiring-quotations",
    "pending-approvals",
    "active-holds",
    "fulfillment",
    "billing-readiness",
    "customer-performance",
    "margin",
  ]);
  if (!allowed.has(key)) throw new SalesError(404, "Unknown Sales report.");
  // SECURITY: sales_quotations/sales_orders both carry a NOT NULL company_id,
  // so leaving these org-only (as they were) let a user restricted to one
  // company see every other company's quotations/orders/margins in reports -
  // same cross-company leak class fixed in getSalesOptions above, and the
  // same fail-closed semantics when there's no active company.
  const companyScoped = !context.allowAllCompanies;
  const companyId = companyScoped ? context.activeCompanyId || null : null;
  const companyClause = (column) =>
    companyScoped ? (companyId ? ` AND ${column}=$2` : " AND false") : "";
  const params =
    companyScoped && companyId
      ? [context.organizationId, companyId]
      : [context.organizationId];
  const queries = {
    "quotation-conversion": `SELECT date_trunc('month',created_at) AS period,count(*) AS quotations,count(*) FILTER (WHERE lifecycle_status IN ('accepted','converted')) AS accepted FROM tenant.sales_quotations WHERE organization_id=$1${companyClause("company_id")} GROUP BY 1 ORDER BY 1 DESC LIMIT 24`,
    "order-intake": `SELECT date_trunc('month',sales_order.order_date) AS period,count(*) AS orders,sum(version.base_currency_total) AS base_total FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id=sales_order.current_version_id WHERE sales_order.organization_id=$1${companyClause("sales_order.company_id")} AND sales_order.lifecycle_status IN ('confirmed','on_hold','closed') GROUP BY 1 ORDER BY 1 DESC LIMIT 24`,
    "expiring-quotations": `SELECT quotation.id,quotation.quotation_number,quotation.valid_until,version.customer_snapshot->>'displayName' AS customer,version.currency_code,version.grand_total FROM tenant.sales_quotations quotation JOIN tenant.sales_quotation_versions version ON version.id=quotation.current_version_id WHERE quotation.organization_id=$1${companyClause("quotation.company_id")} AND quotation.lifecycle_status IN ('sent','viewed') AND quotation.valid_until<=current_date+30 ORDER BY quotation.valid_until`,
    "pending-approvals": `SELECT id,quotation_number,lifecycle_status,approval_status,updated_at FROM tenant.sales_quotations WHERE organization_id=$1${companyClause("company_id")} AND approval_status='pending' ORDER BY updated_at`,
    "active-holds": `SELECT hold.id,sales_order.sales_order_number,hold.hold_type,hold.reason,hold.placed_at FROM tenant.sales_order_holds hold JOIN tenant.sales_orders sales_order ON sales_order.id=hold.sales_order_id WHERE hold.organization_id=$1${companyClause("sales_order.company_id")} AND hold.status='active' ORDER BY hold.placed_at`,
    fulfillment: `SELECT sales_order_number,fulfillment_status,requested_delivery_date,updated_at FROM tenant.sales_orders WHERE organization_id=$1${companyClause("company_id")} AND lifecycle_status IN ('confirmed','on_hold') ORDER BY requested_delivery_date NULLS LAST`,
    "billing-readiness": `SELECT sales_order_number,billing_status,payment_status,updated_at FROM tenant.sales_orders WHERE organization_id=$1${companyClause("company_id")} AND billing_status IN ('ready','partially_invoiced','blocked') ORDER BY updated_at DESC`,
    "customer-performance": `SELECT version.customer_snapshot->>'displayName' AS customer,count(*) AS orders,sum(version.base_currency_total) AS base_total FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id=sales_order.current_version_id WHERE sales_order.organization_id=$1${companyClause("sales_order.company_id")} AND sales_order.lifecycle_status IN ('confirmed','on_hold','closed') GROUP BY 1 ORDER BY base_total DESC NULLS LAST LIMIT 100`,
    margin: `SELECT sales_order.sales_order_number,version.customer_snapshot->>'displayName' AS customer,version.base_currency_total,version.cost_total,version.margin_amount,version.margin_percent FROM tenant.sales_orders sales_order JOIN tenant.sales_order_versions version ON version.id=sales_order.current_version_id WHERE sales_order.organization_id=$1${companyClause("sales_order.company_id")} ORDER BY sales_order.order_date DESC LIMIT 500`,
  };
  return (await client.query(queries[key], params)).rows;
}

export async function getSalesOptions(
  client,
  context,
  opportunityId = null,
  partyId = null,
) {
  requirePermission(context, "sales.view");
  // SECURITY: every one of these is an org-wide picker/lookup consumed while
  // creating or editing a quotation/order, so an unscoped query here leaks
  // every OTHER company's customers, contacts, addresses, items, warehouses
  // and CRM opportunities to a user restricted to one company - the same
  // company/branch boundary CRM's own getCrmOptions enforces via its
  // companyVisible() predicate. allowAllCompanies bypasses the filter
  // entirely (org owners/admins); otherwise a row is visible only if it has
  // no company_id (shared) or matches the caller's active company - and if
  // the caller has no active company at all, nothing company-scoped is
  // visible (fail closed), matching CRM's own semantics exactly.
  const companyScoped = !context.allowAllCompanies;
  const companyId = companyScoped ? context.activeCompanyId || null : null;
  const companyClause = (column = "company_id") =>
    companyScoped ? (companyId ? ` AND (${column} IS NULL OR ${column}=$2)` : " AND false") : "";
  const companyParams = companyScoped && companyId ? [companyId] : [];
  // Contacts/addresses join across every customer in the org; once a
  // specific customer is chosen this scopes to just its own records instead
  // of fetching every customer's contacts/addresses on every load.
  const partyFilterId = partyId ? uuid(partyId, "Customer") : null;
  const [
    companies,
    branches,
    parties,
    contacts,
    addresses,
    items,
    uoms,
    warehouses,
    priceLists,
    paymentTerms,
    currencies,
    users,
    opportunities,
  ] = await Promise.all([
    client.query(
      `SELECT id,name,legal_name,base_currency FROM public.companies WHERE organization_id=$1 ORDER BY is_primary DESC,name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,company_id,name,code FROM public.branches WHERE organization_id=$1 ORDER BY is_primary DESC,name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,company_id,code,party_type,display_name,legal_name,currency_code,credit_limit,payment_term_id FROM tenant.business_parties WHERE organization_id=$1 AND status='active' AND party_type IN ('customer','prospect','both')${companyClause()} ORDER BY display_name LIMIT 500`,
      [context.organizationId, ...companyParams],
    ),
    client.query(
      `SELECT contact.id,contact.party_id,contact.first_name,contact.last_name,contact.email,contact.mobile,contact.is_primary
         FROM tenant.contacts contact
         JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id
        WHERE contact.organization_id=$1 AND contact.status='active'${companyClause("party.company_id")}${partyFilterId ? ` AND contact.party_id=$${2 + companyParams.length}` : ""} ORDER BY contact.is_primary DESC,contact.first_name LIMIT 500`,
      partyFilterId
        ? [context.organizationId, ...companyParams, partyFilterId]
        : [context.organizationId, ...companyParams],
    ),
    client.query(
      `SELECT address.id,address.party_id,address.address_type,address.line1,address.city,address.state,address.state_code,address.postal_code,address.is_primary
         FROM tenant.addresses address
         JOIN tenant.business_parties party ON party.organization_id=address.organization_id AND party.id=address.party_id
        WHERE address.organization_id=$1 AND address.status='active'${companyClause("party.company_id")}${partyFilterId ? ` AND address.party_id=$${2 + companyParams.length}` : ""} ORDER BY address.is_primary DESC,address.city LIMIT 500`,
      partyFilterId
        ? [context.organizationId, ...companyParams, partyFilterId]
        : [context.organizationId, ...companyParams],
    ),
    client.query(
      `SELECT id,company_id,code,name,item_type,uom_id,sales_price,standard_cost,tax_category_id FROM tenant.items WHERE organization_id=$1 AND status='active'${companyClause()} ORDER BY name LIMIT 500`,
      [context.organizationId, ...companyParams],
    ),
    client.query(
      `SELECT id,code,name,decimal_places FROM tenant.units_of_measure WHERE organization_id=$1 AND status='active' ORDER BY category,name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,company_id,branch_id,code,name FROM tenant.warehouses WHERE organization_id=$1 AND status='active'${companyClause()} ORDER BY name LIMIT 500`,
      [context.organizationId, ...companyParams],
    ),
    client.query(
      `SELECT id,code,name,currency_code,tax_inclusive FROM tenant.price_lists WHERE organization_id=$1 AND price_list_type='sales' AND status='active' ORDER BY name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,code,name,default_due_days FROM tenant.payment_terms WHERE organization_id=$1 AND status='active' ORDER BY default_due_days,name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT code,name,symbol,decimal_places,is_base FROM tenant.currencies WHERE organization_id=$1 AND status='active' ORDER BY is_base DESC,code`,
      [context.organizationId],
    ),
    client.query(
      `SELECT users.id,users.full_name FROM public.organization_memberships membership JOIN public.users users ON users.id=membership.user_id WHERE membership.organization_id=$1 AND membership.status='active' AND users.status='active' ORDER BY users.full_name`,
      [context.organizationId],
    ),
    client.query(
      `SELECT id,company_id,branch_id,party_id,contact_id,owner_user_id,name,amount,currency_code,expected_close_date FROM tenant.crm_opportunities WHERE organization_id=$1 AND status='open'${companyClause()}${opportunityId ? ` AND id=$${2 + companyParams.length}` : ""} ORDER BY updated_at DESC LIMIT 200`,
      opportunityId
        ? [context.organizationId, ...companyParams, opportunityId]
        : [context.organizationId, ...companyParams],
    ),
  ]);
  let opportunityItems = [];
  if (opportunityId)
    opportunityItems = (
      await client.query(
        `SELECT opportunity_item.item_id,opportunity_item.price_list_id,opportunity_item.description,opportunity_item.quantity,opportunity_item.unit_price,opportunity_item.discount_percent,item.uom_id FROM tenant.crm_opportunity_items opportunity_item JOIN tenant.items item ON item.id=opportunity_item.item_id WHERE opportunity_item.organization_id=$1 AND opportunity_item.opportunity_id=$2 ORDER BY opportunity_item.created_at`,
        [context.organizationId, opportunityId],
      )
    ).rows;
  // SECURITY: item.standard_cost is otherwise gated everywhere (redactMargin
  // on quotation/order reads, sales.margin.view on the margin report) - the
  // options picker used while building a NEW document must not be the one
  // path that leaks it to any sales.view user regardless of that permission.
  return redactMargin(
    {
      companies: companies.rows,
      branches: branches.rows,
      parties: parties.rows,
      contacts: contacts.rows,
      addresses: addresses.rows,
      items: items.rows,
      uoms: uoms.rows,
      warehouses: warehouses.rows,
      priceLists: priceLists.rows,
      paymentTerms: paymentTerms.rows,
      currencies: currencies.rows,
      users: users.rows,
      opportunities: opportunities.rows,
      opportunityItems,
    },
    context,
  );
}

export async function amendSalesOrder(client, context, id, input) {
  requirePermission(context, "sales.order.amend");
  const order = await lockOrder(client, context, id);
  if (!["confirmed", "on_hold"].includes(order.lifecycle_status)) {
    throw new SalesError(409, "Only a confirmed or held order can be amended.");
  }
  const reason = text(input.amendmentReason, 1000);
  if (!reason) throw new SalesError(400, "An amendment reason is required.");
  const consumed = await client.query(
    `SELECT COALESCE(sum(progress.fulfilled_quantity+progress.invoiced_quantity+progress.returned_quantity),0) AS consumed
       FROM tenant.sales_order_line_progress progress
       JOIN tenant.sales_order_lines line ON line.id=progress.sales_order_line_id
      WHERE line.organization_id=$1 AND line.sales_order_version_id=$2`,
    [context.organizationId, order.current_version_id],
  );
  if (decimal(consumed.rows[0]?.consumed || 0) > 0n) {
    throw new SalesError(
      409,
      "An order with fulfilment, invoicing or return activity cannot be commercially amended. Use a controlled cancellation or downstream adjustment.",
    );
  }
  const preview = await previewSalesDocument(client, context, input, {
    order: true,
  });
  if (
    preview.master.companyId !== order.company_id ||
    preview.master.partyId !== order.party_id
  ) {
    throw new SalesError(
      409,
      "An amendment cannot change the order company or customer.",
    );
  }
  const current = (
    await client.query(
      `SELECT version_number,currency_code FROM tenant.sales_order_versions WHERE organization_id=$1 AND id=$2 FOR UPDATE`,
      [context.organizationId, order.current_version_id],
    )
  ).rows[0];
  if (!current)
    throw new SalesError(404, "Current sales-order version was not found.");
  if (current.currency_code !== preview.master.currencyCode) {
    throw new SalesError(409, "An amendment cannot change the order currency.");
  }
  const contentHash = sha256(
    stable({
      input,
      preview: {
        lines: preview.lines,
        charges: preview.charges,
        totals: preview.totals,
      },
    }),
  );
  const versionResult = await client.query(
    `INSERT INTO tenant.sales_order_versions (
       organization_id,sales_order_id,version_number,amendment_reason,currency_code,base_currency_code,
       exchange_rate,price_list_id,payment_term_id,billing_address_id,shipping_address_id,
       customer_snapshot,contact_snapshot,billing_address_snapshot,shipping_address_snapshot,payment_term_snapshot,
       customer_po_number,customer_po_date,priority,delivery_terms,shipping_method,incoterm,place_of_supply,supply_type,
       internal_notes,customer_notes,terms_and_conditions,subtotal,discount_total,charge_total,tax_total,
       rounding_adjustment,grand_total,base_currency_total,cost_total,margin_amount,margin_percent,
       pricing_trace,tax_trace,content_hash,created_by
     ) VALUES (
       $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb,$13::jsonb,$14::jsonb,$15::jsonb,$16::jsonb,
       $17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,$37,$38::jsonb,$39::jsonb,$40,$41
     ) RETURNING *`,
    [
      context.organizationId,
      order.id,
      Number(current.version_number) + 1,
      reason,
      preview.master.currencyCode,
      preview.master.baseCurrencyCode,
      asDatabaseDecimal(preview.master.exchangeRate),
      preview.master.priceList?.id || null,
      preview.master.paymentTerm?.id || null,
      preview.master.billing.id,
      preview.master.shipping.id,
      JSON.stringify(preview.snapshots.customer),
      JSON.stringify(preview.snapshots.contact),
      JSON.stringify(preview.snapshots.billingAddress),
      JSON.stringify(preview.snapshots.shippingAddress),
      JSON.stringify(preview.snapshots.paymentTerm),
      text(input.customerPoNumber, 120),
      date(input.customerPoDate, "Customer PO date"),
      input.priority || "normal",
      text(input.deliveryTerms),
      text(input.shippingMethod),
      text(input.incoterm, 40),
      text(input.placeOfSupply, 80),
      input.supplyType || "domestic",
      text(input.internalNotes, 10000),
      text(input.customerNotes, 10000),
      text(input.termsAndConditions, 20000),
      preview.totals.subtotal,
      preview.totals.discountTotal,
      preview.totals.chargeTotal,
      preview.totals.taxTotal,
      preview.totals.roundingAdjustment,
      preview.totals.grandTotal,
      preview.totals.baseCurrencyTotal,
      preview.totals.costTotal,
      preview.totals.marginAmount,
      preview.totals.marginPercent,
      JSON.stringify(preview.pricingTrace),
      JSON.stringify(preview.taxTrace),
      contentHash,
      context.userId,
    ],
  );
  const version = versionResult.rows[0];
  for (const line of preview.lines) {
    const inserted = await client.query(
      `INSERT INTO tenant.sales_order_lines (
        organization_id,sales_order_version_id,source_quotation_line_id,sequence,item_id,uom_id,warehouse_id,
        item_code_snapshot,item_name_snapshot,description_snapshot,hsn_sac_snapshot,uom_snapshot,quantity,
        base_quantity,conversion_factor,list_unit_price,unit_price,discount_percent,discount_amount,net_amount,
        tax_amount,line_total,standard_cost,cost_amount,margin_amount,margin_percent,tax_category_id,
        requested_delivery_date,promised_delivery_date,pricing_trace,tax_trace,created_by
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29::jsonb,$30::jsonb,$31) RETURNING id`,
      [
        context.organizationId,
        version.id,
        line.sourceQuotationLineId || null,
        line.sequence,
        line.itemId,
        line.uomId,
        line.warehouseId,
        line.itemCodeSnapshot,
        line.itemNameSnapshot,
        line.descriptionSnapshot,
        line.hsnSacSnapshot,
        line.uomSnapshot,
        line.quantity,
        line.baseQuantity,
        line.conversionFactor,
        line.listUnitPrice,
        line.unitPrice,
        line.discountPercent,
        line.discountAmount,
        line.netAmount,
        line.taxAmount,
        line.lineTotal,
        line.standardCost,
        line.costAmount,
        line.marginAmount,
        line.marginPercent,
        line.taxCategoryId,
        line.requestedDeliveryDate,
        line.requestedDeliveryDate,
        JSON.stringify(line.pricingTrace),
        JSON.stringify(line.taxTrace),
        context.userId,
      ],
    );
    await client.query(
      `INSERT INTO tenant.sales_order_line_progress (organization_id,sales_order_line_id,confirmed_quantity,updated_by)
       VALUES ($1,$2,$3,$4)`,
      [
        context.organizationId,
        inserted.rows[0].id,
        line.quantity,
        context.userId,
      ],
    );
    await client.query(
      `INSERT INTO tenant.sales_order_schedules (organization_id,sales_order_line_id,sequence,requested_date,promised_date,quantity,updated_by)
       VALUES ($1,$2,1,$3,$3,$4,$5)`,
      [
        context.organizationId,
        inserted.rows[0].id,
        line.requestedDeliveryDate,
        line.quantity,
        context.userId,
      ],
    );
  }
  const amendment = (
    await client.query(
      `INSERT INTO tenant.sales_order_amendments (organization_id,sales_order_id,from_version_id,to_version_id,reason,created_by)
     VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id`,
      [
        context.organizationId,
        order.id,
        order.current_version_id,
        version.id,
        reason,
        context.userId,
      ],
    )
  ).rows[0];
  const approvalId = cryptoRandomUuid();
  await client.query(
    `INSERT INTO public.approval_requests (
       id,organization_id,entity_type,entity_id,title,status,requested_by,
       command_key,command_payload
     ) VALUES (
       $1,$2,'sales_order_amendment',$3,$4,'pending',$5,
       'sales.order.amendment.approve',$6::jsonb
     )`,
    [
      approvalId,
      context.organizationId,
      order.id,
      `Approve amendment to sales order ${order.sales_order_number}`,
      context.userId,
      JSON.stringify({
        orderId: order.id,
        orderVersionId: version.id,
        previousVersionId: order.current_version_id,
        resumeStatus: order.lifecycle_status,
      }),
    ],
  );
  await client.query(
    `UPDATE tenant.sales_order_amendments
        SET approval_request_id=$1
      WHERE organization_id=$2 AND id=$3`,
    [approvalId, context.organizationId, amendment.id],
  );
  const updated = await client.query(
    `UPDATE tenant.sales_orders
        SET current_version_id=$1,lifecycle_status='pending_approval',
            approval_status='pending',updated_by=$2,updated_at=now()
      WHERE organization_id=$3 AND id=$4
        AND current_version_id=$5
        AND lifecycle_status=$6
      RETURNING id`,
    [
      version.id,
      context.userId,
      context.organizationId,
      order.id,
      order.current_version_id,
      order.lifecycle_status,
    ],
  );
  if (!updated.rows[0]) {
    throw new SalesError(
      409,
      "The order changed before the amendment approval was requested.",
      "SALES_ORDER_VERSION_CONFLICT",
    );
  }
  await event(
    client,
    context,
    "sales_order",
    order.id,
    "sales_order.amendment_submitted",
    order.lifecycle_status,
    "pending_approval",
    {
      approvalId,
      fromVersionId: order.current_version_id,
      toVersionId: version.id,
      reason,
      resumeStatus: order.lifecycle_status,
    },
  );
  return getSalesOrder(client, context, order.id);
}

export async function approveSalesOrderAmendment(
  client,
  context,
  orderId,
  orderVersionId,
  previousVersionId,
  resumeStatus,
) {
  requirePermission(context, "sales.order.approve");
  const order = await lockOrder(client, context, orderId);
  if (
    order.lifecycle_status !== "pending_approval" ||
    order.approval_status !== "pending"
  ) {
    throw new SalesError(409, "This order amendment is not awaiting approval.");
  }
  if (order.current_version_id !== orderVersionId) {
    throw new SalesError(
      409,
      "The order amendment changed after approval was requested.",
      "SALES_ORDER_VERSION_CONFLICT",
    );
  }
  if (!["confirmed", "on_hold"].includes(resumeStatus)) {
    throw new SalesError(400, "The amendment resume status is invalid.");
  }
  const amendment = await client.query(
    `SELECT id FROM tenant.sales_order_amendments
      WHERE organization_id=$1 AND sales_order_id=$2
        AND from_version_id=$3 AND to_version_id=$4`,
    [context.organizationId, orderId, previousVersionId, orderVersionId],
  );
  if (!amendment.rows[0]) {
    throw new SalesError(409, "The amendment lineage could not be verified.");
  }
  await client.query(
    `UPDATE tenant.sales_orders
        SET lifecycle_status=$3,approval_status='approved',
            updated_by=$4,updated_at=now()
      WHERE organization_id=$1 AND id=$2
        AND lifecycle_status='pending_approval'
        AND current_version_id=$5`,
    [
      context.organizationId,
      orderId,
      resumeStatus,
      context.userId,
      orderVersionId,
    ],
  );
  await event(
    client,
    context,
    "sales_order",
    orderId,
    "sales_order.amendment_approved",
    "pending_approval",
    resumeStatus,
    { orderVersionId, previousVersionId },
  );
  return { orderId, orderVersionId, status: resumeStatus };
}

export async function rejectSalesOrderAmendment(
  client,
  context,
  orderId,
  orderVersionId,
  previousVersionId,
  resumeStatus,
) {
  requirePermission(context, "sales.order.approve");
  const order = await lockOrder(client, context, orderId);
  if (
    order.lifecycle_status !== "pending_approval" ||
    order.current_version_id !== orderVersionId
  ) {
    throw new SalesError(409, "This order amendment is no longer current.");
  }
  if (!["confirmed", "on_hold"].includes(resumeStatus)) {
    throw new SalesError(400, "The amendment resume status is invalid.");
  }
  const restored = await client.query(
    `UPDATE tenant.sales_orders
        SET current_version_id=$3,lifecycle_status=$4,
            approval_status='rejected',updated_by=$5,updated_at=now()
      WHERE organization_id=$1 AND id=$2
        AND current_version_id=$6
        AND lifecycle_status='pending_approval'
      RETURNING id`,
    [
      context.organizationId,
      orderId,
      previousVersionId,
      resumeStatus,
      context.userId,
      orderVersionId,
    ],
  );
  if (!restored.rows[0]) {
    throw new SalesError(
      409,
      "The order changed before the amendment was rejected.",
    );
  }
  await event(
    client,
    context,
    "sales_order",
    orderId,
    "sales_order.amendment_rejected",
    "pending_approval",
    resumeStatus,
    { orderVersionId, previousVersionId },
  );
  return { orderId, orderVersionId, status: resumeStatus };
}

export async function completeFulfillmentRequest(
  client,
  context,
  requestId,
  input = {},
) {
  requirePermission(context, "sales.fulfillment.request");
  const request = (
    await client.query(
      `SELECT request.*,sales_order.lifecycle_status,sales_order.fulfillment_status
       FROM tenant.sales_fulfillment_requests request
       JOIN tenant.sales_orders sales_order ON sales_order.id=request.sales_order_id
      WHERE request.organization_id=$1 AND request.id=$2 FOR UPDATE`,
      [context.organizationId, uuid(requestId, "Fulfilment request")],
    )
  ).rows[0];
  if (!request) throw new SalesError(404, "Fulfilment request not found.");
  if (request.status === "completed")
    return getSalesOrder(client, context, request.sales_order_id);
  if (!new Set(["pending", "processing", "failed"]).has(request.status)) {
    throw new SalesError(
      409,
      `A ${request.status} fulfilment request cannot be completed.`,
    );
  }
  if (!Array.isArray(input.lines) || !input.lines.length)
    throw new SalesError(400, "At least one fulfilled line is required.");
  for (const [index, lineInput] of input.lines.entries()) {
    const lineId = uuid(lineInput.salesOrderLineId, `Line ${index + 1}`);
    const fulfilled = decimal(lineInput.fulfilledQuantity);
    if (fulfilled <= 0n)
      throw new SalesError(
        400,
        `Line ${index + 1} fulfilled quantity must be greater than zero.`,
      );
    const line = (
      await client.query(
        `SELECT progress.*,line.quantity,line.sales_order_version_id
         FROM tenant.sales_order_line_progress progress
         JOIN tenant.sales_order_lines line ON line.id=progress.sales_order_line_id
        WHERE progress.organization_id=$1 AND progress.sales_order_line_id=$2 AND line.sales_order_version_id=$3 FOR UPDATE`,
        [context.organizationId, lineId, request.sales_order_version_id],
      )
    ).rows[0];
    if (!line)
      throw new SalesError(
        404,
        `Sales-order line ${index + 1} was not found in the requested version.`,
      );
    const next = decimal(line.fulfilled_quantity) + fulfilled;
    const maximum =
      decimal(line.confirmed_quantity) -
      decimal(line.cancelled_quantity) -
      decimal(line.returned_quantity);
    if (next > maximum)
      throw new SalesError(
        409,
        `Line ${index + 1} fulfilment exceeds the remaining confirmed quantity.`,
      );
    await client.query(
      `UPDATE tenant.sales_order_line_progress SET fulfilled_quantity=$3,updated_by=$4,updated_at=now()
        WHERE organization_id=$1 AND sales_order_line_id=$2`,
      [context.organizationId, lineId, asDatabaseDecimal(next), context.userId],
    );
  }
  const totals = (
    await client.query(
      `SELECT bool_and(progress.fulfilled_quantity >= progress.confirmed_quantity-progress.cancelled_quantity) AS complete,
            bool_or(progress.fulfilled_quantity > 0) AS any_fulfilled
       FROM tenant.sales_order_line_progress progress
       JOIN tenant.sales_order_lines line ON line.id=progress.sales_order_line_id
      WHERE line.organization_id=$1 AND line.sales_order_version_id=$2`,
      [context.organizationId, request.sales_order_version_id],
    )
  ).rows[0];
  const fulfillmentStatus = totals?.complete
    ? "fulfilled"
    : totals?.any_fulfilled
      ? "partially_fulfilled"
      : "not_started";
  await client.query(
    `UPDATE tenant.sales_fulfillment_requests SET status='completed',completed_at=now(),last_error=NULL WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, request.id],
  );
  await client.query(
    `UPDATE tenant.sales_orders SET fulfillment_status=$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2`,
    [
      context.organizationId,
      request.sales_order_id,
      fulfillmentStatus,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "sales_order",
    request.sales_order_id,
    "sales_order.fulfillment_completed",
    request.fulfillment_status,
    fulfillmentStatus,
    {
      requestId: request.id,
      externalReference: text(input.externalReference, 200),
    },
  );
  return getSalesOrder(client, context, request.sales_order_id);
}
