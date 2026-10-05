// The fixed vocabulary of the tax layer, shared by Sales, POS, Procurement
// and Finance. The engine is generic (a category, a dated rate, components);
// India GST is one localisation of it (CGST + SGST or IGST by place of
// supply, state codes, GSTIN format).
export class TaxError extends Error {
  constructor(status, message, code = "TAX_ERROR", details = undefined) {
    super(message);
    this.name = "TaxError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const TAX_PERMISSIONS = Object.freeze({
  view: "tax.view",
  manageCategories: "tax.categories.manage",
  manageRates: "tax.rates.manage",
  manageRegistrations: "tax.registrations.manage",
  overrideTransaction: "tax.transaction.override",
  overridePlaceOfSupply: "tax.place_of_supply.override",
  viewAudit: "tax.audit.view",
});

// How a category's rate is charged. GST is split by the place of supply.
export const TAX_TYPES = Object.freeze([
  { code: "gst", label: "GST" },
  { code: "vat", label: "VAT" },
  { code: "sales_tax", label: "Sales tax" },
  { code: "other", label: "Other tax" },
  { code: "none", label: "No tax" },
]);

// Zero rated, exempt and outside tax all charge nothing but are reported differently.
export const TAX_TREATMENTS = Object.freeze([
  { code: "taxable", label: "Taxable" },
  { code: "zero_rated", label: "Zero rated" },
  { code: "exempt", label: "Exempt" },
  { code: "non_taxable", label: "Non-taxable (outside tax)" },
]);

export const TAX_APPLIES_TO = Object.freeze([
  { code: "all", label: "Goods and services" },
  { code: "goods", label: "Goods (HSN)" },
  { code: "services", label: "Services (SAC)" },
]);

// The kind of supply a document is, and the treatment it gives every line.
export const SUPPLY_TYPES = Object.freeze([
  { code: "domestic", label: "Domestic (tax applies)", treatment: "taxable" },
  { code: "export", label: "Export", treatment: "zero_rated" },
  { code: "sez", label: "Supply to SEZ", treatment: "zero_rated" },
  { code: "exempt", label: "Exempt supply", treatment: "exempt" },
  { code: "non_gst", label: "Non-GST supply", treatment: "non_taxable" },
]);
export const treatmentOfSupply = (supplyType) => SUPPLY_TYPES.find((entry) => entry.code === supplyType)?.treatment ?? "taxable";

// The supply type a customer's GST registration type implies.
export function supplyTypeForCustomer(registrationType) {
  if (registrationType === "overseas" || registrationType === "deemed_export") return "export";
  if (registrationType === "sez") return "sez";
  return "domestic";
}

// Indian GST state codes, used for the GST state and the place of supply.
export const GST_STATES = Object.freeze([
  ["01", "Jammu and Kashmir"], ["02", "Himachal Pradesh"], ["03", "Punjab"], ["04", "Chandigarh"], ["05", "Uttarakhand"], ["06", "Haryana"],
  ["07", "Delhi"], ["08", "Rajasthan"], ["09", "Uttar Pradesh"], ["10", "Bihar"], ["11", "Sikkim"], ["12", "Arunachal Pradesh"], ["13", "Nagaland"],
  ["14", "Manipur"], ["15", "Mizoram"], ["16", "Tripura"], ["17", "Meghalaya"], ["18", "Assam"], ["19", "West Bengal"], ["20", "Jharkhand"],
  ["21", "Odisha"], ["22", "Chhattisgarh"], ["23", "Madhya Pradesh"], ["24", "Gujarat"], ["26", "Dadra and Nagar Haveli and Daman and Diu"],
  ["27", "Maharashtra"], ["29", "Karnataka"], ["30", "Goa"], ["31", "Lakshadweep"], ["32", "Kerala"], ["33", "Tamil Nadu"], ["34", "Puducherry"],
  ["35", "Andaman and Nicobar Islands"], ["36", "Telangana"], ["37", "Andhra Pradesh"], ["38", "Ladakh"], ["97", "Other Territory"],
].map(([code, name]) => Object.freeze({ code, name })));

const STATE_NAMES = new Map(GST_STATES.map((state) => [state.code, state.name]));
const STATE_CODES = new Map(GST_STATES.map((state) => [state.name.toLowerCase(), state.code]));
export const gstStateName = (code) => STATE_NAMES.get(String(code ?? "").trim()) ?? null;
export const gstStateCode = (name) => STATE_CODES.get(String(name ?? "").trim().toLowerCase()) ?? null;

export const GSTIN_PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isUuid = (value) => UUID.test(String(value ?? ""));
export function requireUuid(value, label) {
  if (!isUuid(value)) throw new TaxError(400, `${label} is not valid.`, "TAX_VALIDATION");
  return String(value);
}
export const text = (value, maximum = 400) => {
  const result = value == null ? "" : String(value).trim();
  return result ? result.slice(0, maximum) : null;
};
export const has = (object, key) => Object.prototype.hasOwnProperty.call(object ?? {}, key);
export const dayOf = (value) => {
  if (!value) return null;
  if (value instanceof Date) return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  return String(value).slice(0, 10);
};
export const can = (context, permission) => Boolean(context?.roleSlugs?.includes("organization_owner") || context?.permissions?.includes(permission));
export function requireTaxPermission(context, permission, message = "You do not have permission to do this.") {
  if (!can(context, permission)) throw new TaxError(403, message, "PERMISSION_DENIED");
}
