// The registry of shared configuration keys and feature flags. Only keys
// listed here can be written; each has a typed validator and a default, and a
// consumer in the code that actually reads it.
//
//   audience "tenant"    organisation administrators manage it in
//                        Settings > Feature configuration
//                        (platform.configuration.manage).
//   audience "operator"  engineering/operations rollout controls: never shown
//                        in or writable from tenant Settings.
const integer = (minimum, maximum) => (value) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) throw new RangeError(`Enter a whole number from ${minimum} to ${maximum}.`);
  return number;
};
const boolean = (value) => {
  if (typeof value !== "boolean") throw new TypeError("Choose on or off.");
  return value;
};

export const CONFIGURATION_DEFINITIONS = Object.freeze([
  Object.freeze({
    namespace: "platform.exports",
    key: "artifact_retention_hours",
    kind: "setting",
    audience: "tenant",
    label: "Keep export files for",
    unit: "hours",
    description: "How long a generated export file (for example a lead export) can be downloaded before it expires and is deleted.",
    risk: "low",
    input: { type: "integer", minimum: 1, maximum: 168 },
    defaultValue: 24,
    validate: integer(1, 168),
    consumedBy: "CRM lead export (completeCrmLeadExportJob)",
  }),
  Object.freeze({
    namespace: "platform.webhooks",
    key: "max_delivery_attempts",
    kind: "setting",
    audience: "tenant",
    label: "Webhook delivery attempts",
    unit: "attempts",
    description: "How many times a failing webhook delivery is tried before it is marked failed for good.",
    risk: "low",
    input: { type: "integer", minimum: 3, maximum: 10 },
    defaultValue: 8,
    validate: integer(3, 10),
    consumedBy: "Worker webhook delivery",
  }),
  Object.freeze({
    namespace: "platform.workflows",
    key: "enabled",
    kind: "flag",
    audience: "tenant",
    label: "Run automations",
    description: "When off, no automation runs for new events (existing run history is kept).",
    risk: "medium",
    input: { type: "boolean" },
    defaultValue: true,
    validate: boolean,
    consumedBy: "Workflow dispatcher",
  }),
  Object.freeze({
    namespace: "operator.webhooks",
    key: "delivery_paused",
    kind: "flag",
    audience: "operator",
    label: "Pause webhook delivery (operator)",
    description: "Engineering kill switch: deliveries queue up but are not sent.",
    risk: "high",
    input: { type: "boolean" },
    defaultValue: false,
    validate: boolean,
    consumedBy: "Worker webhook delivery",
  }),
]);

export function getConfigurationDefinition(namespace, key) {
  return CONFIGURATION_DEFINITIONS.find((definition) => definition.namespace === namespace && definition.key === key) ?? null;
}
