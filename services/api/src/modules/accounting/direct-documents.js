// Accounting raises its own customer invoices and supplier bills (New invoice / New bill), so a business with Accounting alone can bill
// and record what it owes; the buttons stay once Sales or Purchase is on, as Odoo keeps them. A line is a description, quantity, price
// and GST rate: within the company's state the GST is split into CGST and SGST, across states it is IGST. A company that is not GST
// registered charges none on its invoices, and its suppliers' GST is part of the cost (not claimed back).
// The document is saved as a draft, or posted at once when asked — through Finance's approval policy, so above its threshold it waits
// for an approver instead.
import { loadTaxContext } from "../../core/tax/index.js";
import { AccountingError } from "./core.js";
import { createVendorBill, postVendorBill } from "./payables.js";
import { createCustomerInvoice, postCustomerInvoice } from "./receivables.js";
import { submitSubledgerDocument } from "./subledger-approvals.js";

export const GST_RATES = Object.freeze([0, 0.25, 3, 5, 12, 18, 28, 40]);

const round2 = (value) => Math.round((value + Number.EPSILON) * 100) / 100;

// The company's state (its default GST registration, else its address) and the party's (its GSTIN, else its billing address).
async function statesOf(client, context, partyId) {
  const company = (await client.query(
    `SELECT COALESCE((SELECT state_code FROM tenant.tax_registrations WHERE organization_id = $1 AND status = 'active' AND state_code IS NOT NULL
                       ORDER BY is_default DESC, created_at LIMIT 1), organization.state_code) AS state_code
       FROM public.organizations organization WHERE organization.id = $1`, [context.organizationId])).rows[0]?.state_code ?? null;
  const party = (await client.query(
    `SELECT COALESCE(NULLIF(left(party.gstin, 2), ''), (SELECT address.state_code FROM tenant.addresses address
              WHERE address.organization_id = party.organization_id AND address.party_id = party.id AND address.status = 'active'
              ORDER BY address.is_default_billing DESC, address.created_at LIMIT 1)) AS state_code
       FROM tenant.business_parties party WHERE party.organization_id = $1 AND party.id = $2`, [context.organizationId, partyId])).rows[0]?.state_code ?? null;
  return { company: company ? String(company).trim() : null, party: party ? String(party).trim() : null };
}

// Each line's amounts and its GST split.
function taxedLines(lines, { charges, interState }) {
  if (!Array.isArray(lines) || !lines.length) throw new AccountingError(400, "Add at least one line.");
  return lines.map((line, index) => {
    const quantity = Number(line.quantity ?? 1);
    const unitPrice = Number(line.unitPrice);
    if (!(quantity > 0)) throw new AccountingError(400, `Line ${index + 1}: enter a quantity above zero.`);
    if (!(unitPrice > 0)) throw new AccountingError(400, `Line ${index + 1}: enter the price.`);
    const rate = charges ? Number(line.gstRate ?? 0) : 0;
    if (!GST_RATES.includes(rate)) throw new AccountingError(400, `Line ${index + 1}: choose a GST rate.`);
    const net = round2(quantity * unitPrice);
    const details = [];
    if (rate > 0) {
      if (interState) details.push({ taxType: "igst", rate, taxableAmount: net, taxAmount: round2(net * rate / 100) });
      else {
        const half = round2(net * rate / 200);
        details.push({ taxType: "cgst", rate: rate / 2, taxableAmount: net, taxAmount: half }, { taxType: "sgst", rate: rate / 2, taxableAmount: net, taxAmount: half });
      }
    }
    const tax = round2(details.reduce((total, component) => total + component.taxAmount, 0));
    return {
      description: String(line.description ?? "").trim(), quantity: String(quantity), unitPrice: String(unitPrice), itemId: line.itemId || null, hsnSacCode: line.hsnSacCode || null,
      accountId: line.accountId || undefined, taxAmount: String(tax), taxDetails: details.map((component) => ({ ...component, taxableAmount: String(component.taxableAmount), taxAmount: String(component.taxAmount) })),
    };
  });
}

// input: { partyId, invoiceDate?, dueDate?, notes?, lines: [{ description, quantity, unitPrice, gstRate, itemId?, hsnSacCode?, accountId? }], post? }
export async function createAccountingInvoice(client, context, input = {}) {
  const tax = await loadTaxContext(client, { organizationId: context.organizationId });
  const states = await statesOf(client, context, input.partyId);
  const interState = Boolean(states.company && states.party && states.company !== states.party);
  const created = await createCustomerInvoice(client, context, {
    partyId: input.partyId, invoiceDate: input.invoiceDate || undefined, dueDate: input.dueDate || undefined, notes: input.notes, placeOfSupply: states.party ?? states.company,
    supplyType: tax.enabled ? "domestic" : "non_gst", lines: taxedLines(input.lines, { charges: tax.enabled, interState }),
  });
  const id = created.invoice?.id ?? created.id;
  if (!input.post) return { id, status: "draft" };
  const submitted = await submitSubledgerDocument(client, context, "customer_invoice", id);
  if (submitted.status === "pending_approval") return { id, status: "pending_approval" };
  await postCustomerInvoice(client, context, id);
  return { id, status: "posted" };
}

// input: { partyId, billDate?, dueDate?, supplierInvoiceReference?, notes?, lines: [{ description, quantity, unitPrice, gstRate, itemId?, accountId? }], post? }
export async function createAccountingBill(client, context, input = {}) {
  const tax = await loadTaxContext(client, { organizationId: context.organizationId, purchase: true });
  const states = await statesOf(client, context, input.partyId);
  const interState = Boolean(states.company && states.party && states.company !== states.party);
  const lines = taxedLines(input.lines, { charges: tax.enabled, interState })
    .map((line) => ({ ...line, inputTaxEligibility: tax.claimsInputTax ? "eligible" : "blocked" }));
  // The bill names the Procurement supplier when the party is one (a bill for any other party is Accounting's alone).
  const supplierId = (await client.query(`SELECT id FROM tenant.procurement_suppliers WHERE organization_id = $1 AND party_id = $2`, [context.organizationId, input.partyId])).rows[0]?.id;
  const created = await createVendorBill(client, context, {
    partyId: input.partyId, ...(supplierId ? { supplierId } : {}), billDate: input.billDate || undefined, dueDate: input.dueDate || undefined, notes: input.notes, sourceType: "direct",
    supplierInvoiceReference: input.supplierInvoiceReference || null, placeOfSupply: states.company, lines,
  });
  const id = created.bill?.id ?? created.id;
  if (!input.post) return { id, status: "draft" };
  const submitted = await submitSubledgerDocument(client, context, "vendor_bill", id);
  if (submitted.status === "pending_approval") return { id, status: "pending_approval" };
  await postVendorBill(client, context, id);
  return { id, status: "posted" };
}
