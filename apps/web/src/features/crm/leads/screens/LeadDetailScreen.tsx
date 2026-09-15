"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Merge, Pencil, Repeat, UserPlus } from "lucide-react";
import {
  Button,
  ConflictBanner,
  ErrorState,
  PermissionState,
  RecordDetailsPage,
  Select,
  StatusBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  Timeline,
  type SelectOption,
  type TimelineEntry,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import {
  assignLead,
  convertLead,
  findLeadDuplicates,
  getCrmOptions,
  getLead,
  getLeadTimeline,
  LeadApiError,
  transitionLeadStage,
} from "../api/leads-api";

const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  new: "info",
  contacted: "info",
  qualified: "success",
  unqualified: "neutral",
  converted: "success",
  archived: "neutral",
};

const timelineTone: Record<string, TimelineEntry["tone"]> = {
  activity: "info",
  communication: "neutral",
  note: "neutral",
  attachment: "neutral",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManageLeads = workspace.permissions.includes(CRM_PERMISSIONS.leadsManage);

  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [pendingStageId, setPendingStageId] = useState<string>("");
  const [pendingOwnerId, setPendingOwnerId] = useState<string>("");

  const leadQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId),
    queryFn: () => getLead(leadId),
  });
  const lead = leadQuery.data?.record;

  const optionsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "options"),
    queryFn: getCrmOptions,
  });

  const timelineQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "timeline"),
    queryFn: () => getLeadTimeline(leadId),
    enabled: Boolean(lead),
  });

  const duplicatesQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "duplicates"),
    queryFn: () =>
      findLeadDuplicates(
        { firstName: lead!.firstName, lastName: lead!.lastName, email: lead!.email, mobile: lead!.mobile, phone: lead!.phone, companyName: lead!.companyName },
        leadId,
      ),
    enabled: Boolean(lead) && lead!.recordStatus !== "converted" && lead!.recordStatus !== "archived",
  });

  function invalidateLead() {
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads", leadId) });
    queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads") });
  }

  function handleActionError(error: unknown) {
    if (error instanceof LeadApiError && (error.code === "CRM_STALE_WRITE" || error.code === "CRM_LEAD_STAGE_CONFLICT")) {
      setConflictMessage(error.message);
      return;
    }
    setActionError(error instanceof Error ? error.message : "The action could not be completed.");
  }

  const assignMutation = useMutation({
    mutationFn: () => assignLead(leadId, { ownerUserId: pendingOwnerId || null, expectedUpdatedAt: lead!.updatedAt }),
    onSuccess: () => {
      setActionError(null);
      invalidateLead();
    },
    onError: handleActionError,
  });

  const stageMutation = useMutation({
    mutationFn: () => transitionLeadStage(leadId, { stageId: pendingStageId, expectedUpdatedAt: lead!.updatedAt }),
    onSuccess: () => {
      setActionError(null);
      invalidateLead();
    },
    onError: handleActionError,
  });

  const convertMutation = useMutation({
    mutationFn: () => convertLead(leadId),
    onSuccess: () => {
      setActionError(null);
      invalidateLead();
    },
    onError: handleActionError,
  });

  const ownerOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [
      { value: "", label: "Unassigned" },
      ...rows.map((row) => {
        const id = String(row.id);
        const label = String(row.fullName || row.name || row.email || row.id);
        return { value: id, label };
      }),
    ];
  }, [optionsQuery.data]);

  const stageOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.leadStages ?? []) as Array<{ id: string; code: string; name: string; status: string }>;
    return rows.filter((row) => row.status === "active").map((row) => ({ value: row.id, label: row.name }));
  }, [optionsQuery.data]);

  const timelineEntries: TimelineEntry[] = useMemo(() => {
    const rows = timelineQuery.data?.page.rows ?? [];
    return rows.map((row) => ({
      id: row.id,
      tone: timelineTone[row.kind] ?? "neutral",
      title: `${row.kind}${row.subtype ? ` · ${row.subtype}` : ""}${row.title ? `: ${row.title}` : ""}`,
      description: row.status ? `Status: ${row.status}` : undefined,
      timestamp: dateTimeFormatter.format(new Date(row.occurredAt)),
    }));
  }, [timelineQuery.data]);

  if (leadQuery.isLoading) return <p className="px-4 py-8 text-sm text-text-secondary">Loading lead…</p>;
  if (leadQuery.isError) {
    if (leadQuery.error instanceof LeadApiError && leadQuery.error.status === 403) {
      return <PermissionState title="You don't have access to this Lead" description="Ask an administrator to grant CRM lead access." />;
    }
    if (leadQuery.error instanceof LeadApiError && leadQuery.error.status === 404) {
      return <ErrorState title="Lead not found" description="This Lead may have been merged, converted, or removed." action={{ label: "Back to Leads", onPress: () => router.push("/crm/leads") }} />;
    }
    return <ErrorState title="Could not load this Lead" action={{ label: "Retry", onPress: () => leadQuery.refetch() }} />;
  }
  if (!lead) return null;

  const isClosed = lead.recordStatus === "converted" || lead.recordStatus === "archived";

  return (
    <RecordDetailsPage
      header={{
        title: lead.fullName || `${lead.firstName} ${lead.lastName || ""}`.trim(),
        status: <StatusBadge tone={statusTone[lead.status] ?? "neutral"}>{lead.status}</StatusBadge>,
        fields: [
          { label: "Owner", value: lead.ownerName || "Unassigned" },
          { label: "Priority", value: lead.priority },
          { label: "Score", value: lead.score ?? "—" },
          { label: "Qualification", value: lead.qualificationStatus || "Not reviewed" },
        ],
        primaryAction: canManageLeads && !isClosed ? (
          <Button variant="secondary" onPress={() => router.push(`/crm/leads/${leadId}/edit`)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        ) : undefined,
        secondaryActions:
          canManageLeads && !isClosed ? (
            <Button variant="primary" onPress={() => convertMutation.mutate()} isLoading={convertMutation.isPending}>
              <Repeat className="size-4" aria-hidden="true" />
              Convert
            </Button>
          ) : undefined,
      }}
      tabs={
        <Tabs>
          <TabList aria-label="Lead sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="activity">Activity</Tab>
          </TabList>
          <TabPanel id="overview">
            <div className="flex flex-col gap-6 py-4">
              {conflictMessage && <ConflictBanner message={conflictMessage} onReload={() => router.refresh()} />}
              {actionError && (
                <p role="alert" className="rounded-[var(--radius-control)] border border-danger-emphasis/30 bg-danger-soft px-3 py-2 text-sm text-danger">
                  {actionError}
                </p>
              )}
              {lead.recordStatus === "converted" && (
                <p className="rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-2 text-sm text-success">
                  This Lead has been converted. It is now read-only.
                </p>
              )}
              {lead.recordStatus === "archived" && (
                <p className="rounded-[var(--radius-control)] border border-border-strong bg-canvas-strong px-3 py-2 text-sm text-text-secondary">
                  This Lead is archived and read-only.
                </p>
              )}
              {duplicatesQuery.data && duplicatesQuery.data.duplicates.length > 0 && (
                <div className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-2">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                    <Merge className="size-4" aria-hidden="true" />
                    Possible duplicates found
                  </p>
                  <ul className="flex flex-col gap-1 text-sm text-text-secondary">
                    {duplicatesQuery.data.duplicates.map((match, i) =>
                      match.restricted ? (
                        <li key={i}>A possible match exists that you don&apos;t have visibility into.</li>
                      ) : (
                        <li key={match.id}>
                          {match.fullName} {match.companyName ? `· ${match.companyName}` : ""} — {match.classification} match
                        </li>
                      ),
                    )}
                  </ul>
                </div>
              )}

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Email" value={lead.email} />
                <Field label="Phone" value={lead.phone} />
                <Field label="Mobile" value={lead.mobile} />
                <Field label="Company" value={lead.companyName} />
                <Field label="Job title" value={lead.jobTitle} />
                <Field label="Industry" value={lead.industry} />
                <Field label="Estimated value" value={lead.estimatedValue !== null ? `${lead.currencyCode || ""} ${lead.estimatedValue}`.trim() : null} />
                <Field label="Product interest" value={lead.productInterest} />
                <Field label="City" value={lead.city} />
                <Field label="Country" value={lead.countryCode} />
              </div>

              {!isClosed && canManageLeads && (
                <div className="flex flex-col gap-4 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Assignment &amp; stage</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <Select label="Owner" size="compact" options={ownerOptions} selectedKey={pendingOwnerId || lead.ownerUserId || ""} onSelectionChange={(key) => setPendingOwnerId(String(key ?? ""))} className="min-w-[220px]" />
                    <Button variant="secondary" size="compact" onPress={() => assignMutation.mutate()} isLoading={assignMutation.isPending}>
                      <UserPlus className="size-4" aria-hidden="true" />
                      Assign
                    </Button>
                  </div>
                  <div className="flex flex-wrap items-end gap-3">
                    <Select label="Move to stage…" size="compact" options={stageOptions} selectedKey={pendingStageId} onSelectionChange={(key) => setPendingStageId(String(key ?? ""))} className="min-w-[220px]" placeholder="Choose a stage" />
                    <Button variant="secondary" size="compact" onPress={() => stageMutation.mutate()} isLoading={stageMutation.isPending} isDisabled={!pendingStageId}>
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Move
                    </Button>
                  </div>
                </div>
              )}
              {isClosed && (
                <p className="flex items-center gap-1.5 text-sm text-text-muted">
                  <Ban className="size-4" aria-hidden="true" />
                  Assignment and stage changes are unavailable for a {lead.recordStatus} Lead.
                </p>
              )}
            </div>
          </TabPanel>
          <TabPanel id="activity">
            <div className="py-4">
              {timelineQuery.isLoading ? (
                <p className="text-sm text-text-secondary">Loading activity…</p>
              ) : (
                <Timeline entries={timelineEntries} emptyMessage="No activity recorded for this Lead yet." />
              )}
            </div>
          </TabPanel>
        </Tabs>
      }
    >
      <div />
    </RecordDetailsPage>
  );
}

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}
