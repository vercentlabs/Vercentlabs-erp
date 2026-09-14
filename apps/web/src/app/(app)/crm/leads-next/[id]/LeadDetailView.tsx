"use client";

import Link from "next/link";
import {
  ActivityTimeline,
  Avatar,
  AuditTimeline,
  buttonVariants,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRoot,
  DropdownMenuTrigger,
  MetricCard,
  PageShell,
  RecordHeader,
  StatusBadge,
  TabsList,
  TabsPanel,
  TabsRoot,
  TabsTab,
  type ActivityTimelineItem,
  type AuditTimelineEntry,
} from "@vercentlabs/ui-web";
interface Lead {
  id: string;
  fullName: string;
  companyName: string | null;
  status: string;
  score: number | null;
  estimatedValue: number | null;
  currencyCode: string | null;
  email: string | null;
  mobile: string | null;
  phone: string | null;
  jobTitle: string | null;
  industry: string | null;
  website: string | null;
  city: string | null;
  state: string | null;
  countryCode: string | null;
  priority: string | null;
  rating: string | null;
  ownerName: string | null;
  doNotContact: boolean;
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusTone(status: string): "neutral" | "success" | "warning" | "danger" {
  const value = status.toLowerCase();
  if (value === "archived" || value === "lost" || value === "unqualified") return "danger";
  if (value === "converted" || value === "qualified" || value === "won") return "success";
  if (value === "working" || value === "contacted") return "warning";
  return "neutral";
}

export function LeadDetailView({
  lead,
  activities,
  communications,
  notes,
  opportunities,
  duplicates,
  selectedTags,
  assignmentHistory,
  lifecycleHistory,
  qualification,
  stages,
  canManage,
}: {
  lead: Lead;
  activities: Array<Record<string, unknown>>;
  communications: Array<Record<string, unknown>>;
  notes: Array<Record<string, unknown>>;
  opportunities: Array<Record<string, unknown>>;
  duplicates: Array<Record<string, unknown>>;
  selectedTags: Array<{ id: string; name: string; color: string | null }>;
  assignmentHistory: Array<Record<string, unknown>>;
  lifecycleHistory: Array<Record<string, unknown>>;
  qualification: Record<string, unknown> | null;
  stages: Array<{ id: string; code: string; name: string }>;
  canManage: boolean;
}) {
  const stageName = stages.find((stage) => stage.code === lead.status)?.name || lead.status.replaceAll("_", " ");

  const activityItems: ActivityTimelineItem[] = [
    ...activities.map((activity) => ({
      id: `activity-${activity.id}`,
      title: String(activity.subject || activity.type || "Activity"),
      description: activity.description ? String(activity.description) : undefined,
      timestamp: formatDateTime(String(activity.completed_at || activity.due_at || activity.created_at || "")),
      actor: activity.assigned_name ? `Assigned to ${activity.assigned_name}` : undefined,
    })),
    ...communications.map((comm) => ({
      id: `comm-${comm.id}`,
      title: String(comm.subject || comm.channel || "Communication"),
      description: comm.summary ? String(comm.summary) : undefined,
      timestamp: formatDateTime(String(comm.occurred_at || "")),
    })),
    ...notes.map((note) => ({
      id: `note-${note.id}`,
      title: `Note by ${note.author_name || "team member"}`,
      description: note.body ? String(note.body) : undefined,
      timestamp: formatDateTime(String(note.created_at || "")),
    })),
  ].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  const auditEntries: AuditTimelineEntry[] = [
    ...lifecycleHistory.map((entry, index) => ({
      id: `lifecycle-${index}`,
      field: "Stage",
      from: String(entry.from_stage_name || entry.from_stage_id || "—"),
      to: String(entry.to_stage_name || entry.to_stage_id || "—"),
      changedBy: entry.note ? String(entry.note) : "Stage transition",
      timestamp: formatDateTime(String(entry.created_at || "")),
    })),
    ...assignmentHistory.map((entry, index) => ({
      id: `assignment-${index}`,
      field: "Owner",
      from: String(entry.previous_owner_name || "Unassigned"),
      to: String(entry.new_owner_name || "Unassigned"),
      changedBy: `${entry.actor_name || "System"}${entry.reason ? ` -- ${entry.reason}` : ""}`,
      timestamp: formatDateTime(String(entry.created_at || "")),
    })),
  ].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

  return (
    <PageShell>
      <RecordHeader
        avatar={<Avatar name={lead.fullName} size="standard" />}
        title={lead.fullName}
        subtitle={lead.companyName || lead.jobTitle || undefined}
        status={<StatusBadge tone={statusTone(lead.status)}>{stageName}</StatusBadge>}
        indicators={
          <>
            {lead.doNotContact ? <StatusBadge tone="danger">Do not contact</StatusBadge> : null}
            {duplicates.length > 0 ? <StatusBadge tone="warning">{duplicates.length} possible duplicate{duplicates.length === 1 ? "" : "s"}</StatusBadge> : null}
          </>
        }
        metrics={
          <>
            <MetricCard label="Score" value={lead.score ?? "—"} />
            <MetricCard
              label="Estimated value"
              value={
                lead.estimatedValue != null
                  ? new Intl.NumberFormat("en-IN", { style: "currency", currency: lead.currencyCode || "INR", maximumFractionDigits: 0 }).format(lead.estimatedValue)
                  : "—"
              }
            />
            <MetricCard label="Owner" value={lead.ownerName || "Unassigned"} />
          </>
        }
        primaryAction={
          <Link href={`/crm/leads/${lead.id}`} className={buttonVariants({ variant: "primary" })}>
            Open full workspace
          </Link>
        }
        secondaryActions={
          canManage ? (
            <DropdownMenuRoot>
              <DropdownMenuTrigger className={buttonVariants({ variant: "secondary" })}>Actions</DropdownMenuTrigger>
              <DropdownMenuContent>
                <DropdownMenuItem render={<Link href={`/crm/leads?edit=${lead.id}`} />}>Edit lead</DropdownMenuItem>
                <DropdownMenuItem render={<Link href={`/crm/leads/${lead.id}`} />}>Assign / change stage / convert...</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenuRoot>
          ) : null
        }
      />

      <TabsRoot defaultValue="overview">
        <TabsList>
          <TabsTab value="overview">Overview</TabsTab>
          <TabsTab value="activity">Activity</TabsTab>
          <TabsTab value="sales">Sales context</TabsTab>
          <TabsTab value="governance">Governance</TabsTab>
        </TabsList>

        <TabsPanel value="overview">
          <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
            {[
              ["Email", lead.email],
              ["Mobile", lead.mobile],
              ["Phone", lead.phone],
              ["Job title", lead.jobTitle],
              ["Industry", lead.industry],
              ["Website", lead.website],
              ["Location", [lead.city, lead.state, lead.countryCode].filter(Boolean).join(", ") || null],
              ["Priority", lead.priority],
              ["Rating", lead.rating],
              ["Qualification", qualification?.status ? String(qualification.status) : null],
            ].map(([label, value]) => (
              <div key={label as string}>
                <dt className="text-[length:var(--text-xs)] font-medium uppercase tracking-wide text-[var(--color-text-muted)]">{label}</dt>
                <dd className="mt-0.5 text-[length:var(--text-sm)] text-[var(--color-text-primary)]">{value || "—"}</dd>
              </div>
            ))}
          </dl>
          {selectedTags.length > 0 ? (
            <div className="mt-4 flex flex-wrap gap-2">
              {selectedTags.map((tag) => (
                <StatusBadge key={tag.id} tone="neutral">
                  {tag.name}
                </StatusBadge>
              ))}
            </div>
          ) : null}
        </TabsPanel>

        <TabsPanel value="activity">
          <ActivityTimeline items={activityItems} />
        </TabsPanel>

        <TabsPanel value="sales">
          {opportunities.length === 0 ? (
            <p className="text-[length:var(--text-sm)] text-[var(--color-text-muted)]">No linked opportunities yet.</p>
          ) : (
            <ul className="flex flex-col gap-2">
              {opportunities.map((opportunity) => (
                <li key={String(opportunity.id)} className="rounded-[var(--radius-card)] border border-[var(--color-border-default)] px-3 py-2 text-[length:var(--text-sm)]">
                  {String(opportunity.name || opportunity.id)} -- {String(opportunity.stage_id || "")}
                </li>
              ))}
            </ul>
          )}
        </TabsPanel>

        <TabsPanel value="governance">
          <AuditTimeline entries={auditEntries} />
        </TabsPanel>
      </TabsRoot>
    </PageShell>
  );
}
