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
} from "@vercentlabs/design-system";
import { CRM_PERMISSIONS } from "@vercentlabs/permissions";

import { useWorkspaceContext } from "@/shell/workspace-context/WorkspaceContext";
import { scopedQueryKey } from "@/shell/workspace-context/queryKeys";
import { EmailHistoryPanel } from "@/features/crm/shared/EmailHistoryPanel";
import { RecordTimelinePanel } from "@/features/crm/shared/RecordTimelinePanel";
import { NotesPanel } from "@/features/crm/shared/NotesPanel";
import { CrmAttachmentPanel } from "@/features/crm/shared/CrmAttachmentPanel";
import { CustomFieldsRuntimePanel } from "@/features/crm/shared/CustomFieldsRuntimePanel";
import { LeadTagsPanel } from "@/features/crm/shared/LeadTagsPanel";
import { money } from "@/features/crm/shared/format";
import { countryName, dueLabel, dueState, formatDate, humanize, scoreLabel } from "@/features/crm/shared/human";
import { PropertyList } from "@/features/crm/shared/ui/PropertyList";
import {
  assignLead,
  convertLead,
  decideLeadQualification,
  dismissLeadDuplicate,
  findLeadDuplicates,
  getCrmOptions,
  getLead,
  getLeadAttribution,
  getLeadConversionPreview,
  getLeadQualificationDetail,
  getLeadScoreDetail,
  type LeadScoreContribution,
  getLeadStageDetail,
  getLeadStageReasons,
  getLeadTransitionGraph,
  LeadApiError,
  mergeLead,
  recalculateLeadScore,
  transitionLeadStage,
} from "../api/leads-api";
import { LoadingState } from "@/features/crm/shared/ui/LoadingState";
import { createPrivacyRequest, listConsentEvents, PrivacyApiError } from "@/features/crm/settings/privacy-requests/api/privacy-requests-api";

// F007: the five Lead pipeline stage codes (stable codes; human-facing
// labels come from the live stage catalogue via stageNameByCode below).
const statusTone: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  new: "info",
  attempting: "info",
  contacted: "info",
  working: "warning",
  nurturing: "neutral",
};

const dateTimeFormatter = new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" });

// The explanation stores contributions as a JSON string (see scoring-engine.js).
function parseContributions(value: unknown): LeadScoreContribution[] {
  if (Array.isArray(value)) return value as LeadScoreContribution[];
  if (typeof value !== "string") return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

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
  const [stageOverrideMode, setStageOverrideMode] = useState(false);
  const [stageOverrideReason, setStageOverrideReason] = useState<string>("");
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

  const attributionQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "attribution"),
    queryFn: () => getLeadAttribution(leadId),
    enabled: Boolean(lead),
  });

  const consentQuery = useQuery({
    queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "consent-events"),
    queryFn: () => listConsentEvents(leadId),
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
    mutationFn: () => assignLead(leadId, { ownerUserId: pendingOwnerId && pendingOwnerId !== "unassigned" ? pendingOwnerId : null, reason: assignReason || undefined, expectedUpdatedAt: lead!.updatedAt }),
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
        // F007 gap-closure — sending overrideUsed unconditionally while
        // override mode is on is safe: the server only actually records an
        // override when the transition genuinely has no graph edge or an
        // unmet reason gate; a legal move is unaffected either way.
        ...(stageOverrideMode ? { overrideUsed: true, overrideReason: stageOverrideReason } : {}),
      }),
    onSuccess: () => {
      setActionError(null);
      setPendingStageId("");
      setPendingReasonCode("");
      setPendingNote("");
      setStageOverrideMode(false);
      setStageOverrideReason("");
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

  const [privacyRequestOpen, setPrivacyRequestOpen] = useState(false);
  const [privacyRequestType, setPrivacyRequestType] = useState("export");
  const privacyRequestMutation = useMutation({
    mutationFn: () =>
      createPrivacyRequest({
        requestType: privacyRequestType,
        subjectType: "lead",
        subjectId: leadId,
        dueAt: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
      }),
    onSuccess: () => {
      setActionError(null);
      setPrivacyRequestOpen(false);
    },
    onError: (error: unknown) => setActionError(error instanceof PrivacyApiError ? error.message : "This privacy request could not be created."),
  });

  const ownerOptions: SelectOption[] = useMemo(() => {
    // "unassigned" is a real option (an empty key reads as "nothing chosen"),
    // and the current owner is always listed even if outside the eligible list.
    const rows = optionsQuery.data?.options?.users ?? [];
    const options = [
      { value: "unassigned", label: "Unassigned" },
      ...rows.map((row) => ({ value: String(row.id), label: String(row.fullName || row.name || row.email || row.id) })),
    ];
    const currentOwnerId = lead?.ownerUserId ?? null;
    const currentOwnerName = lead?.ownerName ?? null;
    if (currentOwnerId && !options.some((option) => option.value === currentOwnerId))
      options.push({ value: currentOwnerId, label: `${currentOwnerName ?? "Current owner"} (current)` });
    return options;
  }, [optionsQuery.data, lead?.ownerUserId, lead?.ownerName]);

  // F007: the primary status badge must show the configured human-facing
  // stage label ("Attempting Contact"), never the raw stable code.
  const stageNameByCode = useMemo(() => {
    const rows = (optionsQuery.data?.options?.leadStages ?? []) as Array<{ code: string; name: string }>;
    return Object.fromEntries(rows.map((row) => [row.code, row.name]));
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

  // F007 gap-closure — every active stage, used only while override mode is
  // on so an elevated user can reach a destination the normal transition
  // graph doesn't allow. Never the default option set.
  const allActiveStageOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.leadStages ?? []) as Array<{ id: string; code: string; name: string; status: string }>;
    return rows.filter((row) => row.status === "active" && row.code !== lead?.status).map((row) => ({ value: row.id, label: row.name }));
  }, [optionsQuery.data, lead]);
  const destinationStageOptions = stageOverrideMode ? allActiveStageOptions : legalStageOptions;

  if (leadQuery.isLoading) return <LoadingState label="Loading lead" rows={3} />;
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
  // F027 — the stored explanation already carries the rule-by-rule
  // breakdown; show it without requiring a recalculation first.
  const scoreRules: LeadScoreContribution[] = contributions ?? parseContributions(explanation?.score_explanation?.contributions);
  const propensityFactors = parseContributions(explanation?.propensity_explanation?.contributions);
  // Factor names are "feature: value"; show the value in words (a source id becomes its name).
  const describeFactor = (name: string) => {
    const [feature, ...rest] = name.split(":");
    const raw = rest.join(":").trim();
    const sources = (optionsQuery.data?.options?.allSources ?? optionsQuery.data?.options?.sources ?? []) as Array<{ id: string; name?: string }>;
    const value = feature === "sourceId"
      ? String(sources.find((row) => String(row.id) === raw)?.name ?? (raw === "unknown" ? "None" : "Another source"))
      : feature === "countryCode" && raw.length === 2 ? countryName(raw) : humanize(raw);
    return `${humanize(feature)}: ${value}`;
  };

  // Name each record the lead became, so the flow reads as the real account/contact/deal.
  const optionName = (key: "parties" | "contacts" | "opportunities", id: string | null | undefined) =>
    id ? String(((optionsQuery.data?.options?.[key] ?? []) as Array<{ id: string; name?: string }>).find((row) => String(row.id) === id)?.name ?? "View record") : undefined;
  const conversionFlow: BusinessFlowNode[] | null =
    lead.recordStatus === "converted"
      ? [
          { id: "lead", label: "Lead", state: "completed", meta: lead.code },
          { id: "account", label: "Account", state: lead.convertedPartyId ? "completed" : "future", href: lead.convertedPartyId ? `/crm/accounts/${lead.convertedPartyId}` : undefined, meta: optionName("parties", lead.convertedPartyId) },
          { id: "contact", label: "Contact", state: lead.convertedContactId ? "completed" : "future", href: lead.convertedContactId ? `/crm/contacts/${lead.convertedContactId}` : undefined, meta: optionName("contacts", lead.convertedContactId) },
          { id: "opportunity", label: "Opportunity", state: lead.convertedOpportunityId ? "completed" : "future", href: lead.convertedOpportunityId ? `/crm/opportunities/${lead.convertedOpportunityId}` : undefined, meta: optionName("opportunities", lead.convertedOpportunityId) },
        ]
      : null;

  const accountCandidates = convertPreviewQuery.data?.accountCandidates ?? [];
  const contactCandidates = convertPreviewQuery.data?.contactCandidates ?? [];

  // Pre-select exact matches once, mirroring convertCrmLead's own default:
  // an exact Account is reused, and an exact Contact only when it sits under
  // that same Account (the server rejects a Contact from another Account).
  // Adjusting state during render, guarded to run once per preview open.
  if (!convertAutoSelected && convertPreviewOpen && convertPreviewQuery.isSuccess) {
    setConvertAutoSelected(true);
    const exactAccount = accountCandidates.find((row) => row.classification === "exact");
    const exactContact = exactAccount ? contactCandidates.find((row) => row.classification === "exact" && row.party_id === exactAccount.id) : undefined;
    if (exactAccount) setConvertPartyId(exactAccount.id);
    if (exactContact) setConvertContactId(exactContact.id);
  }
  // A Contact can only be reused under the Account being converted into.
  const eligibleContactCandidates = convertPartyId ? contactCandidates.filter((row) => row.party_id === convertPartyId) : [];

  const accountChoiceOptions: SelectOption[] = [
    { value: "", label: "Create a new Account" },
    ...accountCandidates.map((row) => ({
      value: row.id,
      label: `${row.display_name || row.legal_name || row.id} (${row.classification === "exact" ? "exact match" : "possible match"})`,
    })),
  ];
  const contactChoiceOptions: SelectOption[] = [
    { value: "", label: "Create a new Contact" },
    ...eligibleContactCandidates.map((row) => ({
      value: row.id,
      label: `${row.first_name || ""} ${row.last_name || ""}`.trim() + (row.email ? ` · ${row.email}` : "") + (row.classification === "exact" ? " (exact match)" : " (possible match)"),
    })),
  ];

  return (
    <>
    <RecordDetailsPage
      header={{
        title: lead.fullName || `${lead.firstName} ${lead.lastName || ""}`.trim(),
        // A converted or archived lead is described by that outcome, not by the stage it last sat in.
        status: lead.recordStatus === "converted" ? <StatusBadge tone="success">Converted</StatusBadge> : lead.recordStatus === "archived" ? <StatusBadge tone="neutral">Archived</StatusBadge> : <StatusBadge tone={statusTone[lead.status] ?? "neutral"}>{stageNameByCode[lead.status] ?? humanize(lead.status)}</StatusBadge>,
        fields: [
          { label: "Owner", value: lead.ownerName || "Unassigned" },
          { label: "Priority", value: humanize(lead.priority) },
          { label: "Score", value: lead.score !== null ? scoreLabel(lead.score, 100, humanize(lead.leadGrade ?? lead.grade) || null) : "Not scored" },
          { label: "Qualification", value: humanize(lead.qualificationState || "not_reviewed") },
          { label: "Next follow-up", value: lead.nextFollowUpAt ? `${formatDate(lead.nextFollowUpAt)}${dueState(lead.nextFollowUpAt) === "overdue" ? " (" + dueLabel(lead.nextFollowUpAt) + ")" : ""}` : "None scheduled" },
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
            <Tab id="privacy">Privacy</Tab>
            <Tab id="activity">Activity</Tab>
            <Tab id="communications">Communications</Tab>
            <Tab id="notes">Notes</Tab>
            <Tab id="attachments">Attachments</Tab>
            <Tab id="custom-fields">Custom Fields</Tab>
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

              <LeadTagsPanel leadId={leadId} canManage={canManageLeads && !isClosed} />

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

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <PropertyList title="Contact" items={[
                  { label: "Email", value: lead.email },
                  { label: "Phone", value: lead.phone },
                  { label: "Mobile", value: lead.mobile },
                  { label: "City", value: lead.city },
                  { label: "Country", value: countryName(lead.countryCode) },
                ]} />
                <PropertyList title="Company and interest" items={[
                  { label: "Company", value: lead.companyName },
                  { label: "Job title", value: lead.jobTitle },
                  { label: "Industry", value: lead.industry },
                  { label: "Product interest", value: lead.productInterest },
                  { label: "Estimated value", value: lead.estimatedValue !== null && Number(lead.estimatedValue) > 0 ? money(lead.currencyCode, lead.estimatedValue) : null },
                ]} />
              </div>

              {!isClosed && canManageLeads && (
                <div className="flex flex-col gap-3 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Assignment</p>
                  <p className="text-xs text-text-muted">
                    You can assign to people in your reporting scope who are eligible for this lead.
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <Select label="Owner" size="compact" options={ownerOptions} selectedKey={pendingOwnerId || lead.ownerUserId || "unassigned"} onSelectionChange={(key) => setPendingOwnerId(String(key ?? ""))} className="min-w-[220px]" />
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
                    <StatusBadge tone={qualification.state === "qualified" ? "success" : qualification.state === "unqualified" ? "danger" : "neutral"}>{humanize(qualification.state)}</StatusBadge>
                    {qualification.history[0]?.overrideUsed && qualification.decidedAt && (
                      <StatusBadge tone="warning">Decided with an override</StatusBadge>
                    )}
                    {qualification.decidedAt && (
                      <span className="text-xs text-text-muted">
                        Decided by {qualification.decidedByName || "—"} on {dateTimeFormatter.format(new Date(qualification.decidedAt))}
                      </span>
                    )}
                  </div>
                  {qualification.reasonCode && <Field label="Reason" value={`${humanize(qualification.reasonCode)}${qualification.reasonText ? `: ${qualification.reasonText}` : ""}`} />}
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
                          title: `${event.decidedByName || "Someone"} set qualification to ${humanize(event.newState).toLowerCase()}${event.overrideUsed ? " (override)" : ""}`,
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
                      options={destinationStageOptions}
                      selectedKey={pendingStageId}
                      onSelectionChange={(key) => setPendingStageId(String(key ?? ""))}
                      className="min-w-[220px]"
                      placeholder={destinationStageOptions.length ? "Choose a stage" : "No legal transitions configured"}
                    />
                    <Button
                      variant="secondary"
                      size="compact"
                      onPress={() => stageMutation.mutate()}
                      isLoading={stageMutation.isPending}
                      isDisabled={!pendingStageId || (reasonRequired && !pendingReasonCode && !stageOverrideMode) || (stageOverrideMode && stageOverrideReason.trim().length < 3)}
                    >
                      <CheckCircle2 className="size-4" aria-hidden="true" />
                      Move
                    </Button>
                  </div>
                  {pendingStageId && reasonRequired && !stageOverrideMode && (
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
                  {stageDetailQuery.data?.canOverride && (
                    <Checkbox
                      isSelected={stageOverrideMode}
                      onChange={(checked) => {
                        setStageOverrideMode(checked);
                        setPendingStageId("");
                        setPendingReasonCode("");
                        setStageOverrideReason("");
                      }}
                    >
                      Move to a different stage (advanced) — outside the normal lifecycle path
                    </Checkbox>
                  )}
                  {stageOverrideMode && (
                    <TextArea
                      label="Override reason"
                      description="Explain why this Lead is moving outside its normal lifecycle path. Recorded permanently on the stage history."
                      value={stageOverrideReason}
                      onChange={setStageOverrideReason}
                    />
                  )}
                </div>
              )}

              {stageDetailQuery.data && stageDetailQuery.data.history.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-4">
                  <p className="text-sm font-semibold text-text">Stage history</p>
                  <Timeline
                    entries={stageDetailQuery.data.history.map((event) => ({
                      id: event.id,
                      title: `${event.actorName || "Someone"} moved ${event.fromStageName} → ${event.toStageName}${event.overrideUsed ? " (override)" : ""}`,
                      description: event.overrideReason || event.reasonLabel || event.note || undefined,
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
                <Field label="Grade" value={humanize(explanation?.lead_grade ?? lead.grade) || "—"} />
                <Field label="Last calculated" value={explanation?.score_calculated_at ? dateTimeFormatter.format(new Date(explanation.score_calculated_at)) : "Never"} />
              </div>
              {canManageLeads && (
                <Button variant="secondary" size="compact" className="w-fit" onPress={() => recalculateMutation.mutate()} isLoading={recalculateMutation.isPending}>
                  <RefreshCw className="size-4" aria-hidden="true" />
                  Recalculate now
                </Button>
              )}
              {scoreRules.length > 0 && (
                <div className="flex flex-col gap-2 border-t border-border pt-4" aria-label="How the score adds up">
                  <p className="text-sm font-semibold text-text">How the score adds up</p>
                  <ul className="flex flex-col gap-1">
                    {scoreRules.map((contribution, i) => (
                      <li key={i} className="flex justify-between text-sm text-text-secondary">
                        <span>{contribution.occurrences > 1 ? `${contribution.name} (×${contribution.occurrences})` : contribution.name}</span>
                        <span className="tabular-nums">{contribution.points > 0 ? `+${contribution.points}` : contribution.points}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-text-muted">Only rules that matched are listed. The same inputs always give the same score.</p>
                </div>
              )}
              {explanation?.score_explanation?.model && (
                <p className="text-xs text-text-muted">Rules: {explanation.score_explanation.model.name} (v{explanation.score_explanation.model.version})</p>
              )}
              {!explanation?.score_calculated_at && !contributions && (
                <p className="text-sm text-text-secondary">No scoring model has evaluated this Lead yet.</p>
              )}
              {/* F027 — the ML propensity is separate from the rule score: its own number, its own explanation, never mixed into the score above. */}
              {explanation?.propensity_score != null && (
                <div className="flex flex-col gap-2 border-t border-border pt-4" aria-label="Likelihood to qualify">
                  <p className="text-sm font-semibold text-text">Likelihood to qualify (model estimate)</p>
                  <p className="text-xs text-text-muted">
                    {"Learned from past qualified and unqualified leads. It is shown next to the score, not added to it."}
                  </p>
                  <div className="flex flex-wrap items-center gap-4">
                    <Field label="Likelihood" value={`${explanation.propensity_score}%`} />
                    <Field label="Band" value={explanation.propensity_grade ? humanize(explanation.propensity_grade) : "—"} />
                    <Field label="Last calculated" value={explanation.propensity_calculated_at ? dateTimeFormatter.format(new Date(explanation.propensity_calculated_at)) : "Never"} />
                  </div>
                  {propensityFactors.length > 0 && (
                    <ul className="flex flex-col gap-1">
                      {propensityFactors.slice(0, 5).map((factor, i) => (
                        <li key={i} className="flex justify-between text-sm text-text-secondary">
                          <span>{describeFactor(factor.name)}</span>
                          <span>{factor.points > 0 ? "Raises the likelihood" : factor.points < 0 ? "Lowers the likelihood" : "No effect"}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                  {explanation.propensity_explanation?.model && (
                    <p className="text-xs text-text-muted">Model: {explanation.propensity_explanation.model.name} (v{explanation.propensity_explanation.model.version})</p>
                  )}
                </div>
              )}
              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-sm font-semibold text-text">Attribution</p>
                {attributionQuery.isLoading && <p className="text-sm text-text-secondary">Loading touchpoints…</p>}
                {attributionQuery.isSuccess && (attributionQuery.data.timeline.touchpoints.length === 0 ? (
                  <p className="text-sm text-text-secondary">No marketing touchpoints recorded for this Lead yet.</p>
                ) : (
                  <>
                    <p className="text-xs text-text-muted">{`Credit model: ${humanize(attributionQuery.data.timeline.model)}`}</p>
                    <ul className="flex flex-col gap-1">
                      {attributionQuery.data.timeline.touchpoints.map((touchpoint) => (
                        <li key={touchpoint.id} className="flex items-center justify-between gap-2 text-sm text-text-secondary">
                          <span>{`${humanize(touchpoint.event_type)} · ${humanize(touchpoint.channel)}${touchpoint.campaign_name ? ` · ${touchpoint.campaign_name}` : ""}`}</span>
                          <span className="shrink-0 text-xs tabular-nums">{`${formatDate(touchpoint.event_at)} · ${Math.round(touchpoint.creditWeight * 100)}% credit`}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                ))}
              </div>
            </div>
          </TabPanel>

          <TabPanel id="privacy">
            <div className="flex flex-col gap-4 py-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-sm text-text-secondary">Consent evidence and data-subject requests recorded for this Lead. See CRM Settings &rsaquo; Data Subject Requests to review and execute a request.</p>
                {canManageLeads && (
                  <Button variant="secondary" size="compact" onPress={() => setPrivacyRequestOpen(true)}>
                    <ShieldAlert className="size-4" aria-hidden="true" />
                    New privacy request
                  </Button>
                )}
              </div>
              {consentQuery.isLoading && <p className="text-sm text-text-secondary">Loading consent history…</p>}
              {consentQuery.isSuccess && (consentQuery.data.rows.length === 0 ? (
                <p className="text-sm text-text-secondary">No consent events recorded for this Lead yet.</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {consentQuery.data.rows.map((event) => (
                    <li key={event.id} className="flex items-center justify-between gap-2 text-sm text-text-secondary">
                      <span>{`${humanize(event.channel)} ${event.action} (${humanize(event.source)})`}</span>
                      <span className="shrink-0 text-xs tabular-nums">{formatDate(event.occurredAt)}</span>
                    </li>
                  ))}
                </ul>
              ))}
            </div>
          </TabPanel>

          <TabPanel id="activity">
            <div className="py-4">
              <RecordTimelinePanel entityType="lead" entityId={leadId} />
            </div>
          </TabPanel>

          <TabPanel id="communications">
            <div className="py-4">
              <EmailHistoryPanel entityType="lead" entityId={leadId} />
            </div>
          </TabPanel>

          <TabPanel id="notes">
            <div className="py-4">
              <NotesPanel entityType="lead" entityId={leadId} />
            </div>
          </TabPanel>

          <TabPanel id="attachments">
            <div className="py-4">
              <CrmAttachmentPanel entityType="lead" entityId={leadId} />
            </div>
          </TabPanel>

          <TabPanel id="custom-fields">
            <div className="py-4">
              <CustomFieldsRuntimePanel entityType="lead" entityId={leadId} />
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
            <Select
              label="Account"
              options={accountChoiceOptions}
              selectedKey={convertPartyId}
              onSelectionChange={(key) => {
                const nextPartyId = String(key ?? "");
                setConvertPartyId(nextPartyId);
                if (!contactCandidates.some((row) => row.id === convertContactId && row.party_id === nextPartyId)) setConvertContactId("");
              }}
            />
            <Select label="Contact" options={contactChoiceOptions} selectedKey={convertContactId} onSelectionChange={(key) => setConvertContactId(String(key ?? ""))} />
            {!convertPartyId && contactCandidates.length > 0 && (
              <p className="text-xs text-text-muted">{`${contactCandidates.length} similar contact${contactCandidates.length === 1 ? " exists" : "s exist"} under other accounts; a new Contact is created under the new Account.`}</p>
            )}
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
    <Dialog isOpen={privacyRequestOpen} onOpenChange={setPrivacyRequestOpen} title="New privacy request for this Lead">
      <div className="flex flex-col gap-4">
        <Select
          label="Request type"
          options={[
            { value: "access", label: "Access" },
            { value: "export", label: "Export" },
            { value: "correction", label: "Correction" },
            { value: "deletion", label: "Deletion" },
            { value: "restriction", label: "Restriction" },
            { value: "consent_withdrawal", label: "Consent withdrawal" },
          ]}
          selectedKey={privacyRequestType}
          onSelectionChange={(key) => setPrivacyRequestType(String(key ?? "export"))}
        />
        <p className="text-xs text-text-muted">Review, verify identity and execute the request from CRM Settings &rsaquo; Data Subject Requests.</p>
        {actionError && <p role="alert" className="text-sm text-danger">{actionError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onPress={() => setPrivacyRequestOpen(false)}>Cancel</Button>
          <Button variant="primary" onPress={() => privacyRequestMutation.mutate()} isLoading={privacyRequestMutation.isPending}>
            Create request
          </Button>
        </div>
      </div>
    </Dialog>
    </>
  );
}
