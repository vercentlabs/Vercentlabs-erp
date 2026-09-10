export type CrmPageArchetype =
  | "home"
  | "list-work-queue"
  | "record-360"
  | "board"
  | "calendar"
  | "inbox"
  | "analytics"
  | "data-operations"
  | "setup-catalog"
  | "setup-rule"
  | "feature-directory";

export type CrmRouteContract = {
  pattern: RegExp;
  label: string;
  archetype: CrmPageArchetype;
  content: "standard" | "wide" | "board";
};

/**
 * Canonical presentation contract for every CRM route. Route files own data;
 * this registry owns page geometry and interaction density so CRM screens do
 * not invent independent shells.
 */
export const CRM_ROUTE_CONTRACTS: readonly CrmRouteContract[] = [
  { pattern: /^\/crm$/, label: "CRM Home", archetype: "home", content: "wide" },
  { pattern: /^\/crm\/(?:leads|accounts|contacts|opportunities)$/, label: "CRM records", archetype: "list-work-queue", content: "wide" },
  { pattern: /^\/crm\/(?:leads|accounts|contacts|opportunities)\/[^/]+$/, label: "CRM record", archetype: "record-360", content: "wide" },
  { pattern: /^\/crm\/pipeline$/, label: "Pipeline", archetype: "board", content: "board" },
  { pattern: /^\/crm\/calendar$/, label: "Calendar", archetype: "calendar", content: "wide" },
  { pattern: /^\/crm\/inbox$/, label: "Team inbox", archetype: "inbox", content: "wide" },
  { pattern: /^\/crm\/(?:forecast|reports)$/, label: "CRM insights", archetype: "analytics", content: "wide" },
  { pattern: /^\/crm\/(?:work|tasks|calls|meetings|follow-ups|activities)$/, label: "CRM work", archetype: "list-work-queue", content: "wide" },
  { pattern: /^\/crm\/data-management$/, label: "Data management", archetype: "data-operations", content: "standard" },
  { pattern: /^\/crm\/features$/, label: "All CRM features", archetype: "feature-directory", content: "standard" },
  { pattern: /^\/crm\/(?:assignment-rules|duplicate-rules|lead-lifecycle|lead-scoring|stages|lost-reasons|sources)$/, label: "CRM setup", archetype: "setup-rule", content: "standard" },
  { pattern: /^\/crm\/settings$/, label: "CRM setup", archetype: "setup-catalog", content: "standard" },
  { pattern: /^\/crm\/[^/]+$/, label: "CRM configuration", archetype: "setup-catalog", content: "standard" },
] as const;

export function resolveCrmRouteContract(pathname: string): CrmRouteContract {
  return (
    CRM_ROUTE_CONTRACTS.find((route) => route.pattern.test(pathname)) ?? {
      pattern: /^\/crm/,
      label: "CRM",
      archetype: "list-work-queue",
      content: "wide",
    }
  );
}
