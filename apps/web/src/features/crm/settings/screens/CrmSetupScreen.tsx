"use client";

// CRM Setup: every CRM setting on one page, grouped by what it is for (CRM audit: Get started · Get leads in · Lead process · Deal
// process · Talk to customers · Marketing · Advanced). Each row opens its existing page and says, in a few words, what is set now, so an
// administrator sees the whole configuration without opening each page. Only the rows the person may open are listed; each page keeps
// enforcing its own permission.
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { PageHeader, PermissionState } from "@vercentlabs/design-system";

import { listActivityTypes } from "@/features/crm/activity-types/activity-types-api";
import { getLeadScoring, listCustomFields, listRecurringPlans } from "@/features/crm/shared/fields-api";
import { listHolidays } from "@/features/crm/shared/gst-api";
import { getLeadsSwitch } from "./LeadsSwitchScreen";
import { listChatChannels } from "@/features/crm/chat/ChatChannelsScreen";
import { listCaptureForms } from "@/features/crm/capture-forms/api/capture-forms-api";
import { listLeadConnectors } from "@/features/crm/connectors/api/connectors-api";
import { listCampaigns, listTags } from "@/features/crm/shared/marketing-api";
import { listEmailTemplates } from "@/features/crm/shared/email-api";
import { getWhatsAppSettings } from "@/features/crm/shared/whatsapp-api";
import { listOptOuts } from "@/features/crm/shared/consent-api";
import { getChannelSettings } from "@/features/crm/shared/channels-api";
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
  { id: "starter-packs", step: null, title: "Industry starter packs", purpose: "Stages, lead sources, fields and lost reasons for your kind of business, in one click.", href: "/crm/settings/starter-packs",
    permission: "crm.settings.manage", state: async () => "FMCG, real estate, education and more" },
  { id: "lead-stages", step: 1, title: "Lead stages", purpose: "The steps a lead moves through before it is qualified, converted or disqualified.", href: "/crm/settings/leads/stages",
    permission: "crm.settings.manage", state: async () => plural((await listLeadStages()).filter((row) => row.isActive).length, "stage") },
  { id: "lead-sources", step: 2, title: "Lead sources", purpose: "Where leads come from, for routing and attribution.", href: "/crm/settings/leads/sources",
    permission: "crm.settings.manage", state: async () => plural((await listLeadSources()).filter((row) => row.isActive).length, "source") },
  { id: "web-forms", step: null, title: "Web forms", purpose: "Forms on your website that bring leads in, with an embed code and a versioned consent notice.", href: "/crm/settings/leads/web-forms",
    permission: "crm.capture.manage", state: async () => plural((await listCaptureForms()).filter((row) => row.status === "active").length, "active form") },
  { id: "privacy", step: null, title: "Privacy and consent", purpose: "The opt-out list, and everything held on one person for a privacy request.", href: "/crm/settings/privacy",
    permission: "crm.settings.manage", state: async () => plural((await listOptOuts()).length, "opt-out") },
  { id: "calendar", step: null, title: "My calendar", purpose: "Your Google or Outlook calendar, kept up to date with your CRM meetings.", href: "/crm/settings/calendar",
    permission: "crm.leads.view", state: async () => "Connect your own calendar" },
  { id: "reminders", step: null, title: "Reminders on your phone", purpose: "Get your follow-up and task reminders on WhatsApp or by SMS as well.", href: "/crm/settings/reminders",
    permission: "crm.leads.view", state: async () => "Choose for yourself" },
  { id: "zoom", step: null, title: "Zoom", purpose: "Your company's Zoom, so meetings can carry a Zoom link CRM makes.", href: "/crm/settings/zoom",
    permission: "crm.settings.manage", state: async () => "Connect your Zoom app" },
  { id: "calls-sms", step: null, title: "Calls and SMS", purpose: "Click-to-call through Exotel, and SMS from DLT templates through Exotel or MSG91.", href: "/crm/settings/calls-sms",
    permission: "crm.settings.manage", state: async () => {
      const settings = await getChannelSettings();
      return [settings.telephony.provider !== "none" ? "Calling on" : "Calling off", settings.sms.provider !== "none" ? "SMS on" : "SMS off"].join(" · ");
    } },
  { id: "whatsapp", step: null, title: "WhatsApp", purpose: "Click-to-chat from records, or your WhatsApp Business number connected so CRM sends and receives.", href: "/crm/settings/whatsapp",
    permission: "crm.settings.manage", state: async () => ((await getWhatsAppSettings()).mode === "cloud_api" ? "Business API connected" : "Click-to-chat") },
  { id: "email-templates", step: null, title: "Email templates", purpose: "Ready emails to send from records, the reply address and the signature.", href: "/crm/settings/email-templates",
    permission: "crm.settings.manage", state: async () => plural((await listEmailTemplates()).length, "active template") },
  { id: "campaigns", step: null, title: "Campaigns", purpose: "What you ran to bring leads in, and the leads, deals and won value each brought.", href: "/crm/settings/campaigns",
    permission: "crm.settings.manage", state: async () => plural((await listCampaigns()).campaigns.filter((row) => row.status === "active").length, "active campaign") },
  { id: "activity-types", step: null, title: "Activity types and plans", purpose: "Your follow-up types with their defaults and next steps, and ready-made sequences of follow-ups.",
    href: "/crm/settings/activity-types", permission: "crm.settings.manage", state: async () => plural((await listActivityTypes()).length, "type") },
  { id: "website-chat", step: null, title: "Website chat", purpose: "A chat box on your website: chats open leads and are answered from CRM.", href: "/crm/settings/website-chat",
    permission: "crm.settings.manage", state: async () => plural((await listChatChannels()).filter((channel) => channel.isActive).length, "chat") },
  { id: "team-access", step: null, title: "Team access", purpose: "Each person's CRM level — Salesperson, Sales manager or CRM administrator — in one place.",
    href: "/crm/settings/team-access", permission: "roles.assign", state: async () => "Set per person" },
  { id: "leads-switch", step: null, title: "Work with leads", purpose: "Leads on, or enquiries straight to deals.", href: "/crm/settings/leads/switch",
    permission: "crm.settings.manage", state: async () => ((await getLeadsSwitch()) ? "Leads on" : "Leads off: enquiries become deals") },
  { id: "history-import", step: null, title: "Past notes and activities", purpose: "Moving in: bring old calls, emails, meetings and notes onto your records, and see how to export from other tools.",
    href: "/crm/data/history-import", permission: "crm.import", state: async () => "Import" },
  { id: "holidays", step: null, title: "Holidays", purpose: "Days off: reminders skip them, response times and stage limits don't count them, and follow-ups planned on one show it.", href: "/crm/settings/holidays",
    permission: "crm.settings.manage", state: async () => plural((await listHolidays()).length, "holiday") },
  { id: "custom-fields", step: null, title: "Custom fields", purpose: "Your own fields on leads and deals, on the forms and record pages.", href: "/crm/settings/custom-fields",
    permission: "crm.settings.manage", state: async () => plural((await listCustomFields("lead")).length + (await listCustomFields("opportunity")).length, "field") },
  { id: "lead-scoring", step: null, title: "Lead scoring", purpose: "Points from your rules, blended with how similar leads converted: a 0–100 score on every lead.",
    href: "/crm/settings/leads/scoring", permission: "crm.settings.manage", state: async () => plural((await getLeadScoring()).rules.filter((rule) => rule.isActive).length, "rule") },
  { id: "recurring-plans", step: null, title: "Repeat orders / AMC", purpose: "Monthly, quarterly, yearly or your own periods for deals whose revenue repeats.",
    href: "/crm/settings/opportunities/recurring-plans", permission: "crm.settings.manage", state: async () => plural((await listRecurringPlans()).length, "plan") },
  { id: "tags", step: null, title: "Tags", purpose: "Labels on leads and deals: rename, recolour or delete them.", href: "/crm/settings/tags",
    permission: "crm.settings.manage", state: async () => plural((await listTags()).length, "tag") },
  { id: "lead-connectors", step: null, title: "Lead connectors", purpose: "Leads from IndiaMART, JustDial, TradeIndia, and Facebook, Instagram and Google lead ads.", href: "/crm/settings/leads/connectors",
    permission: "crm.capture.manage", state: async () => {
      const { connectors } = await listLeadConnectors();
      const problems = connectors.filter((row) => row.lastError).length;
      return `${plural(connectors.filter((row) => row.status === "active").length, "connector")} on${problems ? `, ${problems} with a problem` : ""}`;
    } },
  { id: "email-to-lead", step: null, title: "Email to lead", purpose: "An inbound address whose new emails open leads and whose replies join their record. Opens in Settings.",
    href: "/settings/integrations", permission: "integrations.manage", state: async () => "Opens Settings", external: true },
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
  { id: "deal-stages", step: 5, title: "Pipelines and deal stages", purpose: "Your pipelines and their stages: default probability, guidance, what a deal needs to enter, and time limits.", href: "/crm/settings/opportunities/stages",
    permission: "crm.settings.manage", state: async () => plural((await listSalesStages()).filter((row) => row.isActive).length, "stage") },
  { id: "close-reasons", step: 6, title: "Won and lost reasons", purpose: "Why deals are won or lost, and what each reason asks for.", href: "/crm/settings/opportunities/close-reasons",
    permission: "crm.opportunities.manage_close_reasons", state: async () => {
      const reasons = (await listCloseReasons()).filter((row) => row.active);
      return `${plural(reasons.filter((row) => row.outcome === "won").length, "won reason")}, ${plural(reasons.filter((row) => row.outcome === "lost").length, "lost reason")}`;
    } },
  { id: "defaults", step: 7, title: "Working week and defaults", purpose: "Your working days and hours, and the priority, type and reminder a new task or follow-up starts with.", href: "/crm/settings/defaults/tasks",
    permission: "crm.settings.manage", state: async () => {
      const { defaults, choices } = await getWorkDefaults();
      const label = (list: Array<{ code: string; label: string }>, code: string) => list.find((entry) => entry.code === code)?.label ?? code;
      const reminder = (minutes: number | null, list: Array<{ minutes: number; label: string }>) => (minutes === null ? "no reminder" : `reminder ${list.find((entry) => entry.minutes === minutes)?.label ?? `${minutes} min`}`);
      return `Tasks: ${label(choices.taskPriorities, defaults.taskPriority)}, ${reminder(defaults.taskReminderMinutes, choices.taskReminderOptions)} · Follow-ups: ${label(choices.followUpTypes, defaults.followUpType)}, ${reminder(defaults.followUpReminderMinutes, choices.followUpReminderOptions)}`;
    } },
  { id: "teams", step: null, title: "Teams", purpose: "The sales teams leads and deals are assigned to. Opens in Settings.", href: "/settings/teams", permission: "crm.settings.manage",
    state: async () => "Opens Settings", external: true },
];

// The groups, in the order a new company works through them; a row in no group shows under Advanced.
const GROUPS: Array<{ title: string; description: string; ids: string[] }> = [
  { title: "Get started", description: "Who uses CRM, your working week, and whether you work with leads at all.", ids: ["starter-packs", "team-access", "teams", "leads-switch", "defaults", "holidays", "history-import"] },
  { title: "Get leads in", description: "Where enquiries come from and how they reach you.", ids: ["lead-sources", "web-forms", "lead-connectors", "email-to-lead", "website-chat"] },
  { title: "Lead process", description: "How an enquiry is checked, scored and given to the right person.", ids: ["lead-stages", "qualification", "assignment", "lead-scoring"] },
  { title: "Deal process", description: "The stages a deal goes through and how it ends.", ids: ["deal-stages", "close-reasons", "activity-types", "recurring-plans"] },
  { title: "Talk to customers", description: "WhatsApp, calls, SMS, email and your calendar.", ids: ["whatsapp", "calls-sms", "email-templates", "calendar", "zoom", "reminders"] },
  { title: "Marketing and privacy", description: "Campaigns, tags, and the consent customers gave.", ids: ["campaigns", "tags", "privacy"] },
  { title: "Advanced", description: "Your own fields on records.", ids: ["custom-fields"] },
];

export function CrmSetupScreen() {
  const workspace = useWorkspaceContext();
  const owner = workspace.roleSlugs.includes("organization_owner");
  const rows = ROWS.filter((row) => owner || workspace.permissions.includes(row.permission));
  if (!rows.length) return <PermissionState title="You do not have access to CRM Setup" description="Ask a CRM administrator for access." />;
  return (
    <div className="flex flex-1 flex-col gap-4">
      <PageHeader title="Setup" description="Every CRM setting, grouped by what it is for. Each row shows what is set now." />
      {GROUPS.map((group, index) => {
        const placed = new Set(GROUPS.flatMap((entry) => entry.ids));
        const inGroup = rows.filter((row) => group.ids.includes(row.id) || (index === GROUPS.length - 1 && !placed.has(row.id)))
          .sort((a, b) => (group.ids.indexOf(a.id) + 1 || 99) - (group.ids.indexOf(b.id) + 1 || 99));
        if (!inGroup.length) return null;
        return (
          <section key={group.title} aria-labelledby={`setup-${index}`} className="flex flex-col gap-2">
            <div>
              <h2 id={`setup-${index}`} className="text-base font-semibold text-text">{group.title}</h2>
              <p className="text-sm text-text-secondary">{group.description}</p>
            </div>
            <ol className="flex flex-col divide-y divide-border rounded-[var(--radius-card)] border border-border bg-surface">
              {inGroup.map((row) => <SetupRow key={row.id} row={row} />)}
            </ol>
          </section>
        );
      })}
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
