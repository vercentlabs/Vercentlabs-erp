"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Ban, CheckCircle2, Merge, Pencil, RefreshCw, Repeat, ShieldAlert, UserPlus } from "lucide-react";
import {
  Button,
  Checkbox,
  ConflictBanner,
  Dialog,
  ErrorState,
  PermissionState,
  RecordDetailsPage,
  RelatedBusinessFlow,
  Select,
  StatusBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
  TextArea,
  TextField,
  Timeline,
  type BusinessFlowNode,
  type SelectOption,
  type TimelineEntry,
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import {
  assignLead,
  convertLead,
  decideLeadQualification,
  dismissLeadDuplicate,
  findLeadDuplicates,
  getCrmOptions,
  getLead,
  getLeadConversionPreview,
  getLeadQualificationDetail,
  getLeadScoreDetail,
  getLeadStageDetail,
  getLeadStageReasons,
  getLeadTimeline,
  getLeadTransitionGraph,
  LeadApiError,
  mergeLead,
  recalculateLeadScore,
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

function Field({ label, value }: { label: string; value: string | number | null | undefined }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs text-text-muted">{label}</span>
      <span className="text-sm text-text">{value === null || value === undefined || value === "" ? "—" : value}</span>
    </div>
  );
}

export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManageLeads = workspace.permissions.includes(CRM_PERMISSIONS.leadsManage);

  const [conflictMessage, setConflictMessage] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [convertPreviewOpen, setConvertPreviewOpen] = useState(false);
  const [convertPartyId, setConvertPartyId] = useState<string>("");
  const [convertContactId, setConvertContactId] = useState<string>("");
  const [convertAutoSelected, setConvertAutoSelected] = useState(false);

  function handleConvertPreviewOpenChange(open: boolean) {
    setConvertPreviewOpen(open);
    if (!open) {
      setConvertPartyId("");
      setConvertContactId("");
      setConvertAutoSelected(false);
    }
  }
  const [pendingStageId, setPendingStageId] = useState<string>("");
  const [pendingReasonCode, setPendingReasonCode] = useState<string>("");
  const [pendingNote, setPendingNote] = useState<string>("");
  const [pendingOwnerId, setPendingOwnerId] = useState<string>("");
  const [assignReason, setAssignReason] = useState<string>("");
  const [qualDecision, setQualDecision] = useState<"qualified" | "unqualified" | "">("");
  const [qualReasonCode, setQualReasonCode] = useState<string>("");
  const [qualReasonText, setQualReasonText] = useState<string>("");
  const [qualNote, setQualNote] = useState<string>("");
  const [qualOverride, setQualOverride] = useState(false);
  const [qualOverrideReason, setQualOverrideReason] = useState<string>("");

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

  const stageDetailQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "stage-detail"),
    queryFn: () => getLeadStageDetail(leadId),
    enabled: Boolean(lead),
  });

  const transitionGraphQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", "transition-graph"),
    queryFn: getLeadTransitionGraph,
  });

  const reasonsQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "stage-reasons", pendingStageId),
    queryFn: () => getLeadStageReasons(leadId, pendingStageId),
    enabled: Boolean(pendingStageId),
  });

  const qualificationQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "qualification"),
    queryFn: () => getLeadQualificationDetail(leadId),
    enabled: Boolean(lead),
  });

  const scoreQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "score"),
    queryFn: () => getLeadScoreDetail(leadId),
    enabled: Boolean(lead),
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
    mutationFn: () => assignLead(leadId, { ownerUserId: pendingOwnerId || null, reason: assignReason || undefined, expectedUpdatedAt: lead!.updatedAt }),
    onSuccess: () => {
      setActionError(null);
      invalidateLead();
    },
    onError: handleActionError,
  });

  const stageMutation = useMutation({
    mutationFn: () =>
      transitionLeadStage(leadId, {
        stageId: pendingStageId,
        reasonCode: pendingReasonCode || undefined,
        note: pendingNote || undefined,
        expectedUpdatedAt: lead!.updatedAt,
      }),
    onSuccess: () => {
      setActionError(null);
      setPendingStageId("");
      setPendingReasonCode("");
      setPendingNote("");
      invalidateLead();
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "stage-detail") });
    },
    onError: handleActionError,
  });

  const convertPreviewQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "convert-preview"),
    queryFn: () => getLeadConversionPreview(leadId),
    enabled: convertPreviewOpen,
  });

  const convertMutation = useMutation({
    mutationFn: () =>
      convertLead(leadId, {
        ...(convertPartyId ? { partyId: convertPartyId } : {}),
        ...(convertContactId ? { contactId: convertContactId } : {}),
      }),
    onSuccess: () => {
      setActionError(null);
      setConvertPreviewOpen(false);
      setConvertPartyId("");
      setConvertContactId("");
      setConvertAutoSelected(false);
      invalidateLead();
    },
    onError: handleActionError,
  });

  const qualifyMutation = useMutation({
    mutationFn: () =>
      decideLeadQualification(leadId, {
        decision: qualDecision as "qualified" | "unqualified",
        reasonCode: qualReasonCode || undefined,
        reasonText: qualReasonText || undefined,
        note: qualNote || undefined,
        overrideUsed: qualOverride || undefined,
        overrideReason: qualOverride ? qualOverrideReason : undefined,
      }),
    onSuccess: () => {
      setActionError(null);
      setQualDecision("");
      setQualReasonCode("");
      setQualReasonText("");
      setQualNote("");
      setQualOverride(false);
      setQualOverrideReason("");
      invalidateLead();
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "qualification") });
    },
    onError: handleActionError,
  });

  const recalculateMutation = useMutation({
    mutationFn: () => recalculateLeadScore(leadId, "Manual recalculation from Lead 360"),
    onSuccess: () => {
      setActionError(null);
      invalidateLead();
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "score") });
    },
    onError: handleActionError,
  });

  const dismissMutation = useMutation({
    mutationFn: (matchedLeadId: string) => dismissLeadDuplicate(leadId, matchedLeadId, "Reviewed and confirmed not the same Lead."),
    onSuccess: () => {
      setActionError(null);
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "duplicates") });
    },
    onError: handleActionError,
  });

  const mergeMutation = useMutation({
    mutationFn: (sourceId: string) => mergeLead(leadId, sourceId),
    onSuccess: () => {
      setActionError(null);
      invalidateLead();
      queryClient.invalidateQueries({ queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "duplicates") });
    },
    onError: handleActionError,
  });

  const ownerOptions: SelectOption[] = useMemo(() => {
    const rows = optionsQuery.data?.options?.users ?? [];
    return [
      { value: "", label: "Unassigned" },
      ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.email || row.id) })),
    ];
  }, [optionsQuery.data]);

  // F007: only legal next stages from the Lead's current stage — never
  // every active pipeline stage — per the governed transition graph.
  const legalStageOptions: SelectOption[] = useMemo(() => {
    if (!lead) return [];
    const edges = transitionGraphQuery.data?.transitions ?? [];
    return edges
      .filter((edge) => edge.fromStageCode === lead.status)
      .map((edge) => ({ value: edge.toStageId, label: edge.toStageName }));
  }, [transitionGraphQuery.data, lead]);

  const reasonRequired = useMemo(() => {
    if (!pendingStageId) return false;
    const edges = transitionGraphQuery.data?.transitions ?? [];
    return Boolean(edges.find((edge) => edge.toStageId === pendingStageId && edge.fromStageCode === lead?.status)?.reasonRequired);
  }, [transitionGraphQuery.data, pendingStageId, lead]);

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
  const qualification = qualificationQuery.data?.qualification;
  const explanation = scoreQuery.data?.explanation;
  const contributions = recalculateMutation.data?.contributions;

  const conversionFlow: BusinessFlowNode[] | null =
    lead.recordStatus === "converted"
      ? [
          { id: "lead", label: "Lead", state: "completed", meta: lead.code },
          { id: "account", label: "Account", state: lead.convertedPartyId ? "completed" : "future", href: lead.convertedPartyId ? `/crm/accounts/${lead.convertedPartyId}` : undefined },
          { id: "contact", label: "Contact", state: lead.convertedContactId ? "completed" : "future", href: lead.convertedContactId ? `/crm/contacts/${lead.convertedContactId}` : undefined },
          { id: "opportunity", label: "Opportunity", state: lead.convertedOpportunityId ? "completed" : "future", href: lead.convertedOpportunityId ? `/crm/opportunities/${lead.convertedOpportunityId}` : undefined },
        ]
      : null;

  const accountCandidates = convertPreviewQuery.data?.accountCandidates ?? [];
  const contactCandidates = convertPreviewQuery.data?.contactCandidates ?? [];

  // Pre-select an exact match once, matching convertCrmLead's own default
  // (auto-reuse only an "exact" match) — adjusting state during render
  // (guarded to run once per preview open) rather than an effect, same
  // pattern as SavedViewsBar's default-view selection.
  if (!convertAutoSelected && convertPreviewOpen && convertPreviewQuery.isSuccess) {
    setConvertAutoSelected(true);
    const exactAccount = accountCandidates.find((row) => row.classification === "exact");
    const exactContact = contactCandidates.find((row) => row.classification === "exact");
    if (exactAccount) setConvertPartyId(exactAccount.id);
    if (exactContact) setConvertContactId(exactContact.id);
  }

  const accountChoiceOptions: SelectOption[] = [
    { value: "", label: "Create a new Account" },
    ...accountCandidates.map((row) => ({
      value: row.id,
      label: `${row.display_name || row.legal_name || row.id} (${row.classification === "exact" ? "exact match" : "possible match"})`,
    })),
  ];
  const contactChoiceOptions: SelectOption[] = [
    { value: "", label: "Create a new Contact" },
    ...contactCandidates.map((row) => ({
      value: row.id,
      label: `${row.first_name || ""} ${row.last_name || ""}`.trim() + (row.email ? ` · ${row.email}` : "") + (row.classification === "exact" ? " (exact match)" : " (possible match)"),
    })),
  ];

  return (
    <>
    <RecordDetailsPage
      header={{
        title: lead.fullName || `${lead.firstName} ${lead.lastName || ""}`.trim(),
        status: <StatusBadge tone={statusTone[lead.status] ?? "neutral"}>{lead.status}</StatusBadge>,
        fields: [
          { label: "Owner", value: lead.ownerName || "Unassigned" },
          { label: "Priority", value: lead.priority },
          { label: "Score", value: lead.score ?? "—" },
          { label: "Qualification", value: lead.qualificationState || "not_reviewed" },
        ],
        primaryAction: canManageLeads && !isClosed ? (
          <Button variant="secondary" onPress={() => router.push(`/crm/leads/${leadId}/edit`)}>
            <Pencil className="size-4" aria-hidden="true" />
            Edit
          </Button>
        ) : undefined,
        secondaryActions:
          canManageLeads && !isClosed ? (
            <Button variant="primary" onPress={() => setConvertPreviewOpen(true)}>
              <Repeat className="size-4" aria-hidden="true" />
              Convert
            </Button>
          ) : undefined,
      }}
      tabs={
        <Tabs>
          <TabList aria-label="Lead sections">
            <Tab id="overview">Overview</Tab>
            <Tab id="qualification">Qualification</Tab>
            <Tab id="pipeline">Pipeline</Tab>
            <Tab id="intelligence">Intelligence</Tab>
            <Tab id="activity">Activity</Tab>
            <Tab id="notes">Notes</Tab>
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
                <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-success-emphasis/30 bg-success-soft px-3 py-3">
                  <p className="text-sm text-success">This Lead has been converted. It is now read-only.</p>
                  {conversionFlow && <RelatedBusinessFlow title="Sales flow" nodes={conversionFlow} />}
                </div>
              )}
              {lead.recordStatus === "archived" && (
                <p className="rounded-[var(--radius-control)] border border-border-strong bg-canvas-strong px-3 py-2 text-sm text-text-secondary">
                  This Lead is archived and read-only.
                </p>
              )}

              {duplicatesQuery.data && duplicatesQuery.data.duplicates.length > 0 && (
                <div className="flex flex-col gap-3 rounded-[var(--radius-control)] border border-warning-emphasis/30 bg-warning-soft px-3 py-3">
                  <p className="flex items-center gap-1.5 text-sm font-medium text-warning">
                    <Merge className="size-4" aria-hidden="true" />
                    Possible duplicates found
                  </p>
                  <ul className="flex flex-col gap-2">
                    {duplicatesQuery.data.duplicates.map((match, i) =>
                      match.restricted ? (
                        <li key={i} className="text-sm text-text-secondary">A possible match exists that you don&apos;t have visibility into.</li>
                      ) : (
                        <li key={match.id} className="flex flex-wrap items-center justify-between gap-2 text-sm text-text-secondary">
                          <span>
                            {match.fullName} {match.companyName ? `· ${match.companyName}` : ""} — {match.classification} match
                          </span>
                          {canManageLeads && (
                            <span className="flex items-center gap-2">
                              <Button variant="ghost" size="compact" onPress={() => dismissMutation.mutate(match.id)} isLoading={dismissMutation.isPending} isDisabled={match.classification === "exact"}>
                                Dismiss
                              </Button>
                              <Button variant="secondary" size="compact" onPress={() => mergeMutation.mutate(match.id)} isLoading={mergeMutation.isPending}>
                                Merge into this Lead
                              </Button>
                            </span>
                          )}
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
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Assignment</p>
                  <p className="text-xs text-text-muted">
                    Only Leads assignable to you and your reporting scope are shown here (F005 eligibility). Assigning outside the eligible list requires an override elsewhere in Setup and is not available from this panel.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <Select label="Owner" size="compact" options={ownerOptions} selectedKey={pendingOwnerId || lead.ownerUserId || ""} onSelectionChange={(key) => setPendingOwnerId(String(key ?? ""))} className="min-w-[220px]" />
                    <TextField label="Reason (optional)" size="compact" value={assignReason} onChange={setAssignReason} className="min-w-[220px]" />
                    <Button variant="secondary" size="compact" onPress={() => assignMutation.mutate()} isLoading={assignMutation.isPending}>
                      <UserPlus className="size-4" aria-hidden="true" />
                      Assign
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

          <TabPanel id="qualification">
            <div className="flex flex-col gap-6 py-4">
              {qualificationQuery.isLoading ? (
                <p className="text-sm text-text-secondary">Loading qualification…</p>
              ) : qualification ? (
                <>
                  <div className="flex flex-wrap items-center gap-3">
                    <StatusBadge tone={qualification.state === "qualified" ? "success" : qualification.state === "unqualified" ? "danger" : "neutral"}>{qualification.state}</StatusBadge>
                    {qualification.decidedAt && (
                      <span className="text-xs text-text-muted">
                        Decided by {qualification.decidedByName || "—"} on {dateTimeFormatter.format(new Date(qualification.decidedAt))}
                      </span>
                    )}
                  </div>
                  {qualification.reasonCode && <Field label="Reason" value={`${qualification.reasonCode}${qualification.reasonText ? `: ${qualification.reasonText}` : ""}`} />}
                  {qualification.note && <Field label="Note" value={qualification.note} />}

                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-semibold text-text">Readiness criteria</p>
                    <p className="text-xs text-text-muted">Evaluated live from current Lead data as of {dateTimeFormatter.format(new Date(qualification.evaluatedAt))}.</p>
                    <ul className="flex flex-col gap-1">
                      {qualification.readiness.required.map((criterion) => (
                        <li key={criterion.key} className={`text-sm ${criterion.met ? "text-success" : "text-danger"}`}>
                          {criterion.met ? "✓" : "✗"} {criterion.label} <span className="text-text-muted">(required)</span>
                        </li>
                      ))}
                      {qualification.readiness.recommended.map((criterion) => (
                        <li key={criterion.key} className={`text-sm ${criterion.met ? "text-success" : "text-text-muted"}`}>
                          {criterion.met ? "✓" : "○"} {criterion.label} <span className="text-text-muted">(recommended)</span>
                        </li>
                      ))}
                    </ul>
                    {!qualification.readiness.ready && (
                      <p className="flex items-center gap-1.5 text-xs text-warning">
                        <ShieldAlert className="size-3.5" aria-hidden="true" />
                        Required evidence is missing — qualifying now requires an authorized override with a reason.
                      </p>
                    )}
                  </div>

                  {!isClosed && canManageLeads && (
                    <div className="flex flex-col gap-3 border-t border-border pt-4">
                      <p className="text-sm font-semibold text-text">Decide</p>
                      <Select
                        label="Decision"
                        size="compact"
                        options={[{ value: "qualified", label: "Qualified" }, { value: "unqualified", label: "Unqualified" }]}
                        selectedKey={qualDecision}
                        onSelectionChange={(key) => setQualDecision(String(key) as "qualified" | "unqualified")}
                        className="max-w-[220px]"
                        placeholder="Choose…"
                      />
                      {qualDecision === "unqualified" && (
                        <>
                          <Select
                            label="Reason"
                            size="compact"
                            options={qualification.reasons.map((reason) => ({ value: reason.code, label: reason.label }))}
                            selectedKey={qualReasonCode}
                            onSelectionChange={(key) => setQualReasonCode(String(key ?? ""))}
                            className="max-w-[280px]"
                            placeholder="Choose a reason…"
                          />
                          {qualReasonCode === "other" && <TextArea label="Explain" value={qualReasonText} onChange={setQualReasonText} />}
                        </>
                      )}
                      <TextArea label="Note (optional)" value={qualNote} onChange={setQualNote} />
                      {qualDecision === "qualified" && !qualification.readiness.ready && qualification.canOverride && (
                        <div className="flex flex-col gap-2">
                          <Checkbox isSelected={qualOverride} onChange={setQualOverride}>
                            Override — qualify despite missing required evidence
                          </Checkbox>
                          {qualOverride && <TextArea label="Override reason" value={qualOverrideReason} onChange={setQualOverrideReason} />}
                        </div>
                      )}
                      <Button
                        variant="primary"
                        size="compact"
                        className="w-fit"
                        onPress={() => qualifyMutation.mutate()}
                        isLoading={qualifyMutation.isPending}
                        isDisabled={!qualDecision || (qualDecision === "unqualified" && !qualReasonCode)}
                      >
                        Save decision
                      </Button>
                    </div>
                  )}

                  {qualification.history.length > 0 && (
                    <div className="flex flex-col gap-2 border-t border-border pt-4">
                      <p className="text-sm font-semibold text-text">History</p>
                      <Timeline
                        entries={qualification.history.map((event) => ({
                          id: event.id,
                          tone: event.newState === "qualified" ? "success" : event.newState === "unqualified" ? "danger" : "neutral",
                          title: `${event.decidedByName || "Someone"} set qualification to ${event.newState}${event.overrideUsed ? " (override)" : ""}`,
                          description: event.reasonText || event.reasonCode || event.note || undefined,
                          timestamp: dateTimeFormatter.format(new Date(event.createdAt)),
                        }))}
                      />
                    </div>
                  )}
                </>
              ) : (
                <p className="text-sm text-text-secondary">Qualification data is unavailable.</p>
              )}
            </div>
          </TabPanel>

          <TabPanel id="pipeline">
            <div className="flex flex-col gap-6 py-4">
              {stageDetailQuery.data && (
                <div className="flex flex-wrap items-center gap-3">
                  <StatusBadge tone={stageDetailQuery.data.dwell.status === "breached" ? "danger" : stageDetailQuery.data.dwell.status === "warning" ? "warning" : "neutral"}>
                    {`Dwell: ${Math.round(stageDetailQuery.data.dwell.elapsedHours)}h in stage`}
                  </StatusBadge>
                  <span className="text-xs text-text-muted">Entered {dateTimeFormatter.format(new Date(stageDetailQuery.data.dwell.enteredAt))}</span>
                </div>
              )}

              {!isClosed && canManageLeads && (
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Move to stage…</p>
                  <div className="flex flex-wrap items-end gap-3">
                    <Select
                      label="Destination stage"
                      size="compact"
                      options={legalStageOptions}
                      selectedKey={pendingStageId}
                      onSelectionChange={(key) => setPendingStageId(String(key ?? ""))}
                      className="min-w-[220px]"
                      placeholder={legalStageOptions.length ? "Choose a stage" : "No legal transitions configured"}
                    />
                    <Button variant="secondary" size="compact" onPress={() => stageMutation.mutate()} isLoading={stageMutation.isPending} isDisabled={!pendingStageId || (reasonRequired && !pendingReasonCode)}>
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Move
                    </Button>
                  </div>
                  {pendingStageId && reasonRequired && (
                    <Select
                      label="Reason (required for this transition)"
                      size="compact"
                      options={(reasonsQuery.data?.reasons ?? []).map((reason) => ({ value: reason.code, label: reason.label }))}
                      selectedKey={pendingReasonCode}
                      onSelectionChange={(key) => setPendingReasonCode(String(key ?? ""))}
                      className="max-w-[280px]"
                      placeholder="Choose a reason…"
                    />
                  )}
                  {pendingStageId && <TextArea label="Note (optional)" value={pendingNote} onChange={setPendingNote} />}
                </div>
              )}

              {stageDetailQuery.data && stageDetailQuery.data.history.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Stage history</p>
                  <Timeline
                    entries={stageDetailQuery.data.history.map((event) => ({
                      id: event.id,
                      title: `${event.actorName || "Someone"} moved ${event.fromStageName} → ${event.toStageName}`,
                      description: event.reasonLabel || event.note || undefined,
                      timestamp: dateTimeFormatter.format(new Date(event.createdAt)),
                    }))}
                  />
                </div>
              )}
            </div>
          </TabPanel>

          <TabPanel id="intelligence">
            <div className="flex flex-col gap-6 py-4">
              <p className="text-xs text-text-muted">Score is intelligence, not authority — it never changes stage, qualification, or record status on its own.</p>
              <div className="flex flex-wrap items-center gap-4">
                <Field label="Score" value={explanation?.score ?? lead.score ?? "—"} />
                <Field label="Grade" value={explanation?.lead_grade ?? lead.grade ?? "—"} />
                <Field label="Last calculated" value={explanation?.score_calculated_at ? dateTimeFormatter.format(new Date(explanation.score_calculated_at)) : "Never"} />
              </div>
              {canManageLeads && (
                <Button variant="secondary" size="compact" className="w-fit" onPress={() => recalculateMutation.mutate()} isLoading={recalculateMutation.isPending}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Recalculate now
                </Button>
              )}
              {contributions && contributions.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Breakdown (latest recalculation)</p>
                  <ul className="flex flex-col gap-1">
                    {contributions.map((contribution, i) => (
                      <li key={i} className="flex justify-between text-sm text-text-secondary">
                        <span>{contribution.name}</span>
                        <span className="tabular-nums">{contribution.points > 0 ? `+${contribution.points}` : contribution.points}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {explanation?.score_explanation?.model && (
                <p className="text-xs text-text-muted">Model: {explanation.score_explanation.model.name} (v{explanation.score_explanation.model.version})</p>
              )}
              {!explanation?.score_calculated_at && !contributions && (
                <p className="text-sm text-text-secondary">No scoring model has evaluated this Lead yet.</p>
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

          <TabPanel id="notes">
            <div className="py-4">
              <NotesPanel entityType="lead" entityId={leadId} />
            </div>
          </TabPanel>
        </Tabs>
      }
    >
      <div />
    </RecordDetailsPage>
    <Dialog isOpen={convertPreviewOpen} onOpenChange={handleConvertPreviewOpenChange} title="Convert this Lead">
      <div className="flex flex-col gap-4">
        {convertPreviewQuery.isLoading ? (
          <p className="text-sm text-text-secondary">Checking for existing Accounts and Contacts…</p>
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              Review any existing Account/Contact this Lead might match before converting. An exact match is pre-selected; choose &ldquo;Create a new&hellip;&rdquo; to make a new record instead.
            </p>
            <Select label="Account" options={accountChoiceOptions} selectedKey={convertPartyId} onSelectionChange={(key) => setConvertPartyId(String(key ?? ""))} />
            <Select label="Contact" options={contactChoiceOptions} selectedKey={convertContactId} onSelectionChange={(key) => setConvertContactId(String(key ?? ""))} />
          </>
        )}
        {actionError && (
          <p role="alert" className="text-sm text-danger">{actionError}</p>
        )}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => handleConvertPreviewOpenChange(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => convertMutation.mutate()} isLoading={convertMutation.isPending} isDisabled={convertPreviewQuery.isLoading}>
            Convert
          </Button>
        </div>
      </div>
    </Dialog>
    </>
  );
}
