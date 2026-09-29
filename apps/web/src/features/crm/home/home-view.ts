import type {
  CrmDashboardMetrics,
  CrmDashboardQualification,
  CrmDashboardScope,
} from "../dashboard/types.ts";

// CRM Home's scope, period and drill-down rules. Every link here opens a
// record list filtered by the same owner and date predicates the server used
// for the figure (getCrmDashboard / buildFilters), so a list's count
// reconciles to the number that was clicked. Pure functions: no React.

export const HOME_SCOPES: Array<{ id: CrmDashboardScope; label: string }> = [
  { id: "mine", label: "Mine" },
  { id: "team", label: "My team" },
  { id: "all", label: "All I can see" },
];

export const PERIOD_OPTIONS = [
  { value: "this_month", label: "This month" },
  { value: "last_month", label: "Last month" },
  { value: "this_quarter", label: "This quarter" },
  { value: "last_90_days", label: "Last 90 days" },
  { value: "year_to_date", label: "Year to date" },
  { value: "custom", label: "Custom" },
];

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const iso = (date: Date) => date.toISOString().slice(0, 10);

// Presets resolve to explicit dates, so a shared link or a drill-down always
// carries the exact range that produced the figure.
export function presetRange(
  preset: string,
  now = new Date(),
): { from: string; to: string } | null {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const today = iso(now);
  if (preset === "this_month")
    return { from: iso(new Date(Date.UTC(y, m, 1))), to: today };
  if (preset === "last_month")
    return {
      from: iso(new Date(Date.UTC(y, m - 1, 1))),
      to: iso(new Date(Date.UTC(y, m, 0))),
    };
  if (preset === "this_quarter")
    return { from: iso(new Date(Date.UTC(y, m - (m % 3), 1))), to: today };
  if (preset === "last_90_days")
    return { from: iso(new Date(now.getTime() - 89 * 86400000)), to: today };
  if (preset === "year_to_date")
    return { from: iso(new Date(Date.UTC(y, 0, 1))), to: today };
  return null;
}

export type HomeFilters = {
  scope: CrmDashboardScope;
  preset: string;
  from: string;
  to: string;
};

// Home opens on "Mine" and "This month"; the URL overrides both. Anything
// unrecognised falls back to the default rather than reaching the server.
export function resolveHomeFilters(
  get: (key: string) => string | null,
  now = new Date(),
): HomeFilters {
  const rawScope = get("scope") ?? "";
  const scope = (
    ["mine", "team", "all"].includes(rawScope) ? rawScope : "mine"
  ) as CrmDashboardScope;
  const rawPreset = get("period") ?? "this_month";
  const preset =
    rawPreset === "custom" || presetRange(rawPreset, now)
      ? rawPreset
      : "this_month";
  const fallback = presetRange("this_month", now)!;
  if (preset !== "custom")
    return { scope, preset, ...(presetRange(preset, now) ?? fallback) };
  const from = get("from") ?? "";
  const to = get("to") ?? "";
  if (!ISO_DATE.test(from) || !ISO_DATE.test(to) || to < from)
    return { scope, preset: "this_month", ...fallback };
  return { scope, preset, from, to };
}

// "2026-09" → the month's first and last day.
export function monthRange(month: string): { from: string; to: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  return {
    from: iso(new Date(Date.UTC(year, monthNumber - 1, 1))),
    to: iso(new Date(Date.UTC(year, monthNumber, 0))),
  };
}

export function monthLabel(month: string): string {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
}

export function homeLinks(
  scope: CrmDashboardScope,
  period: { from: string; to: string },
) {
  const owner = scope === "mine" ? "me" : scope === "team" ? "team" : null;
  const withOwner = (path: string) =>
    owner ? `${path}${path.includes("?") ? "&" : "?"}ownerId=${owner}` : path;
  const taskScope =
    scope === "mine"
      ? "mine=true"
      : scope === "team"
        ? "myTeam=true"
        : "mine=false";
  const createdIn = (range: { from: string; to: string }) =>
    `includeConverted=true&createdFrom=${range.from}&createdTo=${range.to}`;
  return {
    openOpportunities: withOwner("/crm/opportunities?status=open"),
    openLeads: withOwner("/crm/leads"),
    wonInPeriod: withOwner(
      `/crm/opportunities?status=won&closedFrom=${period.from}&closedTo=${period.to}`,
    ),
    stage: (stageId: string) =>
      withOwner(
        `/crm/opportunities?status=open&stageId=${encodeURIComponent(stageId)}`,
      ),
    qualification: (key: CrmDashboardQualification["key"]) =>
      withOwner(`/crm/leads?qualification=${key}`),
    createdInMonth: (month: string) =>
      withOwner(`/crm/leads?${createdIn(monthRange(month))}`),
    convertedInMonth: (month: string) => {
      const range = monthRange(month);
      return withOwner(
        `/crm/leads?status=converted&convertedFrom=${range.from}&convertedTo=${range.to}`,
      );
    },
    // Only a named source has a filter; "Unspecified" and "Other" do not.
    source: (sourceId: string | null) =>
      sourceId
        ? withOwner(
            `/crm/leads?${createdIn(period)}&sourceId=${encodeURIComponent(sourceId)}`,
          )
        : undefined,
    overdueTasks: `/crm/tasks?due=overdue&${taskScope}`,
    stalledOpportunities: withOwner("/crm/opportunities?stalled=true"),
    dwellBreachedLeads: withOwner("/crm/leads?dwellBreached=true"),
    unassignedLeads: "/crm/leads?ownerId=unassigned",
    awaitingQualification: withOwner("/crm/leads?qualification=not_reviewed"),
  };
}

export type AttentionItem = {
  id: string;
  label: string;
  hint: string;
  count: number;
  href: string;
  urgent?: boolean;
};

// Only actionable exceptions, and only when there is at least one. Setup
// gaps (territory coverage) belong in Settings, and hot leads are an
// opportunity, not an exception, so neither is here.
export function attentionItems(
  metrics: CrmDashboardMetrics,
  links: ReturnType<typeof homeLinks>,
): AttentionItem[] {
  const items: AttentionItem[] = [
    {
      id: "overdue-tasks",
      label: "Overdue tasks",
      hint: "Past their due time",
      count: metrics.overdueTasks,
      href: links.overdueTasks,
      urgent: true,
    },
    {
      id: "stalled-opportunities",
      label: "Stalled opportunities",
      hint: "Longer in their stage than it allows",
      count: metrics.stalledOpportunities,
      href: links.stalledOpportunities,
    },
    {
      id: "unassigned-leads",
      label: "Unassigned leads",
      hint: "Nobody owns these yet",
      count: metrics.unassignedLeads,
      href: links.unassignedLeads,
    },
    {
      id: "awaiting-qualification",
      label: "Leads awaiting qualification",
      hint: "No qualification decision yet",
      count: metrics.needsQualificationLeads,
      href: links.awaitingQualification,
    },
    {
      id: "dwell-breached-leads",
      label: "Leads stuck in a stage",
      hint: "Longer in their stage than it allows",
      count: metrics.dwellBreachedLeads,
      href: links.dwellBreachedLeads,
    },
  ];
  return items.filter((item) => item.count > 0);
}
