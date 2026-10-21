// A company's tax identity and terms in CRM: GSTIN, PAN, GST treatment and payment terms (CRM plan 1.4, 2.1).
//
// Any company — a prospect as much as a customer — can hold its GSTIN: Indian buyers give it before the first quote, and the state it
// carries decides intra- or inter-state GST. The GSTIN is read with the one shared validator (all six kinds, check character included);
// it sets the GST state and, for kinds built on a PAN, the PAN. A billing address in another state is not refused, but is reported as a
// mismatch to look into (a branch can be registered elsewhere). Once a company is a customer and the organization has Sales, these
// details belong to Sales' Customer Master and are changed there; without Sales, CRM keeps them, so a CRM-only business never gets
// stuck with details it cannot edit.
import { GST_TREATMENTS, isValidPan, parseGstin } from "@vercentlabs/shared-types";

import { hasApp, loadApps } from "../../../core/access/apps.js";
import { CrmError } from "../data-management/errors.js";
import { accountCan, requireAccountPermission } from "./access.js";
import { ACCOUNT_PERMISSIONS } from "./constants.js";
import { recordAccountHistory } from "./history.js";
import { getAccount, lockAccount } from "./records.js";

const TREATMENTS = new Map(GST_TREATMENTS.map((entry) => [entry.code, entry]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const has = (object, key) => Object.prototype.hasOwnProperty.call(object, key) && object[key] !== undefined;
const text = (value) => String(value ?? "").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_ACCOUNT_TAX_VALIDATION", { issues: [{ field, message }] });
const isCustomerRow = (row) => Boolean(row.customer_number) || ["customer", "both"].includes(row.party_type);

// Whether CRM may change this company's tax identity and terms (and why not, when it may not).
export function taxIdentityEditable(context, row) {
  if (!accountCan(context, ACCOUNT_PERMISSIONS.edit)) return { editable: false, reason: "permission" };
  if (isCustomerRow(row) && hasApp(context, "sales")) return { editable: false, reason: "sales" };
  return { editable: true, reason: null };
}

// input: { gstin?, pan?, gstTreatment?, paymentTermId?, expectedUpdatedAt? } — each given field is set (an empty value clears it).
// Returns { account, warnings: [{ code, message }] }.
export async function updateAccountTaxIdentity(client, context, partyId, input = {}) {
  requireAccountPermission(context, ACCOUNT_PERMISSIONS.edit, "You do not have permission to edit companies.");
  await loadApps(client, context);
  const row = await lockAccount(client, context, partyId);
  if (input.expectedUpdatedAt && new Date(input.expectedUpdatedAt).getTime() !== new Date(row.updated_at).getTime())
    throw new CrmError(409, "This company was changed by someone else. Reload it and try again.", "CRM_STALE_WRITE");
  if (taxIdentityEditable(context, row).reason === "sales")
    throw new CrmError(409, "This company is a customer: Sales maintains its GST details and payment terms in the Customer Master.", "CRM_ACCOUNT_TAX_IN_SALES");

  const next = { gstin: row.gstin, pan: row.pan, taxTreatment: row.tax_treatment, gstStateCode: row.gst_state_code, paymentTermId: row.payment_term_id };
  if (has(input, "gstin")) {
    const parsed = parseGstin(input.gstin);
    if (parsed.gstin && !parsed.valid) throw invalid("gstin", parsed.error);
    next.gstin = parsed.gstin || null;
    next.gstStateCode = parsed.valid ? parsed.stateCode : null;
    // A PAN-based GSTIN carries the PAN; a new GSTIN replaces a PAN that came from the old one.
    if (parsed.pan) next.pan = parsed.pan;
  }
  if (has(input, "pan")) {
    const pan = text(input.pan).toUpperCase();
    if (pan && !isValidPan(pan)) throw invalid("pan", "Enter a valid 10-character PAN, such as ABCDE1234F.");
    next.pan = pan || (next.gstin ? parseGstin(next.gstin).pan : null);
  }
  const fromGstin = next.gstin ? parseGstin(next.gstin).pan : null;
  if (fromGstin && next.pan && fromGstin !== next.pan) throw invalid("pan", "The PAN does not match the GSTIN.");
  if (has(input, "gstTreatment")) {
    const code = text(input.gstTreatment) || null;
    if (code && !TREATMENTS.has(code)) throw invalid("gstTreatment", "Choose a GST treatment.");
    next.taxTreatment = code;
  }
  // A registered treatment needs a GSTIN; a GSTIN means the company is registered.
  if (!has(input, "gstTreatment") && next.gstin && !next.taxTreatment) next.taxTreatment = "registered_regular";
  const treatment = next.taxTreatment ? TREATMENTS.get(next.taxTreatment) : null;
  if (treatment?.needsGstin && !next.gstin) throw invalid("gstin", `Enter the GSTIN: it is needed for ${treatment.label}.`);
  if (next.gstin && ["unregistered", "consumer", "overseas"].includes(next.taxTreatment))
    throw invalid("gstTreatment", "A company with a GSTIN is registered. Choose a registered treatment, or clear the GSTIN.");
  if (has(input, "paymentTermId")) {
    const termId = text(input.paymentTermId) || null;
    if (termId) {
      if (!UUID.test(termId)) throw invalid("paymentTermId", "Choose payment terms.");
      const term = (await client.query(
        "SELECT id FROM tenant.payment_terms WHERE organization_id = $1 AND id = $2 AND status = 'active' AND is_sales_enabled", [context.organizationId, termId])).rows[0];
      if (!term) throw invalid("paymentTermId", "Choose active payment terms that can be used for sales.");
    }
    next.paymentTermId = termId;
  }
  if (next.gstin && next.gstin !== row.gstin) {
    const taken = (await client.query("SELECT code, display_name FROM tenant.business_parties WHERE organization_id = $1 AND gstin = $2 AND id <> $3 LIMIT 1",
      [context.organizationId, next.gstin, row.id])).rows[0];
    if (taken) throw new CrmError(409, `This GSTIN already belongs to ${taken.display_name} (${taken.code}).`, "CRM_ACCOUNT_GSTIN_TAKEN");
  }

  const changed = Object.entries({ gstin: "gstin", pan: "pan", taxTreatment: "tax_treatment", gstStateCode: "gst_state_code", paymentTermId: "payment_term_id" })
    .filter(([field, column]) => (next[field] ?? null) !== (row[column] ?? null));
  if (changed.length) {
    await client.query(
      `UPDATE tenant.business_parties SET gstin = $3, pan = $4, tax_treatment = $5, gst_state_code = $6, payment_term_id = $7, updated_by = $8, updated_at = now()
        WHERE organization_id = $1 AND id = $2`,
      [context.organizationId, row.id, next.gstin, next.pan, next.taxTreatment, next.gstStateCode, next.paymentTermId, context.userId ?? null],
    );
    const labels = { gstin: "GSTIN", pan: "PAN", taxTreatment: "GST treatment", gstStateCode: "GST state", paymentTermId: "Payment terms" };
    await recordAccountHistory(client, context, row.id, "tax_identity_changed", `Tax identity: ${changed.map(([field]) => labels[field]).join(", ")} changed`,
      Object.fromEntries(changed.map(([field, column]) => [field, { from: row[column] ?? null, to: next[field] ?? null }])));
  }
  const account = await getAccount(client, context, row.id);
  return { account, warnings: taxWarnings(account) };
}

// What to look into: a GSTIN whose state differs from the billing address's state.
export function taxWarnings(account) {
  const warnings = [];
  if (account.gstStateCode && account.billingStateCode && account.gstStateCode !== account.billingStateCode)
    warnings.push({ code: "GST_STATE_MISMATCH", message: `The GSTIN is registered in state ${account.gstStateCode}, but the billing address is in state ${account.billingStateCode}.` });
  return warnings;
}
