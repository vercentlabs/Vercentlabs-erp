"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Pencil, Repeat } from "lucide-react";
import {
  Button,
  ErrorState,
  PermissionState,
  RecordDetailsPage,
  StatusBadge,
  Tab,
  TabList,
  TabPanel,
  Tabs,
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
import {
  countryName,
  dueLabel,
  dueState,
  formatDate,
  humanize,
  scoreLabel,
} from "@/shared/format/human";
import {
  assignLead,
  convertLead,
  decideLeadQualification,
  type LeadScoreContribution,
  LeadApiError,
  recalculateLeadScore,
  transitionLeadStage,
} from "../api/leads-api";
import { LoadingState } from "@/shared/ui/LoadingState";
import {
  createPrivacyRequest,
  PrivacyApiError,
} from "@/features/crm/setup/privacy-requests/api/privacy-requests-api";
import { useLeadDetailData } from "../detail/useLeadDetailData";
import { LeadOverviewTab } from "../detail/LeadOverviewTab";
import { LeadQualificationTab } from "../detail/LeadQualificationTab";
import { LeadPipelineTab } from "../detail/LeadPipelineTab";
import { LeadIntelligenceTab } from "../detail/LeadIntelligenceTab";
import { LeadPrivacyTab } from "../detail/LeadPrivacyTab";
import { ConvertLeadDialog } from "../detail/ConvertLeadDialog";
import { LeadPrivacyRequestDialog } from "../detail/LeadPrivacyRequestDialog";

// F007: the five Lead pipeline stage codes (stable codes; human-facing
// labels come from the live stage catalogue via stageNameByCode below).
const statusTone: Record<
  string,
  "neutral" | "info" | "success" | "warning" | "danger"
> = {
  new: "info",
  attempting: "info",
  contacted: "info",
  working: "warning",
  nurturing: "neutral",
};

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

export function LeadDetailScreen({ leadId }: { leadId: string }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const workspace = useWorkspaceContext();
  const canManageLeads = workspace.permissions.includes(
    CRM_PERMISSIONS.leadsManage,
  );
  const canResolveDuplicates = workspace.permissions.includes(
    CRM_PERMISSIONS.dataQualityManage,
  );

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
  const [qualDecision, setQualDecision] = useState<
    "qualified" | "unqualified" | ""
  >("");
  const [qualReasonCode, setQualReasonCode] = useState<string>("");
  const [qualReasonText, setQualReasonText] = useState<string>("");
  const [qualNote, setQualNote] = useState<string>("");
  const [qualOverride, setQualOverride] = useState(false);
  const [qualOverrideReason, setQualOverrideReason] = useState<string>("");

  const {
    leadQuery,
    lead,
    optionsQuery,
    stageDetailQuery,
    transitionGraphQuery,
    reasonsQuery,
    qualificationQuery,
    scoreQuery,
    attributionQuery,
    consentQuery,
    convertPreviewQuery,
  } = useLeadDetailData(leadId, pendingStageId, convertPreviewOpen);

  function invalidateLead() {
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "leads", leadId),
    });
    queryClient.invalidateQueries({
      queryKey: scopedQueryKey(workspace, "crm", "leads"),
    });
  }

  function handleActionError(error: unknown) {
    if (
      error instanceof LeadApiError &&
      (error.code === "CRM_STALE_WRITE" ||
        error.code === "CRM_LEAD_STAGE_CONFLICT")
    ) {
      setConflictMessage(error.message);
      return;
    }
    setActionError(
      error instanceof Error
        ? error.message
        : "The action could not be completed.",
    );
  }

  const assignMutation = useMutation({
    mutationFn: () =>
      assignLead(leadId, {
        ownerUserId:
          pendingOwnerId && pendingOwnerId !== "unassigned"
            ? pendingOwnerId
            : null,
        reason: assignReason || undefined,
        expectedUpdatedAt: lead!.updatedAt,
      }),
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
        ...(stageOverrideMode
          ? { overrideUsed: true, overrideReason: stageOverrideReason }
          : {}),
      }),
    onSuccess: () => {
      setActionError(null);
      setPendingStageId("");
      setPendingReasonCode("");
      setPendingNote("");
      setStageOverrideMode(false);
      setStageOverrideReason("");
      invalidateLead();
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(
          workspace,
          "crm",
          "leads",
          leadId,
          "stage-detail",
        ),
      });
    },
    onError: handleActionError,
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
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(
          workspace,
          "crm",
          "leads",
          leadId,
          "qualification",
        ),
      });
    },
    onError: handleActionError,
  });

  const recalculateMutation = useMutation({
    mutationFn: () =>
      recalculateLeadScore(leadId, "Manual recalculation from Lead 360"),
    onSuccess: () => {
      setActionError(null);
      invalidateLead();
      queryClient.invalidateQueries({
        queryKey: scopedQueryKey(workspace, "crm", "leads", leadId, "score"),
      });
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
    onError: (error: unknown) =>
      setActionError(
        error instanceof PrivacyApiError
          ? error.message
          : "This privacy request could not be created.",
      ),
  });

  const ownerOptions: SelectOption[] = useMemo(() => {
    // "unassigned" is a real option (an empty key reads as "nothing chosen"),
    // and the current owner is always listed even if outside the eligible list.
    // Only people the server will accept (assignableOwnerIds: null = anyone
    // eligible; otherwise yourself and your managed sales team).
    const assignable = optionsQuery.data?.options?.assignableLeadOwnerIds as
      string[] | null | undefined;
    const rows = (optionsQuery.data?.options?.users ?? []).filter(
      (row) =>
        assignable === null || (assignable ?? []).includes(String(row.id)),
    );
    const options = [
      { value: "unassigned", label: "Unassigned" },
      ...rows.map((row) => ({
        value: String(row.id),
        label: String(row.fullName || row.name || row.email || row.id),
      })),
    ];
    const currentOwnerId = lead?.ownerUserId ?? null;
    const currentOwnerName = lead?.ownerName ?? null;
    if (
      currentOwnerId &&
      !options.some((option) => option.value === currentOwnerId)
    )
      options.push({
        value: currentOwnerId,
        label: `${currentOwnerName ?? "Current owner"} (current)`,
      });
    return options;
  }, [optionsQuery.data, lead?.ownerUserId, lead?.ownerName]);

  // F007: the primary status badge must show the configured human-facing
  // stage label ("Attempting Contact"), never the raw stable code.
  const stageNameByCode = useMemo(() => {
    const rows = (optionsQuery.data?.options?.leadStages ?? []) as Array<{
      code: string;
      name: string;
    }>;
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
    return Boolean(
      edges.find(
        (edge) =>
          edge.toStageId === pendingStageId &&
          edge.fromStageCode === lead?.status,
      )?.reasonRequired,
    );
  }, [transitionGraphQuery.data, pendingStageId, lead]);

  // F007 gap-closure — every active stage, used only while override mode is
  // on so an elevated user can reach a destination the normal transition
  // graph doesn't allow. Never the default option set.
  const allActiveStageOptions: SelectOption[] = useMemo(() => {
    const rows = (optionsQuery.data?.options?.leadStages ?? []) as Array<{
      id: string;
      code: string;
      name: string;
      status: string;
    }>;
    return rows
      .filter((row) => row.status === "active" && row.code !== lead?.status)
      .map((row) => ({ value: row.id, label: row.name }));
  }, [optionsQuery.data, lead]);
  const destinationStageOptions = stageOverrideMode
    ? allActiveStageOptions
    : legalStageOptions;

  if (leadQuery.isLoading)
    return <LoadingState label="Loading lead" rows={3} />;
  if (leadQuery.isError) {
    if (
      leadQuery.error instanceof LeadApiError &&
      leadQuery.error.status === 403
    ) {
      return (
        <PermissionState
          title="You don't have access to this Lead"
          description="Ask an administrator to grant CRM lead access."
        />
      );
    }
    if (
      leadQuery.error instanceof LeadApiError &&
      leadQuery.error.status === 404
    ) {
      return (
        <ErrorState
          title="Lead not found"
          description="This Lead may have been merged, converted, or removed."
          action={{
            label: "Back to Leads",
            onPress: () => router.push("/crm/leads"),
          }}
        />
      );
    }
    return (
      <ErrorState
        title="Could not load this Lead"
        action={{ label: "Retry", onPress: () => leadQuery.refetch() }}
      />
    );
  }
  if (!lead) return null;

  const isClosed =
    lead.recordStatus === "converted" || lead.recordStatus === "archived";
  const qualification = qualificationQuery.data?.qualification;
  const explanation = scoreQuery.data?.explanation;
  const contributions = recalculateMutation.data?.contributions;
  // F027 — the stored explanation already carries the rule-by-rule
  // breakdown; show it without requiring a recalculation first.
  const scoreRules: LeadScoreContribution[] =
    contributions ??
    parseContributions(explanation?.score_explanation?.contributions);
  const propensityFactors = parseContributions(
    explanation?.propensity_explanation?.contributions,
  );
  // Factor names are "feature: value"; show the value in words (a source id becomes its name).
  const describeFactor = (name: string) => {
    const [feature, ...rest] = name.split(":");
    const raw = rest.join(":").trim();
    const sources = (optionsQuery.data?.options?.allSources ??
      optionsQuery.data?.options?.sources ??
      []) as Array<{ id: string; name?: string }>;
    const value =
      feature === "sourceId"
        ? String(
            sources.find((row) => String(row.id) === raw)?.name ??
              (raw === "unknown" ? "None" : "Another source"),
          )
        : feature === "countryCode" && raw.length === 2
          ? countryName(raw)
          : humanize(raw);
    return `${humanize(feature)}: ${value}`;
  };

  // Name each record the lead became, so the flow reads as the real account/contact/deal.
  const optionName = (
    key: "parties" | "contacts" | "opportunities",
    id: string | null | undefined,
  ) =>
    id
      ? String(
          (
            (optionsQuery.data?.options?.[key] ?? []) as Array<{
              id: string;
              name?: string;
            }>
          ).find((row) => String(row.id) === id)?.name ?? "View record",
        )
      : undefined;
  const conversionFlow: BusinessFlowNode[] | null =
    lead.recordStatus === "converted"
      ? [
          { id: "lead", label: "Lead", state: "completed", meta: lead.code },
          {
            id: "account",
            label: "Account",
            state: lead.convertedPartyId ? "completed" : "future",
            href: lead.convertedPartyId
              ? `/crm/accounts/${lead.convertedPartyId}`
              : undefined,
            meta: optionName("parties", lead.convertedPartyId),
          },
          {
            id: "contact",
            label: "Contact",
            state: lead.convertedContactId ? "completed" : "future",
            href: lead.convertedContactId
              ? `/crm/contacts/${lead.convertedContactId}`
              : undefined,
            meta: optionName("contacts", lead.convertedContactId),
          },
          {
            id: "opportunity",
            label: "Opportunity",
            state: lead.convertedOpportunityId ? "completed" : "future",
            href: lead.convertedOpportunityId
              ? `/crm/opportunities/${lead.convertedOpportunityId}`
              : undefined,
            meta: optionName("opportunities", lead.convertedOpportunityId),
          },
        ]
      : null;

  const accountCandidates = convertPreviewQuery.data?.accountCandidates ?? [];
  const contactCandidates = convertPreviewQuery.data?.contactCandidates ?? [];

  // Pre-select exact matches once, mirroring convertCrmLead's own default:
  // an exact Account is reused, and an exact Contact only when it sits under
  // that same Account (the server rejects a Contact from another Account).
  // Adjusting state during render, guarded to run once per preview open.
  if (
    !convertAutoSelected &&
    convertPreviewOpen &&
    convertPreviewQuery.isSuccess
  ) {
    setConvertAutoSelected(true);
    const exactAccount = accountCandidates.find(
      (row) => row.classification === "exact",
    );
    const exactContact = exactAccount
      ? contactCandidates.find(
          (row) =>
            row.classification === "exact" && row.party_id === exactAccount.id,
        )
      : undefined;
    if (exactAccount) setConvertPartyId(exactAccount.id);
    if (exactContact) setConvertContactId(exactContact.id);
  }
  // A Contact can only be reused under the Account being converted into.
  const eligibleContactCandidates = convertPartyId
    ? contactCandidates.filter((row) => row.party_id === convertPartyId)
    : [];

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
      label:
        `${row.first_name || ""} ${row.last_name || ""}`.trim() +
        (row.email ? ` · ${row.email}` : "") +
        (row.classification === "exact"
          ? " (exact match)"
          : " (possible match)"),
    })),
  ];

  return (
    <>
      <RecordDetailsPage
        header={{
          title:
            lead.fullName || `${lead.firstName} ${lead.lastName || ""}`.trim(),
          // A converted or archived lead is described by that outcome, not by the stage it last sat in.
          status:
            lead.recordStatus === "converted" ? (
              <StatusBadge tone="success">Converted</StatusBadge>
            ) : lead.recordStatus === "archived" ? (
              <StatusBadge tone="neutral">Archived</StatusBadge>
            ) : (
              <StatusBadge tone={statusTone[lead.status] ?? "neutral"}>
                {stageNameByCode[lead.status] ?? humanize(lead.status)}
              </StatusBadge>
            ),
          fields: [
            { label: "Owner", value: lead.ownerName || "Unassigned" },
            { label: "Priority", value: humanize(lead.priority) },
            {
              label: "Score",
              value:
                lead.score !== null
                  ? scoreLabel(
                      lead.score,
                      100,
                      humanize(lead.leadGrade ?? lead.grade) || null,
                    )
                  : "Not scored",
            },
            {
              label: "Qualification",
              value: humanize(lead.qualificationState || "not_reviewed"),
            },
            {
              label: "Next follow-up",
              value: lead.nextFollowUpAt
                ? `${formatDate(lead.nextFollowUpAt)}${dueState(lead.nextFollowUpAt) === "overdue" ? " (" + dueLabel(lead.nextFollowUpAt) + ")" : ""}`
                : "None scheduled",
            },
          ],
          primaryAction:
            canManageLeads && !isClosed ? (
              <Button
                variant="secondary"
                onPress={() => router.push(`/crm/leads/${leadId}/edit`)}
              >
                <Pencil className="size-4" aria-hidden="true" />
                Edit
              </Button>
            ) : undefined,
          secondaryActions:
            canManageLeads && !isClosed ? (
              <Button
                variant="primary"
                onPress={() => setConvertPreviewOpen(true)}
              >
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
              <LeadOverviewTab
                leadId={leadId}
                lead={lead}
                router={router}
                conflictMessage={conflictMessage}
                actionError={actionError}
                conversionFlow={conversionFlow}
                isClosed={isClosed}
                canManageLeads={canManageLeads}
                canResolveDuplicates={canResolveDuplicates}
                invalidateLead={invalidateLead}
                ownerOptions={ownerOptions}
                pendingOwnerId={pendingOwnerId}
                setPendingOwnerId={setPendingOwnerId}
                assignReason={assignReason}
                setAssignReason={setAssignReason}
                assignMutation={assignMutation}
              />
            </TabPanel>

            <TabPanel id="qualification">
              <LeadQualificationTab
                qualificationQuery={qualificationQuery}
                qualification={qualification}
                isClosed={isClosed}
                canManageLeads={canManageLeads}
                qualDecision={qualDecision}
                setQualDecision={setQualDecision}
                qualReasonCode={qualReasonCode}
                setQualReasonCode={setQualReasonCode}
                qualReasonText={qualReasonText}
                setQualReasonText={setQualReasonText}
                qualNote={qualNote}
                setQualNote={setQualNote}
                qualOverride={qualOverride}
                setQualOverride={setQualOverride}
                qualOverrideReason={qualOverrideReason}
                setQualOverrideReason={setQualOverrideReason}
                qualifyMutation={qualifyMutation}
              />
            </TabPanel>

            <TabPanel id="pipeline">
              <LeadPipelineTab
                stageDetailQuery={stageDetailQuery}
                reasonsQuery={reasonsQuery}
                isClosed={isClosed}
                canManageLeads={canManageLeads}
                destinationStageOptions={destinationStageOptions}
                reasonRequired={reasonRequired}
                pendingStageId={pendingStageId}
                setPendingStageId={setPendingStageId}
                pendingReasonCode={pendingReasonCode}
                setPendingReasonCode={setPendingReasonCode}
                pendingNote={pendingNote}
                setPendingNote={setPendingNote}
                stageOverrideMode={stageOverrideMode}
                setStageOverrideMode={setStageOverrideMode}
                stageOverrideReason={stageOverrideReason}
                setStageOverrideReason={setStageOverrideReason}
                stageMutation={stageMutation}
              />
            </TabPanel>

            <TabPanel id="intelligence">
              <LeadIntelligenceTab
                lead={lead}
                explanation={explanation}
                contributions={contributions}
                scoreRules={scoreRules}
                propensityFactors={propensityFactors}
                describeFactor={describeFactor}
                attributionQuery={attributionQuery}
                canManageLeads={canManageLeads}
                recalculateMutation={recalculateMutation}
              />
            </TabPanel>

            <TabPanel id="privacy">
              <LeadPrivacyTab
                consentQuery={consentQuery}
                canManageLeads={canManageLeads}
                setPrivacyRequestOpen={setPrivacyRequestOpen}
              />
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
      <ConvertLeadDialog
        lead={lead}
        convertPreviewOpen={convertPreviewOpen}
        handleConvertPreviewOpenChange={handleConvertPreviewOpenChange}
        convertPreviewQuery={convertPreviewQuery}
        accountChoiceOptions={accountChoiceOptions}
        contactChoiceOptions={contactChoiceOptions}
        contactCandidates={contactCandidates}
        convertPartyId={convertPartyId}
        setConvertPartyId={setConvertPartyId}
        convertContactId={convertContactId}
        setConvertContactId={setConvertContactId}
        actionError={actionError}
        convertMutation={convertMutation}
      />
      <LeadPrivacyRequestDialog
        privacyRequestOpen={privacyRequestOpen}
        setPrivacyRequestOpen={setPrivacyRequestOpen}
        privacyRequestType={privacyRequestType}
        setPrivacyRequestType={setPrivacyRequestType}
        actionError={actionError}
        privacyRequestMutation={privacyRequestMutation}
      />
    </>
  );
}
