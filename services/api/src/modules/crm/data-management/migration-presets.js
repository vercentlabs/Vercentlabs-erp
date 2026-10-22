// Moving in from another tool (CRM plan 5.7): the column names Zoho CRM, HubSpot, Salesforce, Odoo, LeadSquared, Bitrix24 and a plain
// Excel sheet use in their exports, so their files map onto CRM's import columns on their own; and, per tool, which export to take —
// howTo for the records, activities for past calls, meetings and notes. Checked against each vendor's help pages (October 2026).
// Names are written as the import compares them: lower case, words separated by single spaces.
export const MIGRATION_SOURCES = Object.freeze([
  { key: "zoho", label: "Zoho CRM",
    howTo: "Setup › Data Administration › Export › Start an Export: Leads, Accounts, Contacts and Deals, one CSV each. Needs the Export permission for each module.",
    activities: "Same page: export Tasks, Calls and Meetings; for notes choose Notes and then the module they belong to (up to 3,000 notes an export)." },
  { key: "hubspot", label: "HubSpot",
    howTo: "Contacts, Companies or Deals › the list view › Export (top right of the table): all properties, CSV or XLSX.",
    activities: "The record export does not include activities. On Professional plans, build a custom report on Activities and export it as CSV; otherwise use the API or an import tool." },
  { key: "salesforce", label: "Salesforce",
    howTo: "A report each for Leads, Accounts, Contacts and Opportunities › Export › Details only, CSV — or Setup › Data Export for every object at once (a zip of CSV files).",
    activities: "Tasks and Events come as separate files from Setup › Data Export; it also includes activities older than a year, which reports leave out." },
  { key: "odoo", label: "Odoo",
    howTo: "CRM › Pipeline and Contacts in list view: tick the records, Action › Export, choose the fields, CSV or XLSX.",
    activities: "Planned activities export from Activities in list view the same way. Chatter notes and messages have no export of their own in standard Odoo." },
  { key: "leadsquared", label: "LeadSquared",
    howTo: "Leads › Manage Leads › Export Leads (the file is emailed to you as CSV); Opportunities › Export.",
    activities: "Leads › Manage Activities › Export Activities: all fields or the ones you choose (up to 5 lakh at a time). Dates come in your account's time zone." },
  { key: "bitrix24", label: "Bitrix24",
    howTo: "CRM › Leads, Deals, Contacts or Companies in List view (not Kanban) › Settings › Export to Excel or CSV.",
    activities: "Bitrix24 cannot export CRM activities. Copy the important ones into our template, or use a marketplace app." },
  { key: "excel", label: "Excel or Google Sheets",
    howTo: "One sheet per kind of record, with a header row. Save each as CSV or XLSX.",
    activities: "Fill our template: one row per call, meeting or note, with the record it belongs to and the date." },
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
