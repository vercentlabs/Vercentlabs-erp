// What a supplier must say, and that what it points at is the tenant's own.
//
// Identity (name, legal name, type, category, email, phone, website, country,
// notes), tax (GST registration type, GSTIN, PAN, registered state) and the
// commercial defaults (currency, payment terms, buyer) are read separately,
// because separate permissions change them.
import { purchaseTermSnapshot } from "../../../core/payment-terms/index.js";
import {
  EMAIL_PATTERN, GSTIN_PATTERN, GST_REGISTRATION_TYPES, PAN_PATTERN, SUPPLIER_CATEGORIES, SUPPLIER_TYPES, SupplierError, has, isUuid, text,
} from "./constants.js";

export const IDENTITY_FIELDS = Object.freeze(["supplierName", "legalName", "supplierType", "category", "primaryEmail", "primaryPhone", "website", "countryCode", "notes"]);
export const TAX_FIELDS = Object.freeze(["gstRegistrationType", "gstin", "pan", "registeredStateCode"]);
export const COMMERCIAL_FIELDS = Object.freeze(["defaultCurrency", "paymentTermId", "assignedBuyerId"]);

const LABELS = Object.freeze({
  supplierName: "Supplier name", legalName: "Legal name", supplierType: "Supplier type", category: "Category", primaryEmail: "Email", primaryPhone: "Phone",
  website: "Website", countryCode: "Country", notes: "Notes", gstRegistrationType: "GST registration type", gstin: "GSTIN", pan: "PAN",
  registeredStateCode: "Registered state", defaultCurrency: "Default currency", paymentTermId: "Payment terms", assignedBuyerId: "Buyer",
});

function fail(issues) {
  throw new SupplierError(400, issues[0].message, "SUPPLIER_VALIDATION", { issues });
}

// The fields present in input, cleaned. Absent fields stay absent (an update changes only what it sends).
export function normalizeSupplierInput(input = {}) {
  const out = {};
  const put = (field, value) => { if (has(input, field)) out[field] = value; };
  put("supplierName", text(input.supplierName, 240));
  put("legalName", text(input.legalName, 240));
  put("supplierType", text(input.supplierType, 20));
  put("category", text(input.category, 40));
  put("primaryEmail", text(input.primaryEmail, 254)?.toLowerCase() ?? null);
  put("primaryPhone", text(input.primaryPhone, 40));
  const website = text(input.website, 500);
  put("website", website && !/^https?:\/\//i.test(website) ? `https://${website}` : website);
  put("countryCode", text(input.countryCode, 2)?.toUpperCase() ?? null);
  put("notes", text(input.notes, 5000));
  put("gstRegistrationType", text(input.gstRegistrationType, 40));
  put("gstin", text(input.gstin, 15)?.toUpperCase().replace(/\s+/g, "") ?? null);
  put("pan", text(input.pan, 10)?.toUpperCase().replace(/\s+/g, "") ?? null);
  put("registeredStateCode", text(input.registeredStateCode, 2));
  put("defaultCurrency", text(input.defaultCurrency, 3)?.toUpperCase() ?? null);
  put("paymentTermId", text(input.paymentTermId, 40));
  put("assignedBuyerId", text(input.assignedBuyerId, 40));
  return out;
}

// The whole supplier as it will be saved (current values merged with the change) must hold together.
export function assertValidSupplier(candidate) {
  const issues = [];
  const issue = (field, message) => issues.push({ field, message });
  if (!candidate.supplierName) issue("supplierName", "Enter the supplier name.");
  if (!SUPPLIER_TYPES.some((entry) => entry.code === candidate.supplierType)) issue("supplierType", "Choose Business or Individual.");
  if (!SUPPLIER_CATEGORIES.some((entry) => entry.code === candidate.category)) issue("category", "Choose a category.");
  if (candidate.primaryEmail && !EMAIL_PATTERN.test(candidate.primaryEmail)) issue("primaryEmail", "Enter a valid email address.");
  if (candidate.primaryPhone && (candidate.primaryPhone.replace(/[^0-9]/g, "").length < 6 || !/^[0-9+()\-\s.]+$/.test(candidate.primaryPhone)))
    issue("primaryPhone", "Enter a valid phone number.");
  if (candidate.website && !/^https?:\/\/[^\s.]+\.[^\s]+$/i.test(candidate.website)) issue("website", "Enter a valid website.");
  if (candidate.countryCode && !/^[A-Z]{2}$/.test(candidate.countryCode)) issue("countryCode", "Choose the country.");
  if (!/^[A-Z]{3}$/.test(candidate.defaultCurrency ?? "")) issue("defaultCurrency", "Choose the default currency.");
  if (!isUuid(candidate.paymentTermId)) issue("paymentTermId", "Choose the default payment terms.");
  if (candidate.assignedBuyerId && !isUuid(candidate.assignedBuyerId)) issue("assignedBuyerId", "Choose the buyer.");
  const gstType = GST_REGISTRATION_TYPES.find((entry) => entry.code === candidate.gstRegistrationType);
  if (candidate.gstRegistrationType && !gstType) issue("gstRegistrationType", "Choose the GST registration type.");
  if (gstType?.needsGstin && !candidate.gstin) issue("gstin", `A ${gstType.label} supplier needs a GSTIN.`);
  if (candidate.gstin && !GSTIN_PATTERN.test(candidate.gstin)) issue("gstin", "A GSTIN has 15 characters: the state code, the PAN and three more.");
  if (candidate.gstin && gstType && !gstType.needsGstin && candidate.gstRegistrationType !== "deemed_export")
    issue("gstin", `${gstType.label} suppliers have no GSTIN.`);
  if (candidate.pan && !PAN_PATTERN.test(candidate.pan)) issue("pan", "A PAN has 10 characters, like ABCDE1234F.");
  if (candidate.gstin && GSTIN_PATTERN.test(candidate.gstin)) {
    const statePart = candidate.gstin.slice(0, 2);
    const panPart = candidate.gstin.slice(2, 12);
    if (candidate.registeredStateCode && candidate.registeredStateCode !== statePart) issue("registeredStateCode", "The registered state must be the GSTIN's state.");
    if (candidate.pan && candidate.pan !== panPart) issue("pan", "The PAN must be the one inside the GSTIN.");
  }
  if (candidate.registeredStateCode && !/^[0-9]{2}$/.test(candidate.registeredStateCode)) issue("registeredStateCode", "Choose the registered state.");
  if (issues.length) fail(issues);
}

// Derived tax details: the registered state and PAN come from the GSTIN when it has them.
export function completeTaxDetails(candidate) {
  if (candidate.gstin && GSTIN_PATTERN.test(candidate.gstin)) {
    candidate.registeredStateCode ??= candidate.gstin.slice(0, 2);
    candidate.pan ??= candidate.gstin.slice(2, 12);
  }
  if (!candidate.gstRegistrationType && candidate.countryCode && candidate.countryCode !== "IN") candidate.gstRegistrationType = "overseas";
  return candidate;
}

// The currency, payment terms and buyer must be the tenant's own and usable.
export async function assertSupplierReferences(client, context, candidate, changed = null) {
  const touched = (field) => !changed || changed.includes(field);
  const one = async (sql, values) => (await client.query(sql, values)).rows[0];
  if (touched("defaultCurrency") && !(await one(`SELECT 1 FROM tenant.currencies WHERE organization_id = $1 AND code = $2 AND status = 'active'`, [context.organizationId, candidate.defaultCurrency])))
    fail([{ field: "defaultCurrency", message: "Choose a currency your organization uses." }]);
  if (touched("paymentTermId")) {
    try {
      await purchaseTermSnapshot(client, context.organizationId, candidate.paymentTermId);
    } catch (error) {
      fail([{ field: "paymentTermId", message: error.message ?? "Choose active purchase payment terms." }]);
    }
  }
  if (touched("assignedBuyerId") && candidate.assignedBuyerId && !(await one(
    `SELECT 1 FROM public.organization_memberships membership JOIN public.users users ON users.id = membership.user_id
      WHERE membership.organization_id = $1 AND membership.user_id = $2 AND membership.status = 'active' AND users.status = 'active'`,
    [context.organizationId, candidate.assignedBuyerId])))
    fail([{ field: "assignedBuyerId", message: "Choose an active user of your organization as the buyer." }]);
}

export const fieldLabel = (field) => LABELS[field] ?? field;
