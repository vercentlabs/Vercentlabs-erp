"use client";

// CRM Setup: every CRM setting on one page, in the order a new company sets them up. Each row opens its existing page and says, in a few
// words, what is set now, so an administrator sees the whole configuration without opening each page. Only the rows the person may open are
// listed; each page keeps enforcing its own permission.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { PageHeader, PermissionState } from "@vercentlabs/design-system";

import { listCloseReasons } from "@/features/crm/close-reasons/api/close-reasons-api";
import { getLeadAssignmentSettings, getLeadQualificationSettings, listLeadAssignmentRules, listLeadSources, listLeadStages } from "@/features/crm/leads/api/leads-api";
import { listSalesStages } from "@/features/crm/sales-stages/api/sales-stages-api";
import { getWorkDefaults } from "@/features/crm/settings/screens/WorkDefaultsScreen";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";

type Row = { id: string; step: number | null; title: string; purpose: string; href: string; permission: string; state: () => Promise<string>; external?: boolean };
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;
const listWords = (words: string[]) => (words.length <= 1 ? words.join("") : `${words.slice(0, -1).join(", ")} and ${words[words.length - 1]}`);

const ROWS: Row[] = [
  { id: "lead-stages", step: 1, title: "Lead stages", purpose: "The steps a lead moves through before it is qualified, converted or disqualified.", href: "/crm/settings/leads/stages",
    permission: "crm.settings.manage", state: async () => plural((await listLeadStages()).filter((row) => row.isActive).length, "stage") },
  { id: "lead-sources", step: 2, title: "Lead sources", purpose: "Where leads come from, for routing and attribution.", href: "/crm/settings/leads/sources",
    permission: "crm.settings.manage", state: async () => plural((await listLeadSources()).filter((row) => row.isActive).length, "source") },
  { id: "qualification", step: 3, title: "Qualification", purpose: "What must be known about a lead before it can be qualified.", href: "/crm/settings/leads/qualification",
    permission: "crm.settings.manage", state: async () => {
      const required = Object.entries(await getLeadQualificationSettings()).filter(([, on]) => on).map(([key]) => key[0].toUpperCase() + key.slice(1));
      return required.length ? `${listWords(required)} required` : "Nothing required";
    } },
  { id: "assignment", step: 4, title: "Assignment", purpose: "How a lead gets its owner: rules in order, then the fallback, and the workload.", href: "/crm/settings/leads/assignment",
    permission: "crm.settings.manage", state: async () => {
      const [rules, settings] = await Promise.all([listLeadAssignmentRules(), getLeadAssignmentSettings()]);
      const active = rules.filter((rule) => rule.isActive).length;
      const fallback = settings.fallbackMode === "user" ? `falls back to ${settings.fallbackUserName ?? "a person"}` : settings.fallbackMode === "team" ? "falls back to a team" : "unmatched leads wait unassigned";
      return `${plural(active, "rule")}, ${fallback}`;
    } },
  { id: "deal-stages", step: 5, title: "Deal stages", purpose: "The stages of the pipeline, with their default probability and guidance.", href: "/crm/settings/opportunities/stages",
    permission: "crm.settings.manage", state: async () => plural((await listSalesStages()).filter((row) => row.isActive).length, "stage") },
  { id: "close-reasons", step: 6, title: "Won and lost reasons", purpose: "Why deals are won or lost, and what each reason asks for.", href: "/crm/settings/opportunities/close-reasons",
    permission: "crm.opportunities.manage_close_reasons", state: async () => {
      const reasons = (await listCloseReasons()).filter((row) => row.active);
      return `${plural(reasons.filter((row) => row.outcome === "won").length, "won reason")}, ${plural(reasons.filter((row) => row.outcome === "lost").length, "lost reason")}`;
    } },
  { id: "defaults", step: 7, title: "Task and follow-up defaults", purpose: "The priority, type and reminder a new task or follow-up starts with.", href: "/crm/settings/defaults/tasks",
    permission: "crm.settings.manage", state: async () => {
      const { defaults, choices } = await getWorkDefaults();
      const label = (list: Array<{ code: string; label: string }>, code: string) => list.find((entry) => entry.code === code)?.label ?? code;
      const reminder = (minutes: number | null, list: Array<{ minutes: number; label: string }>) => (minutes === null ? "no reminder" : `reminder ${list.find((entry) => entry.minutes === minutes)?.label ?? `${minutes} min`}`);
      return `Tasks: ${label(choices.taskPriorities, defaults.taskPriority)}, ${reminder(defaults.taskReminderMinutes, choices.taskReminderOptions)} · Follow-ups: ${label(choices.followUpTypes, defaults.followUpType)}, ${reminder(defaults.followUpReminderMinutes, choices.followUpReminderOptions)}`;
    } },
  { id: "duplicates", step: 8, title: "How duplicates are found", purpose: "What is compared for people and companies, and which matches block saving.", href: "/crm/settings/data-quality",
    permission: "crm.settings.manage", state: async () => "Strong matches block saving; possible matches warn" },
  { id: "teams", step: null, title: "Teams", purpose: "The sales teams leads and deals are assigned to. Opens in Settings.", href: "/settings/teams", permission: "crm.settings.manage",
    state: async () => "Opens Settings", external: true },
];

export function CrmSetupScreen() {
  const workspace = useWorkspaceContext();
  const owner = workspace.roleSlugs.includes("organization_owner");
  const rows = ROWS.filter((row) => owner || workspace.permissions.includes(row.permission));
  if (!rows.length) return <PermissionState title="You do not have access to CRM Setup" description="Ask a CRM administrator for access." />;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Setup" description="Every CRM setting, in the order a company usually sets them up. Each row shows what is set now." />
      <ol className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
        {rows.map((row) => <SetupRow key={row.id} row={row} />)}
      </ol>
    </div>
  );
}

function SetupRow({ row }: { row: Row }) {
  const workspace = useWorkspaceContext();
  const state = useQuery({ queryKey: scopedQueryKey(workspace, "crm", "setup-state", row.id), queryFn: row.state, staleTime: 30_000, retry: false });
  return (
    <li>
      <Link href={row.href} className="group flex items-center gap-4 p-4 transition-colors hover:bg-surface-muted focus-visible:ring-2 focus-visible:ring-brand focus-visible:outline-none">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-brand-soft text-sm font-semibold text-brand" aria-hidden="true">{row.step ?? "—"}</span>
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-semibold text-text">{row.title}</span>
          <span className="text-sm text-text-secondary">{row.purpose}</span>
        </span>
        <span className="hidden max-w-[45%] text-right text-sm text-text-secondary md:block">
          {state.isLoading ? "…" : state.isError ? "—" : state.data}
        </span>
        <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-text-muted group-hover:text-text" />
      </Link>
    </li>
  );
}
