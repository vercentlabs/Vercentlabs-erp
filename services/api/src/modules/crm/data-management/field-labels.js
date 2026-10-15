// How a changed field is named in a record's history: plain words, never the internal key ("companyName" -> "company name",
// "accountId" -> "company"). Overrides cover the names that read wrongly when merely split.
const OVERRIDES = Object.freeze({
  accountId: "company", partyId: "company", contactId: "contact", ownerUserId: "owner", teamId: "team", sourceId: "lead source", gstin: "GSTIN", pan: "PAN",
  url: "website", estimatedValue: "estimated value", currencyCode: "currency", countryCode: "country", nextStepDueAt: "next step due date",
  expectedCloseDate: "expected close date", isDecisionMaker: "decision maker", isPrimary: "primary contact", amount: "value", jobTitle: "job title",
  parentPartyId: "parent company", employeeRange: "employee range", annualRevenue: "annual revenue", purchaseTimeframe: "purchase timeframe",
});
export function fieldLabel(key) {
  if (OVERRIDES[key]) return OVERRIDES[key];
  return String(key).replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
}
// "Updated company, expected close date" (at most four named, then "and N more").
export function updatedSummary(keys) {
  const names = [...new Set(keys.map(fieldLabel))];
  return `Updated ${names.slice(0, 4).join(", ")}${names.length > 4 ? ` and ${names.length - 4} more` : ""}`;
}
