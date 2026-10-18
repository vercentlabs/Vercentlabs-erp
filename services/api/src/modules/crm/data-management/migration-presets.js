// Moving in from another tool (CRM plan 5.7): the column names Zoho CRM, HubSpot, Salesforce, Odoo, LeadSquared, Bitrix24 and a plain
// Excel sheet use in their exports, so their files map onto CRM's import columns on their own; and, per tool, which export to take.
// Names are written as the import compares them: lower case, words separated by single spaces.
export const MIGRATION_SOURCES = Object.freeze([
  { key: "zoho", label: "Zoho CRM", howTo: "Setup › Data Administration › Export: export Leads, Accounts, Contacts and Deals as CSV, one file each." },
  { key: "hubspot", label: "HubSpot", howTo: "Contacts / Companies / Deals › Export view: choose all properties, CSV." },
  { key: "salesforce", label: "Salesforce", howTo: "Reports: a Leads, Accounts, Contacts and Opportunities report each, Export › Details only, CSV." },
  { key: "odoo", label: "Odoo", howTo: "CRM › Pipeline (list view) and Contacts: select all, Action › Export, with the fields you need, as CSV or XLSX." },
  { key: "leadsquared", label: "LeadSquared", howTo: "Manage Leads › Export Leads; Opportunities › Export." },
  { key: "bitrix24", label: "Bitrix24", howTo: "CRM › Leads / Companies / Contacts / Deals › the gear menu › Export to Excel." },
  { key: "excel", label: "Excel or Google Sheets", howTo: "One sheet per kind of record, with a header row. Download our template to see the columns." },
]);

// entity → import field key → the other tools' column names.
export const MIGRATION_ALIASES = Object.freeze({
  leads: {
    fullName: ["lead name", "contact name", "full name", "name of the lead"],
    firstName: ["first name", "firstname", "first name of the lead"],
    lastName: ["last name", "lastname"],
    companyName: ["company", "company name", "account name", "organization name", "customer"],
    jobTitle: ["title", "job title", "designation", "position"],
    email: ["email", "email address", "e mail", "primary email", "email id", "emailaddress"],
    phone: ["phone", "phone number", "work phone", "business phone", "landline"],
    mobile: ["mobile", "mobile phone", "mobile number", "mobilephone", "mobile phone number", "phone 1"],
    website: ["website", "website url", "company domain name"],
    city: ["city", "billing city", "mailing city"],
    state: ["state", "state region", "state province", "billing state", "mailing state"],
    countryCode: ["country", "country region", "billing country", "mailing country"],
    source: ["lead source", "source", "original source", "leadsource"],
    industry: ["industry", "industry type"],
    productInterest: ["product interest", "interested in", "requirement", "product"],
    estimatedValue: ["annual revenue", "expected revenue", "deal value", "budget", "estimated revenue"],
    description: ["description", "notes", "lead notes", "remarks", "message"],
    ownerEmail: ["lead owner", "owner", "contact owner", "salesperson", "assigned to", "owner email", "lead owner email"],
    rating: ["rating", "lead rating", "lead score category"],
  },
  accounts: {
    displayName: ["account name", "company name", "name", "organization name", "company"],
    phone: ["phone", "phone number", "company phone"],
    website: ["website", "company domain name", "website url"],
    industry: ["industry"],
    ownerEmail: ["account owner", "company owner", "owner", "salesperson"],
  },
  contacts: {
    firstName: ["first name", "firstname"],
    lastName: ["last name", "lastname"],
    email: ["email", "email address", "primary email", "email id"],
    mobile: ["mobile", "mobile phone", "mobile number"],
    phone: ["phone", "phone number", "work phone", "business phone"],
    jobTitle: ["title", "job title", "designation"],
    company: ["account name", "company name", "company", "associated company"],
    ownerEmail: ["contact owner", "owner", "salesperson"],
  },
  opportunities: {
    name: ["deal name", "opportunity name", "opportunity", "deal", "title"],
    company: ["account name", "company", "company name", "associated company", "customer", "partner"],
    contactEmail: ["contact email", "associated contact email", "primary contact email", "email"],
    amount: ["amount", "deal amount", "expected revenue", "opportunity amount", "value"],
    stage: ["stage", "deal stage", "sales stage", "pipeline stage"],
    expectedCloseDate: ["closing date", "close date", "expected closing", "expected closing date", "deadline"],
    source: ["lead source", "source", "deal source"],
    ownerEmail: ["deal owner", "opportunity owner", "owner", "salesperson", "assigned to"],
    description: ["description", "notes", "internal notes"],
  },
});

// A field's aliases with the other tools' names added (no repeats).
export function withMigrationAliases(entity, fields) {
  const extra = MIGRATION_ALIASES[entity] ?? {};
  return Object.freeze(fields.map((field) => Object.freeze({ ...field, aliases: [...new Set([...(field.aliases ?? []), ...(extra[field.key] ?? [])])] })));
}
