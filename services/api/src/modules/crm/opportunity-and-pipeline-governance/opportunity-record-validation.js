const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const TEXT_LIMITS = Object.freeze({
  name: 240,
  description: 10_000,
  nextStep: 2_000,
});

const UUID_FIELDS = Object.freeze([
  "companyId",
  "branchId",
  "pipelineId",
  "stageId",
  "leadId",
  "partyId",
  "contactId",
  "campaignId",
  "sourceId",
  "ownerUserId",
]);

const hasOwn = (value, key) => Object.prototype.hasOwnProperty.call(value || {}, key);
const trimmed = (value) => String(value ?? "").trim();

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function normalizeOpportunityRecordInput(input = {}) {
  const prepared = { ...input };
  for (const field of ["name", "description", "nextStep"]) {
    if (!hasOwn(prepared, field)) continue;
    const value = trimmed(prepared[field]);
    prepared[field] = field === "name" ? value : value || null;
  }
  for (const field of UUID_FIELDS) {
    if (!hasOwn(prepared, field)) continue;
    const value = trimmed(prepared[field]);
    prepared[field] = value || null;
  }
  if (hasOwn(prepared, "currencyCode")) {
    const value = trimmed(prepared.currencyCode).toUpperCase();
    prepared.currencyCode = value || null;
  }
  if (hasOwn(prepared, "expectedCloseDate")) {
    const value = trimmed(prepared.expectedCloseDate);
    prepared.expectedCloseDate = value || null;
  }
  if (hasOwn(prepared, "amount")) {
    if (prepared.amount === "" || prepared.amount === null || prepared.amount === undefined) prepared.amount = 0;
    else prepared.amount = Number(prepared.amount);
  }
  return prepared;
}

export function validateOpportunityRecord(candidate = {}, { mode = "create" } = {}) {
  const issues = [];
  const issue = (field, message, code) => issues.push({ field, message, code });

  if (mode === "create" || hasOwn(candidate, "name")) {
    const name = trimmed(candidate.name);
    if (!name) issue("name", "Opportunity name is required.", "CRM_OPPORTUNITY_NAME_REQUIRED");
    else if (name.length > TEXT_LIMITS.name) issue("name", `Opportunity name must be ${TEXT_LIMITS.name} characters or fewer.`, "CRM_OPPORTUNITY_NAME_TOO_LONG");
  }

  for (const field of ["description", "nextStep"]) {
    if (!hasOwn(candidate, field) || candidate[field] == null) continue;
    const value = trimmed(candidate[field]);
    if (value.length > TEXT_LIMITS[field]) issue(field, `${field === "nextStep" ? "Next step" : "Description"} is too long.`, "CRM_OPPORTUNITY_TEXT_TOO_LONG");
  }

  if (hasOwn(candidate, "amount")) {
    const amount = Number(candidate.amount);
    if (!Number.isFinite(amount) || amount < 0 || amount > 9_000_000_000_000_000)
      issue("amount", "Amount must be a non-negative value within the supported currency range.", "CRM_OPPORTUNITY_AMOUNT_INVALID");
  }

  if (hasOwn(candidate, "currencyCode") && candidate.currencyCode != null && !/^[A-Z]{3}$/.test(String(candidate.currencyCode)))
    issue("currencyCode", "Currency must be a three-letter ISO code.", "CRM_OPPORTUNITY_CURRENCY_INVALID");

  if (hasOwn(candidate, "expectedCloseDate") && candidate.expectedCloseDate != null && !validDate(candidate.expectedCloseDate))
    issue("expectedCloseDate", "Expected close date must be a valid calendar date.", "CRM_OPPORTUNITY_CLOSE_DATE_INVALID");

  for (const field of UUID_FIELDS) {
    if (!hasOwn(candidate, field) || candidate[field] == null) continue;
    if (!UUID_PATTERN.test(String(candidate[field])))
      issue(field, `${field.replace(/([A-Z])/g, " $1").trim()} is invalid.`, "CRM_OPPORTUNITY_REFERENCE_INVALID");
  }

  if (hasOwn(candidate, "customData") && (candidate.customData == null || typeof candidate.customData !== "object" || Array.isArray(candidate.customData)))
    issue("customData", "Opportunity custom data must be an object.", "CRM_OPPORTUNITY_CUSTOM_DATA_INVALID");

  return issues;
}

export function opportunityChangedFields(before = {}, after = {}, requested = []) {
  return [...new Set(requested)].filter((field) => {
    const left = before[field] ?? null;
    const right = after[field] ?? null;
    return JSON.stringify(left) !== JSON.stringify(right);
  }).sort();
}
