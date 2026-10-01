// Registered report datasets. A dataset exists only when it can be served by
// the owning module's authoritative, scoped read - the same list function the
// module's screens use - so a report never sees more than the screen does
// (company/branch/record scope, ownership rules, margin redaction). Columns
// are an explicit allow-list: contact PII (email, phone) is not exportable
// through shared reports at all.
import { listSalesOrders } from "../../modules/sales/index.js";
import { BREAKDOWN_DIMENSIONS, getMetricDrilldown, getMetricRollup, listCrmRecords, PIPELINE_METRICS } from "../../modules/crm/index.js";

// CRM analytical datasets (F030) are computed by the canonical CRM metric
// layer (metric-definitions.js), so a saved or scheduled report shows the
// same figures as the pipeline dashboard and its drill-downs.
const CRM_ANALYTICS_FILTERS = Object.freeze([
  { key: "from", label: "From (YYYY-MM-DD)" },
  { key: "to", label: "To (YYYY-MM-DD)" },
  { key: "pipelineId", label: "Pipeline" },
  { key: "stageId", label: "Stage" },
  { key: "teamId", label: "Sales team (includes sub-teams)" },
  { key: "territoryId", label: "Territory (includes sub-territories)" },
  { key: "ownerId", label: "Owner" },
  { key: "sourceId", label: "Source" },
  { key: "forecastCategory", label: "Forecast category" },
]);
const ROLLUP_METRICS = Object.freeze(["open_opportunities", "open_pipeline", "weighted_pipeline", "closing_in_period", "commit", "best_case", "won_amount", "won_count", "lost_amount", "lost_count", "win_rate", "stalled_opportunities"]);
const analyticsFilters = (filters) => Object.fromEntries(CRM_ANALYTICS_FILTERS.map(({ key }) => [key, filters[key]]).filter(([, value]) => value));

const PAGE = 500;

export const REPORT_DATASETS = Object.freeze([
  Object.freeze({
    key: "crm.leads",
    moduleKey: "crm",
    schedulePermission: "crm.reports.schedule",
    label: "CRM leads",
    description: "Leads you can see in CRM, with status, rating and value.",
    requiredPermissions: Object.freeze(["crm.view", "crm.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "code", label: "Code" },
      { key: "firstName", label: "First name" },
      { key: "lastName", label: "Last name" },
      { key: "companyName", label: "Company" },
      { key: "status", label: "Status" },
      { key: "priority", label: "Priority" },
      { key: "rating", label: "Rating" },
      { key: "estimatedValue", label: "Estimated value" },
      { key: "currencyCode", label: "Currency" },
      { key: "city", label: "City" },
      { key: "state", label: "State" },
      { key: "countryCode", label: "Country" },
      { key: "createdAt", label: "Created" },
    ]),
    filters: Object.freeze([
      { key: "status", label: "Status" },
      { key: "search", label: "Search" },
    ]),
    async execute(client, context, filters, maxRows) {
      const rows = [];
      for (let offset = 0; rows.length < maxRows; offset += PAGE) {
        const page = await listCrmRecords(client, context, "leads", { ...filters, limit: PAGE, offset });
        rows.push(...page.rows);
        if (page.rows.length < PAGE || offset + PAGE >= page.total) break;
      }
      return rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "crm.pipeline_analysis",
    moduleKey: "crm",
    label: "CRM pipeline analysis",
    description: "Pipeline, forecast and win/loss measures grouped by stage, owner, team, territory, source, category, pipeline or close month.",
    requiredPermissions: Object.freeze(["crm.view", "crm.reports.view"]),
    schedulePermission: "crm.reports.schedule",
    maxRows: 5_000,
    columns: Object.freeze([
      { key: "group", label: "Group" },
      ...ROLLUP_METRICS.map((key) => ({ key, label: PIPELINE_METRICS[key].label })),
    ]),
    filters: Object.freeze([
      { key: "groupBy", label: "Group by" },
      { key: "sortBy", label: "Sort by" },
      { key: "sortDirection", label: "Sort direction" },
      ...CRM_ANALYTICS_FILTERS,
    ]),
    async execute(client, context, filters, maxRows) {
      const dimension = filters.groupBy && BREAKDOWN_DIMENSIONS[filters.groupBy] ? filters.groupBy : "stage";
      const rollup = await getMetricRollup(client, context, { dimension, metrics: ROLLUP_METRICS, filters: analyticsFilters(filters) });
      const rows = rollup.rows.map((row) => ({ group: row.label, ...row.values }));
      const sortBy = ROLLUP_METRICS.includes(filters.sortBy) ? filters.sortBy : null;
      if (sortBy) {
        const direction = filters.sortDirection === "asc" ? 1 : -1;
        rows.sort((a, b) => ((a[sortBy] ?? -Infinity) - (b[sortBy] ?? -Infinity)) * direction || String(a.group).localeCompare(String(b.group)));
      }
      return rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "crm.opportunity_records",
    moduleKey: "crm",
    label: "CRM opportunities behind a measure",
    description: "The exact opportunities behind a pipeline measure (for example Commit or Won), with converted amounts.",
    requiredPermissions: Object.freeze(["crm.view", "crm.reports.view"]),
    schedulePermission: "crm.reports.schedule",
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "code", label: "Code" },
      { key: "name", label: "Opportunity" },
      { key: "status", label: "Status" },
      { key: "stageName", label: "Stage" },
      { key: "ownerName", label: "Owner" },
      { key: "teamName", label: "Sales team" },
      { key: "territoryName", label: "Territory" },
      { key: "forecastCategory", label: "Forecast category" },
      { key: "probability", label: "Probability" },
      { key: "amount", label: "Amount" },
      { key: "currencyCode", label: "Currency" },
      { key: "amountReporting", label: "Amount (reporting currency)" },
      { key: "weightedReporting", label: "Weighted (reporting currency)" },
      { key: "expectedCloseDate", label: "Expected close" },
      { key: "actualCloseDate", label: "Closed on" },
    ]),
    filters: Object.freeze([{ key: "metric", label: "Measure" }, ...CRM_ANALYTICS_FILTERS]),
    async execute(client, context, filters, maxRows) {
      const metric = PIPELINE_METRICS[filters.metric] ? filters.metric : "open_pipeline";
      const rows = [];
      let cursor = null;
      do {
        const page = await getMetricDrilldown(client, context, { metric, filters: analyticsFilters(filters), cursor, limit: 200 });
        rows.push(...page.records);
        cursor = page.nextCursor;
      } while (cursor && rows.length < maxRows);
      return rows.slice(0, maxRows);
    },
  }),
  Object.freeze({
    key: "sales.orders",
    moduleKey: "sales",
    label: "Sales orders",
    description: "Sales orders you can see in Sales, with status and totals.",
    requiredPermissions: Object.freeze(["sales.view", "sales.reports.view"]),
    maxRows: 10_000,
    columns: Object.freeze([
      { key: "sales_order_number", label: "Order number" },
      { key: "customer_name", label: "Customer" },
      { key: "order_date", label: "Order date" },
      { key: "lifecycle_status", label: "Status" },
      { key: "approval_status", label: "Approval" },
      { key: "fulfillment_status", label: "Fulfilment" },
      { key: "billing_status", label: "Billing" },
      { key: "currency_code", label: "Currency" },
      { key: "grand_total", label: "Total" },
    ]),
    filters: Object.freeze([
      { key: "status", label: "Status" },
      { key: "search", label: "Search" },
    ]),
    async execute(client, context, filters, maxRows) {
      const rows = [];
      for (let offset = 0; rows.length < maxRows; offset += PAGE) {
        const page = await listSalesOrders(client, context, { ...filters, limit: PAGE, offset });
        rows.push(...page);
        if (page.length < PAGE) break;
      }
      return rows.slice(0, maxRows);
    },
  }),
]);

export function getReportDataset(key) {
  return REPORT_DATASETS.find((dataset) => dataset.key === key) ?? null;
}
