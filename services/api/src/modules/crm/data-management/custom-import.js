// Custom fields in import and export (CRM audit M4): the organization's own fields on a lead, deal, company or contact become extra
// columns — an import maps a column by the field's name ("Outlet class"), an export writes one column per active field.
import { listCustomFields } from "../custom-fields/records.js";

const PREFIX = "custom:";
const headerKey = (value) => String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

// The active custom fields as importable fields: { key: "custom:<key>", label }.
export async function customImportFields(client, context, entity) {
  return (await listCustomFields(client, context, entity)).map((field) => ({ key: `${PREFIX}${field.key}`, label: field.label }));
}

// Adds to a suggested mapping the columns named like a custom field (not already mapped).
export function suggestCustomMapping(headers, mapping, customFields) {
  for (const header of headers) {
    if (mapping[header]) continue;
    const field = customFields.find((candidate) => !Object.values(mapping).includes(candidate.key) && headerKey(candidate.label) === headerKey(header));
    if (field) mapping[header] = field.key;
  }
  return mapping;
}

// A mapped column that is a custom field: its value goes to input.customFields. Returns true when the column was one.
export function takeCustomColumn(input, fieldKey, value) {
  if (!String(fieldKey).startsWith(PREFIX)) return false;
  const text = String(value ?? "").trim();
  if (text) (input.customFields ??= {})[fieldKey.slice(PREFIX.length)] = text;
  return true;
}

// One export column per active custom field: [label, read(record)] (a checkbox as Yes / No).
export async function customExportColumns(client, context, entity) {
  return (await listCustomFields(client, context, entity)).map((field) => [field.label, (record) => {
    const value = record?.customFields?.[field.key];
    if (value === undefined || value === null) return "";
    return field.type === "checkbox" ? (value ? "Yes" : "No") : value;
  }]);
}
