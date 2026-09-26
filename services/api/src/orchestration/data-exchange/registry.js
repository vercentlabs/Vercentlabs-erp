// Registered imports and exports. There is no generic "write any table"
// importer: each entry names its module, permissions and limits, and the
// module owns field meaning, validation, duplicates and the mutation. The
// platform owns parsing (core/platform/data-exchange), upload limits, job
// orchestration and export artifacts (core/platform/files).
export const DATA_EXCHANGE_DEFINITIONS = Object.freeze([
  Object.freeze({
    key: "crm.leads.import",
    kind: "import",
    moduleKey: "crm",
    label: "Import leads (CSV)",
    permissions: Object.freeze(["crm.import", "crm.leads.manage"]),
    maximumRows: 5000,
    stages: Object.freeze(["analyze", "preview", "commit", "rollback"]),
  }),
  Object.freeze({
    key: "crm.leads.export",
    kind: "export",
    moduleKey: "crm",
    label: "Export leads (CSV)",
    permissions: Object.freeze(["crm.export"]),
    maximumRows: 10000,
    artifactTtlHours: 24,
    stages: Object.freeze(["enqueue", "build", "download"]),
  }),
]);

export function getDataExchangeDefinition(key) {
  return DATA_EXCHANGE_DEFINITIONS.find((definition) => definition.key === key) ?? null;
}
