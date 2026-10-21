// Custom fields as list filters (CRM audit M4): filters.custom { key: value } keeps the records whose own field (custom_data) has that
// value — a company's channel "GT", a contact's budget band. Keys are the fields' own keys (lowercase words); values are compared as text.
export function customFieldFilterSql(alias, filters, values) {
  const conditions = [];
  for (const [key, value] of Object.entries(filters?.custom ?? {})) {
    if (!/^[a-z][a-z0-9_]{0,39}$/.test(key) || String(value ?? "") === "") continue;
    values.push(key, String(value));
    conditions.push(`${alias}.custom_data ->> $${values.length - 1} = $${values.length}`);
  }
  return conditions;
}
