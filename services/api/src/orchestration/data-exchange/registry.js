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
    label: "Import leads (CSV or XLSX)",
    permissions: Object.freeze(["crm.leads.import", "crm.leads.create"]),
    maximumRows: 2000,
    stages: Object.freeze(["analyze", "import"]),
  }),
  Object.freeze({
    key: "crm.leads.export",
    kind: "export",
    moduleKey: "crm",
    label: "Export leads (CSV)",
    permissions: Object.freeze(["crm.leads.export"]),
    maximumRows: 10000,
    stages: Object.freeze(["download"]),
  }),
]);

export function getDataExchangeDefinition(key) {
  return DATA_EXCHANGE_DEFINITIONS.find((definition) => definition.key === key) ?? null;
}
