// Field keys in history text ("Updated companyName", "companyName: A → B") shown as the labels people see on the forms ("Company name").
const LABELS: Record<string, string> = {
  ownerUserId: "Owner", ownerId: "Owner", assignedTo: "Assigned to", teamId: "Team", sourceId: "Source", stageId: "Stage", pipelineId: "Pipeline",
  partyId: "Company", accountId: "Company", primaryContactId: "Primary contact", contactId: "Contact", leadId: "Lead", opportunityId: "Deal",
  expectedCloseDate: "Close date", estimatedValue: "Value", amount: "Value", dueAt: "Due", dueDate: "Due date", dueTime: "Due time",
  scheduledDate: "Date", scheduledTime: "Time", reminderOffsetMinutes: "Reminder", fullName: "Name", firstName: "First name", lastName: "Last name",
  companyName: "Company", jobTitle: "Job title", productInterest: "Product / service interest", purchaseTimeframe: "Purchase timeframe",
  sourceDetail: "Source detail", displayName: "Name", legalName: "Legal name", accountType: "Type", parentPartyId: "Parent company",
  nextStep: "Next step", nextStepDueDate: "Next step date", businessProblem: "Business problem", proposedSolution: "Proposed solution",
  commercialNotes: "Commercial notes", winProbability: "Probability", probability: "Probability", currencyCode: "Currency",
};

export function fieldLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const words = key.replace(/Id$/, "").replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Every camelCase or snake_case field key inside a history line, replaced by its label.
export function readableHistory(text: string | null | undefined): string {
  if (!text) return "";
  return text.replace(/\b([a-z]+(?:[A-Z][a-z0-9]*)+|[a-z]+(?:_[a-z0-9]+)+)\b/g, (key) => fieldLabel(key));
}
