const LIST_FIELDS = new Set([
  "allowedOrigins",
  "requiredFields",
  "eventTypes",
  "objectives",
  "risks",
  "whiteSpace",
  "successPlan",
  "responseOptions",
  "evidence",
  "issues",
  "scopes",
  "recommendedActions",
  "dimensions",
  "measures",
  "options",
  "requestedFields",
  "columns",
]);

const FIELD_CONFIG = {
  customData: ["key-value", "Additional details", "Add optional labelled details without exposing technical storage syntax."],
  comparisonValue: ["value", "Comparison value", "Enter the value this rule should compare against."],
  criteria: ["key-value", "Matching criteria", "Add each CRM field and the value that must match."],
  roundRobinUserIds: ["list", "Round-robin users", "Choose the users who should receive records in rotation.", "users"],
  conditions: ["key-value", "Conditions", "Add each event field and the expected value required to run this automation."],
  actions: ["actions", "Actions", "Add one or more governed actions. Each action can be configured with labelled settings."],
  allowedOrigins: ["list", "Allowed website domains", "Add each trusted website origin, for example https://example.com."],
  requiredFields: ["list", "Required form fields", "Add the field names that must be completed before submission."],
  configuration: ["key-value", "Configuration details", "Add non-secret configuration as labelled values. Secrets must stay in the secret manager."],
  eventTypes: ["list", "Event types", "Add each event this integration or webhook should receive."],
  filters: ["key-value", "Filters", "Add the field and value used to limit the records included."],
  sort: ["key-value", "Sorting rules", "Add a field and its direction, such as createdAt and desc."],
  columns: ["list", "Display columns", "Add the fields that should appear in the saved view or report."],
  assignmentRules: ["key-value", "Assignment rules", "Add the criteria used to assign records in this territory."],
  objectives: ["list", "Objectives", "Add each account objective separately."],
  risks: ["list", "Risks", "Add each account risk separately."],
  whiteSpace: ["list", "Growth opportunities", "Add each identified cross-sell or expansion opportunity."],
  successPlan: ["list", "Success plan", "Add each agreed success step separately."],
  responseOptions: ["list", "Response choices", "Add the choices users can select for this question."],
  response: ["value", "Response details", "Enter the response value. The system stores its original data type."],
  evidence: ["list", "Evidence", "Add each supporting item or observation separately."],
  issues: ["list", "Issues", "Add each issue separately so it can be reviewed clearly."],
  metadata: ["key-value", "Additional metadata", "Add optional labelled metadata. This section is normally maintained by integrations."],
  availability: ["schedule", "Weekly availability", "Set the days and times when this meeting link can accept bookings."],
  scopes: ["list", "Access scopes", "Add each permitted integration scope."],
  recommendedActions: ["list", "Recommended actions", "Add each recommended next action separately."],
  actionPayload: ["key-value", "Action details", "Add the labelled values required when this recommendation is executed."],
  dimensions: ["list", "Report dimensions", "Add the fields used to group or segment this report."],
  measures: ["list", "Report measures", "Add the numeric measures calculated by this report."],
  layout: ["key-value", "Dashboard layout", "Configure the dashboard layout using labelled values."],
  position: ["key-value", "Widget position", "Set the widget row, column, width and height."],
  validation: ["key-value", "Validation rules", "Add each validation rule and its expected value."],
  options: ["list", "Options", "Add each selectable option separately."],
  defaultValue: ["value", "Default value", "Enter the value used when no value is supplied."],
  data: ["key-value", "Record details", "Add the custom fields and values for this record."],
  requestedFields: ["list", "Requested enrichment fields", "Add each field the provider should enrich."],
  resultData: ["key-value", "Enrichment result", "Review or enter the labelled values returned by the provider."],
  explanation: ["key-value", "Explanation details", "Add the factors and evidence behind this result."],
  inputSnapshot: ["key-value", "Input snapshot", "Review the labelled input values used for this calculation."],
  correctedValue: ["value", "Corrected value", "Enter the approved corrected value."],
};

export const STRUCTURED_FIELD_KINDS = Object.freeze([
  "list",
  "key-value",
  "actions",
  "schedule",
  "value",
]);

export const STRUCTURED_FIELD_CONFIG = Object.freeze(
  Object.fromEntries(
    Object.entries(FIELD_CONFIG).map(([name, value]) => [
      name,
      Object.freeze({
        kind: value[0],
        label: value[1],
        helpText: value[2],
        ...(value[3] ? { optionsKey: value[3] } : {}),
      }),
    ]),
  ),
);

export function stripTechnicalJsonLabel(label) {
  return String(label || "")
    .replace(/\s+JSON\b/gi, "")
    .replace(/\bJSON\s+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function getStructuredFieldConfig(name, label = "") {
  const configured = STRUCTURED_FIELD_CONFIG[String(name || "")];
  if (configured) return configured;
  if (/\bJSON\b/i.test(String(label || ""))) {
    return Object.freeze({
      kind: LIST_FIELDS.has(String(name || "")) ? "list" : "key-value",
      label: stripTechnicalJsonLabel(label) || "Structured details",
      helpText:
        "Add the information using guided fields. Technical storage syntax remains hidden.",
    });
  }
  return null;
}

export function isStructuredField(name, label = "") {
  return Boolean(getStructuredFieldConfig(name, label));
}

export function emptyStructuredValue(kind) {
  if (kind === "list" || kind === "actions") return [];
  if (kind === "key-value" || kind === "schedule") return {};
  return "";
}

export function parseStructuredValue(value, kind = "key-value") {
  if (value === undefined || value === null || value === "") {
    return emptyStructuredValue(kind);
  }
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed) return emptyStructuredValue(kind);
  try {
    return JSON.parse(trimmed);
  } catch {
    if (kind === "list") {
      return trimmed
        .split(/\r?\n|,/)
        .map((item) => item.trim())
        .filter(Boolean);
    }
    return trimmed;
  }
}

export function stringifyStructuredValue(value) {
  if (value === undefined || value === null || value === "") return "";
  return JSON.stringify(value);
}

export function structuredValueSummary(value, label = "details") {
  const parsed = parseStructuredValue(value, "value");
  if (parsed === undefined || parsed === null || parsed === "") return "Not configured";
  if (Array.isArray(parsed)) {
    return parsed.length
      ? `${parsed.length} ${parsed.length === 1 ? "item" : "items"} configured`
      : "Not configured";
  }
  if (typeof parsed === "object") {
    const count = Object.keys(parsed).length;
    return count
      ? `${count} ${count === 1 ? "value" : "values"} configured`
      : "Not configured";
  }
  if (typeof parsed === "boolean") return parsed ? "Yes" : "No";
  return String(parsed || label);
}
