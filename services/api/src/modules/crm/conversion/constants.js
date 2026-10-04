// Lead-to-Opportunity Conversion: permissions and fixed vocabulary.
export const CONVERSION_PERMISSIONS = Object.freeze({
  convert: "crm.leads.convert",
  overrideQualification: "crm.leads.override_qualification",
  useExisting: "crm.leads.convert_use_existing",
  createAccount: "crm.leads.convert_create_account",
  createContact: "crm.leads.convert_create_contact",
  changeOwner: "crm.leads.convert_change_owner",
  overrideDuplicate: "crm.leads.convert_override_duplicate",
});

// What may happen to the lead's open tasks and follow-ups.
export const OPEN_WORK_CHOICES = Object.freeze(["move", "keep"]);

// Contact fields the salesperson may update from the lead when linking an existing contact.
export const CONTACT_CONFLICT_FIELDS = Object.freeze([
  { key: "email", label: "Email", leadColumn: "email", contactColumn: "email" },
  { key: "mobile", label: "Mobile", leadColumn: "mobile", contactColumn: "mobile" },
  { key: "phone", label: "Phone", leadColumn: "phone", contactColumn: "phone" },
  { key: "jobTitle", label: "Job title", leadColumn: "job_title", contactColumn: "designation" },
]);

// Account fields shown side by side when linking an existing account. Never overwritten.
export const ACCOUNT_COMPARE_FIELDS = Object.freeze([
  { key: "name", label: "Company name", leadColumn: "company_name", accountColumn: "display_name" },
  { key: "website", label: "Website", leadColumn: "website", accountColumn: "website" },
  { key: "industry", label: "Industry", leadColumn: "industry", accountColumn: "industry" },
]);

export const MAX_OPPORTUNITY_VALUE = 999999999999.99;
