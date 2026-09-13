"use client";

import {
  ActionButton,
  ActionLink,
  Dialog,
  FormField,
  Record360Archetype,
  SectionHeader,
  StatePanel,
  StatusBadge,
  Surface,
} from "@/shared/design";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useCrmCommandDialog } from "@/modules/crm/ui/crm-command-dialog-provider";

import { requestJson } from "@/shared/http/client-request";
import kernelStyles from "@/shared/design/experience-kernel.module.css";
import LeadQualificationCard from "../lead-lifecycle-qualification-and-prioritization/lead-qualification-card";
import LeadOwnerDialog from "./lead-owner-dialog";
import {
  assignmentReason,
  dateTime,
  jsonText,
  nice,
  num,
  objectValue,
  scoreText,
  type Option,
  type Row,
  type TimelineEvent,
} from "./lead-detail-model";

export default function CrmLeadDetailWorkspace({
  lead,
  activities,
  communications,
  notes,
  scoreHistory,
  opportunities,
  duplicates,
  options,
  attachments,
  selectedTags,
  assignmentHistory,
  qualification,
  lifecycleHistory,
  dwell,
  provenance,
  consentEvents,
  enrichmentReviews,
  slaCases,
  slaEvents,
  dataQuality,
  aiPredictions,
  canManage,
  canAssignOwner,
  canManageActivities,
  canManageCommunications,
  canManagePrivacy,
  canManageDataQuality,
  embedded = false,
  onEdit,
}: {
  lead: Row;
  activities: Row[];
  communications: Row[];
  notes: Row[];
  scoreHistory: Row[];
  opportunities: Row[];
  duplicates: Row[];
  options: Record<string, Option[]>;
  attachments: Row[];
  selectedTags: Row[];
  assignmentHistory: Row[];
  qualification: Row;
  lifecycleHistory: Row[];
  dwell?: Row;
  provenance: Row[];
  consentEvents: Row[];
  enrichmentReviews: Row[];
  slaCases: Row[];
  slaEvents: Row[];
  dataQuality: Row | null;
  aiPredictions: Row[];
  canManage: boolean;
  canAssignOwner: boolean;
  canManageActivities: boolean;
  canManageCommunications: boolean;
  canManagePrivacy: boolean;
  canManageDataQuality: boolean;
  embedded?: boolean;
  onEdit?: (lead: Row) => void;
}) {
  const router = useRouter();
  const { confirm: confirmAction, prompt: promptAction } = useCrmCommandDialog();
  const [tab, setTab] = useState("overview");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  // F017 §CRM-VNEXT-053: version history is fetched on demand per logical
  // file id, not eagerly for every attachment row.
  const [attachmentVersions, setAttachmentVersions] = useState<Record<string, Row[] | undefined>>({});
  const [conflictMessage, setConflictMessage] = useState("");
  const [reasonPrompt, setReasonPrompt] = useState<{ targetCode: string; targetName: string; reasons: Row[] } | null>(null);
  const [changingOwner, setChangingOwner] = useState(false);
  const [enrichmentSelections, setEnrichmentSelections] = useState<Record<string, string[]>>({});
  const customData =
    lead.customData &&
    typeof lead.customData === "object" &&
    !Array.isArray(lead.customData)
      ? (lead.customData as Record<string, unknown>)
      : {};
  const [customRows, setCustomRows] = useState(() =>
    Object.entries(customData).map(([key, value], index) => ({
      id: `${key}-${index}`,
      key,
      value: String(value ?? ""),
    })),
  );
  const [tagIds, setTagIds] = useState(
    () => new Set(selectedTags.map((tag) => String(tag.id))),
  );
  const [activityRows, setActivityRows] = useState(activities);
  const [activitiesHasMore, setActivitiesHasMore] = useState(activities.length >= 200);
  const [loadingActivities, setLoadingActivities] = useState(false);
  const [communicationRows, setCommunicationRows] = useState(communications);
  const [communicationsHasMore, setCommunicationsHasMore] = useState(communications.length >= 200);
  const [loadingCommunications, setLoadingCommunications] = useState(false);
  const id = String(lead.id);

  async function loadOlderTimelineItems(source: "activities" | "communications") {
    const rows = source === "activities" ? activityRows : communicationRows;
    const setLoading = source === "activities" ? setLoadingActivities : setLoadingCommunications;
    const setRows = source === "activities" ? setActivityRows : setCommunicationRows;
    const setHasMore = source === "activities" ? setActivitiesHasMore : setCommunicationsHasMore;
    setLoading(true);
    try {
      const result = await requestJson(
        `/api/crm/leads/${id}/timeline?source=${source}&offset=${rows.length}&limit=50`,
      );
      if (result.ok) {
        setRows((current) => [...current, ...(result.rows as Row[])]);
        setHasMore(Boolean(result.hasMore));
      }
    } finally {
      setLoading(false);
    }
  }
  const leadSource = options.allSources?.find(
    (item) => item.id === String(lead.sourceId),
  );
  const originalLeadSource = options.allSources?.find(
    (item) => item.id === String(lead.originalSourceId),
  );
  const recordStatus = String(lead.recordStatus || "active");
  const lifecycleStages = (options.leadStages || [])
    .filter((stage) => stage.code)
    .sort(
      (left, right) =>
        Number(left.sortOrder || 0) - Number(right.sortOrder || 0),
    );
  const currentStage = lifecycleStages.find(
    (stage) => stage.code === String(lead.status),
  );
  const lifecycleTargets = lifecycleStages.filter(
    (stage) =>
      stage.code === String(lead.status) ||
      (stage.status === "active" &&
        (stage.allowedFromCodes || []).includes(String(lead.status))),
  );
  const name = String(lead.fullName || lead.companyName || "Lead");
  const timeline = useMemo<TimelineEvent[]>(
    () =>
      [
        ...activityRows.map((row) => ({
          ...row,
          __kind: "Activity",
          __date: row.completed_at || row.due_at || row.created_at,
          __title: row.subject,
        })),
        ...communicationRows.map((row) => ({
          ...row,
          __kind: "Communication",
          __date: row.occurred_at,
          __title: row.subject || row.channel,
        })),
        ...notes.map((row) => ({
          ...row,
          __kind: "Note",
          __date: row.created_at,
          __title: row.is_pinned ? "Pinned note" : "Note",
        })),
        ...opportunities.map((row) => ({
          ...row,
          __kind: "Opportunity",
          __date: row.created_at,
          __title: row.name,
        })),
        ...lifecycleHistory.map((row) => ({
          ...row,
          __kind: "Lifecycle",
          __date: row.createdAt || row.created_at,
          __title: `${String(row.fromStageName || row.from_stage_name || row.fromStageCode || row.from_stage_code)} → ${String(row.toStageName || row.to_stage_name || row.toStageCode || row.to_stage_code)}`,
        })),
        // F019 closeout: "files" was the one required Lead Timeline event
        // type this merged feed was still missing — attachments were
        // already fetched server-side (getLeadDetailData) and rendered on
        // their own tab, just never folded into this unified view.
        ...attachments.map((row) => ({
          ...row,
          __kind: "File",
          __date: row.created_at,
          __title: row.file_name,
        })),
      ].sort(
        (a, b) =>
          new Date(String(b.__date || 0)).getTime() -
          new Date(String(a.__date || 0)).getTime(),
      ),
    [activityRows, communicationRows, notes, opportunities, lifecycleHistory, attachments],
  );
  async function api(path: string, body: Row, key = "action") {
    setPending(key);
    setMessage("");
    try {
      const result = await requestJson<Row>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!result.ok) {
        const code = String((result as Record<string, unknown>).code || "");
        if (result.status === 409 && (code === "CRM_STALE_WRITE" || code.includes("VERSION") || code.includes("CONFLICT"))) {
          setConflictMessage("This Lead changed after you opened it. Review the latest Lead before retrying your action.");
          return null;
        }
        throw new Error(result.message || "Request failed.");
      }
      setConflictMessage("");
      setMessage(result.message || "Completed.");
      router.refresh();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
      return null;
    } finally {
      setPending("");
    }
  }
  async function moveStatus(nextStatus: string, reasonCode?: string) {
    setPending("status");
    setMessage("");
    try {
      const result = await requestJson<Row>(`/api/crm/leads/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          stageCode: nextStatus,
          source: "manual",
          expectedUpdatedAt: String(lead.updatedAt || ""),
          reasonCode,
        }),
      });
      if (!result.ok) {
        const code = String((result as Record<string, unknown>).code || "");
        if (code === "CRM_LEAD_STAGE_REASON_REQUIRED") {
          setPending("");
          const targetStage = lifecycleStages.find((stage) => stage.code === nextStatus);
          if (targetStage) {
            const reasonsResult = await requestJson<{ records?: Row[] }>("/api/crm/lead-stages/transition-reasons");
            const allReasons = Array.isArray(reasonsResult.records) ? reasonsResult.records : [];
            const applicable = allReasons.filter((row) => {
              if (row.status !== "active") return false;
              if (row.scopeType === "any") return true;
              if (row.scopeType === "destination") return row.toStageId === targetStage.id;
              return row.fromStageId === currentStage?.id && row.toStageId === targetStage.id;
            });
            setReasonPrompt({ targetCode: nextStatus, targetName: String(targetStage.name), reasons: applicable });
          }
          return;
        }
        if (result.status === 409 && (code === "CRM_STALE_WRITE" || code.includes("VERSION") || code.includes("CONFLICT"))) {
          setConflictMessage("This Lead changed after you opened it. Review the latest Lead before retrying your action.");
          return;
        }
        throw new Error(result.message || "Request failed.");
      }
      setConflictMessage("");
      setMessage(result.message || "Completed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
    } finally {
      setPending("");
    }
  }
  async function archiveLead() {
    if (
      !(await confirmAction({
        title: `Archive ${name}?`,
        description: "This removes the lead from active workspaces. Historical information is preserved.",
        confirmLabel: "Archive",
      }))
    )
      return;
    setPending("archive");
    setMessage("");
    try {
      const result = await requestJson<Row>(
        `/api/crm/leads/${id}?expectedUpdatedAt=${encodeURIComponent(String(lead.updatedAt || ""))}`,
        { method: "DELETE" },
      );
      if (!result.ok) {
        const code = String((result as Record<string, unknown>).code || "");
        if (result.status === 409 && (code === "CRM_STALE_WRITE" || code.includes("VERSION") || code.includes("CONFLICT"))) {
          setConflictMessage("This Lead changed after you opened it. Review the latest Lead before archiving.");
          return;
        }
        throw new Error(result.message || "Lead could not be archived.");
      }
      router.push("/crm/leads");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Lead could not be archived.",
      );
    } finally {
      setPending("");
    }
  }
  async function convert() {
    if (!(await confirmAction({
      title: "Convert this lead?",
      description: "This creates the governed account, contact and opportunity records from the qualified lead.",
      confirmLabel: "Convert lead",
      tone: "primary",
    }))) return;
    const result = await api(
      `/api/crm/leads/${id}/convert`,
      { createOpportunity: true },
      "convert",
    );
    const conversion =
      result?.conversion && typeof result.conversion === "object"
        ? (result.conversion as Row)
        : null;
    const opportunityId = String(conversion?.opportunityId || "");
    if (result?.ok && opportunityId) {
      router.push(`/crm/opportunities/${opportunityId}`);
    }
  }
  async function merge(target: string) {
    if (!(await confirmAction({
      title: "Merge this lead into the selected duplicate?",
      description: "The current lead will be archived after survivorship is applied.",
      confirmLabel: "Merge lead",
    }))) return;
    const result = await api(
      `/api/crm/leads/${id}/merge`,
      { targetLeadId: target },
      "merge",
    );
    if (result?.ok) router.push(`/crm/leads/${target}`);
  }
  async function dismissDuplicate(matchedLeadId: string) {
    const reason = await promptAction({
      title: "Dismiss duplicate match",
      description: "Explain why this is not the same lead. The reason is retained for data-quality evidence.",
      label: "Reason",
      placeholder: "Enter at least 10 characters…",
      confirmLabel: "Dismiss match",
    });
    if (reason == null) return;
    await api(
      "/api/crm/leads/duplicates",
      { leadId: id, matchedLeadId, reason },
      "dismiss",
    );
  }
  async function scheduleFollowUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api(
      `/api/crm/leads/${id}/follow-up`,
      {
        activityType: String(form.get("activityType") || "call"),
        subject: String(form.get("subject") || ""),
        description: String(form.get("description") || ""),
        assignedTo: String(form.get("assignedTo") || lead.ownerUserId || ""),
        priority: String(form.get("priority") || "medium"),
        dueAt: String(form.get("dueAt") || ""),
      },
      "followup",
    );
    if (result) event.currentTarget.reset();
  }
  async function createCommunication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api(
      "/api/crm/communications",
      {
        channel: String(form.get("channel") || "call"),
        direction: String(form.get("direction") || "outbound"),
        leadId: id,
        provider: "manual",
        subject: String(form.get("subject") || ""),
        body: String(form.get("body") || ""),
        fromAddress: String(form.get("fromAddress") || ""),
        occurredAt: String(form.get("occurredAt") || ""),
        status: String(form.get("status") || "logged"),
      },
      "communication",
    );
    if (result) event.currentTarget.reset();
  }
  async function createNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api(
      `/api/crm/leads/${id}/notes`,
      {
        body: String(form.get("body") || ""),
        isPinned: form.get("isPinned") === "on",
        visibility: form.get("visibility") === "private" ? "private" : "shared",
      },
      "note",
    );
    if (result) event.currentTarget.reset();
  }
  async function recordConsent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const occurredAt = String(form.get("occurredAt") || "").trim();
    const note = String(form.get("evidenceNote") || "").trim();
    const body: Row = {
      leadId: id,
      channel: String(form.get("channel") || "email"),
      purpose: String(form.get("purpose") || "sales"),
      action: String(form.get("action") || "granted"),
      lawfulBasis: String(form.get("lawfulBasis") || "consent"),
      source: "manual",
      evidence: note ? { note } : {},
    };
    if (occurredAt) body.occurredAt = occurredAt;
    const result = await api("/api/crm/consent-events", body, "consent");
    if (result) event.currentTarget.reset();
  }
  async function reviewEnrichment(
    reviewId: string,
    input: { decision?: "approved" | "rejected"; acceptedKeys?: string[] },
  ) {
    await api(
      "/api/crm/lead-acquisition/enrichment",
      { action: "review", reviewId, ...input },
      `enrichment-${reviewId}`,
    );
  }
  async function startSlaTracking() {
    await api(
      "/api/crm/lead-intelligence/sla",
      { action: "open", leadId: id, evidence: { source: "lead_360" } },
      "sla-open",
    );
  }
  async function recordSlaResponse() {
    await api(
      "/api/crm/lead-intelligence/sla",
      { action: "respond", leadId: id, responseType: "manual" },
      "sla-respond",
    );
  }
  async function uploadAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending("attachment");
    setMessage("");
    try {
      const form = new FormData(event.currentTarget);
      const result = await requestJson<Row>(
        `/api/crm/leads/${id}/attachments`,
        { method: "POST", body: form },
      );
      if (!result.ok)
        throw new Error(result.message || "Attachment upload failed.");
      setMessage(result.message || "Attachment uploaded.");
      event.currentTarget.reset();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Attachment upload failed.",
      );
    } finally {
      setPending("");
    }
  }
  async function removeAttachment(attachmentId: string) {
    if (!(await confirmAction({ title: "Remove this attachment?", description: "The file will no longer be attached to this lead.", confirmLabel: "Remove attachment" }))) return;
    setPending(`attachment-${attachmentId}`);
    setMessage("");
    try {
      const result = await requestJson<Row>(
        `/api/crm/leads/${id}/attachments/${attachmentId}`,
        { method: "DELETE" },
      );
      if (!result.ok)
        throw new Error(result.message || "Could not remove attachment.");
      setMessage(result.message || "Attachment removed.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Could not remove attachment.",
      );
    } finally {
      setPending("");
    }
  }
  // F017 §CRM-VNEXT-053: replacing a file reuses the SAME logical identity
  // (replacesLogicalId) rather than creating an unrelated attachment — the
  // prior version is preserved, never overwritten.
  async function replaceAttachment(logicalId: string, file: File) {
    setPending(`attachment-replace-${logicalId}`);
    setMessage("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("replacesLogicalId", logicalId);
      const result = await requestJson<Row>(`/api/crm/leads/${id}/attachments`, { method: "POST", body: form });
      if (!result.ok) throw new Error(result.message || "Replacement file could not be uploaded.");
      setMessage(result.message || "Attachment replaced.");
      setAttachmentVersions((prev) => ({ ...prev, [logicalId]: undefined }));
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Replacement file could not be uploaded.");
    } finally {
      setPending("");
    }
  }
  async function toggleAttachmentVersions(logicalId: string) {
    if (attachmentVersions[logicalId] !== undefined) {
      setAttachmentVersions((prev) => ({ ...prev, [logicalId]: undefined }));
      return;
    }
    const result = await requestJson<{ versions?: Row[] }>(`/api/crm/leads/${id}/attachments/${logicalId}/versions`);
    setAttachmentVersions((prev) => ({ ...prev, [logicalId]: result.ok ? result.versions || [] : [] }));
  }
  async function saveTags() {
    await api(`/api/crm/leads/${id}/tags`, { tagIds: [...tagIds] }, "tags");
  }
  async function saveCustomFields() {
    const fields = Object.fromEntries(
      customRows
        .map((row) => [row.key.trim().toLowerCase(), row.value.trim()] as const)
        .filter(([key, value]) => key && value),
    );
    await api(`/api/crm/leads/${id}/custom-fields`, { fields }, "custom");
  }
  const sensitiveDataRestricted = lead.sensitiveDataRestricted === true;
  const tabs = sensitiveDataRestricted
    ? ["overview", "opportunities"]
    : [
        "overview",
        "governance",
        "timeline",
        "activities",
        "communications",
        "notes",
        "opportunities",
        "score",
        "custom",
        "duplicates",
      ];
  const tabLabel = (item: string) =>
    item === "communications"
      ? "Email"
      : item === "governance"
        ? "Governance & AI"
      : item === "notes"
        ? "Notes & files"
        : item === "custom"
          ? "Fields & tags"
          : nice(item);
  const contact = [lead.email, lead.mobile, lead.phone]
    .filter(Boolean)
    .join(" · ");
  const leadContext = [lead.companyName, lead.jobTitle]
    .filter(Boolean)
    .join(" · ");
  const currentSla = slaCases.find((item) =>
    ["open", "paused", "breached"].includes(String(item.status || "")),
  ) || slaCases[0];
  const scoreExplanation = objectValue(lead.scoreExplanation);
  const scoreModel = objectValue(scoreExplanation.model);
  const scoreContributionsRaw = scoreExplanation.contributions;
  const scoreContributions = (() => {
    if (Array.isArray(scoreContributionsRaw)) return scoreContributionsRaw;
    if (typeof scoreContributionsRaw === "string") {
      try {
        const parsed = JSON.parse(scoreContributionsRaw);
        return Array.isArray(parsed) ? parsed : [];
      } catch {
        return [];
      }
    }
    return [];
  })();

  return (
    <Record360Archetype
      className={`crm-suite-page crm-lead-detail-page${embedded ? " is-embedded" : ""}`}
    >
      <header className="crm-lead-detail-command">
        <div className="crm-lead-detail-summary">
          {leadContext ? <p>{leadContext}</p> : null}
          <div className="crm-lead-detail-contact-actions">
            {lead.email ? (
              <a href={`mailto:${String(lead.email)}`}>{String(lead.email)}</a>
            ) : null}
            {lead.mobile || lead.phone ? (
              <a href={`tel:${String(lead.mobile || lead.phone)}`}>
                {String(lead.mobile || lead.phone)}
              </a>
            ) : null}
            {!contact ? <span>{sensitiveDataRestricted ? "Contact details restricted" : "No contact details"}</span> : null}
          </div>
        </div>
        <div className="crm-lead-detail-right">
          <div className="crm-lead-detail-badges">
            <span>
              {currentStage?.name || nice(lead.status)}
              {currentStage?.status === "inactive" ? " · Inactive" : ""}
              {dwell?.status === "breached" ? " · Dwell SLA breached" : dwell?.status === "warning" ? " · Dwell SLA warning" : ""}
            </span>
            <span>
              Score {String(lead.score || 0)} ·{" "}
              {nice(lead.leadGrade || lead.rating || "ungraded")}
            </span>
          </div>
          {canManage &&
          recordStatus === "active" ? (
            <div className="crm-lead-detail-actions">
              {!sensitiveDataRestricted && onEdit ? (
                <ActionButton type="button" onClick={() => onEdit(lead)}>
                  Edit lead
                </ActionButton>
              ) : !sensitiveDataRestricted ? (
                <ActionLink href={`/crm/leads?edit=${encodeURIComponent(id)}`}>
                  Edit lead
                </ActionLink>
              ) : null}
              <ActionButton
                tone="danger"
                busy={pending === "archive"}
                onClick={() => void archiveLead()}
              >
                {pending === "archive" ? "Archiving…" : "Archive lead"}
              </ActionButton>
            </div>
          ) : null}
        </div>
      </header>
      <section className="crm-lead-detail-facts">
        <div>
          <small>Owner</small>
          <strong>{String(lead.ownerName || "Unassigned")}</strong>
          {lead.ownerStatus === "inactive" ? (
            <StatusBadge tone="neutral">Inactive</StatusBadge>
          ) : null}
          {canAssignOwner &&
          recordStatus === "active" ? (
            <ActionButton
              tone="quiet"
              onClick={() => setChangingOwner(true)}
              type="button"
            >
              Change owner
            </ActionButton>
          ) : null}
        </div>
        <div>
          <small>Source</small>
          <strong>{leadSource?.name || "Not specified"}</strong>
          {leadSource?.status === "inactive" ? (
            <StatusBadge tone="neutral">Inactive</StatusBadge>
          ) : null}
        </div>
        {lead.originalSourceId && String(lead.originalSourceId) !== String(lead.sourceId) ? (
          <div>
            <small>Original source</small>
            <strong>{originalLeadSource?.name || "Not specified"}</strong>
          </div>
        ) : null}
        {lead.referrerName ? (
          <div>
            <small>Referred by</small>
            <strong>{String(lead.referrerName)}</strong>
          </div>
        ) : null}
        <div>
          <small>Priority</small>
          <strong>{nice(lead.priority)}</strong>
        </div>
        <div>
          <small>Potential value</small>
          <strong>
            {new Intl.NumberFormat("en-IN", {
              style: "currency",
              currency: String(lead.currencyCode || "INR"),
              maximumFractionDigits: 0,
            }).format(num(lead.estimatedValue))}
          </strong>
        </div>
        <div>
          <small>Next follow-up</small>
          <strong>{dateTime(lead.nextFollowUpAt)}</strong>
        </div>
      </section>
      {changingOwner ? (
        <LeadOwnerDialog lead={lead} onClose={() => setChangingOwner(false)} />
      ) : null}
      {canManage && recordStatus === "active" ? (
        <section className="crm-lead-stage-strip">
          <label htmlFor="lead-lifecycle-select">Lifecycle</label>
          <select
            id="lead-lifecycle-select"
            value={String(lead.status)}
            disabled={pending === "status"}
            onChange={(event) => void moveStatus(event.target.value)}
          >
            {lifecycleTargets.map(
              (stage) => (
                <option key={stage.code} value={stage.code}>
                  {stage.name}{stage.status === "inactive" ? " (Inactive)" : ""}
                </option>
              ),
            )}
          </select>
          <small>Lifecycle and qualification are governed separately.</small>
        </section>
      ) : null}
      {reasonPrompt ? (
        <Dialog
          title={`Move to ${reasonPrompt.targetName}`}
          description="This transition requires a reason."
          onClose={() => setReasonPrompt(null)}
          canDismiss={pending !== "status"}
          busy={pending === "status"}
        >
          <form
            className="crm-suite-form"
            onSubmit={(event) => {
              event.preventDefault();
              const form = new FormData(event.currentTarget);
              const reasonCode = String(form.get("reasonCode") || "");
              setReasonPrompt(null);
              void moveStatus(reasonPrompt.targetCode, reasonCode);
            }}
          >
            <FormField label="Reason" htmlFor="lead-stage-reason-code" required>
              <select id="lead-stage-reason-code" name="reasonCode" required autoFocus>
                <option value="">Select a reason</option>
                {reasonPrompt.reasons.map((reason) => (
                  <option key={String(reason.id)} value={String(reason.code)}>
                    {String(reason.label)}
                  </option>
                ))}
              </select>
            </FormField>
            <footer>
              <ActionButton type="button" onClick={() => setReasonPrompt(null)}>
                Cancel
              </ActionButton>
              <ActionButton tone="primary" type="submit" disabled={!reasonPrompt.reasons.length}>
                Move Lead
              </ActionButton>
            </footer>
          </form>
        </Dialog>
      ) : null}
      {sensitiveDataRestricted ? (
        <div className="notice" role="status">
          <strong>Restricted Lead content.</strong> Contact details, communications, notes, files, score evidence and duplicate signals are hidden by your role.
        </div>
      ) : null}
      {conflictMessage ? (
        <div className="notice" role="alert">
          <strong>{conflictMessage}</strong>{" "}
          <ActionButton tone="quiet" type="button" onClick={() => { setConflictMessage(""); router.refresh(); }}>Review latest Lead</ActionButton>
        </div>
      ) : null}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <label className="lead-detail-section-picker">
        <span>Record section</span>
        <select value={tab} onChange={(event) => setTab(event.target.value)}>
          {tabs.map((item) => (
            <option key={item} value={item}>
              {tabLabel(item)}
              {item === "duplicates" && duplicates.length
                ? ` (${duplicates.length})`
                : ""}
            </option>
          ))}
        </select>
      </label>
      <nav
        className="crm-suite-tabs lead-detail-tabs"
        aria-label="Lead record sections"
        role="tablist"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key))
            return;
          event.preventDefault();
          const current = tabs.indexOf(tab);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? tabs.length - 1
                : (current +
                    (event.key === "ArrowRight" ? 1 : -1) +
                    tabs.length) %
                  tabs.length;
          setTab(tabs[next]);
          window.requestAnimationFrame(() =>
            document.getElementById(`lead-tab-${tabs[next]}`)?.focus(),
          );
        }}
      >
        {tabs.map((item) => (
          <button
            key={item}
            id={`lead-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`lead-panel-${item}`}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {tabLabel(item)}
            {item === "duplicates" && duplicates.length
              ? ` (${duplicates.length})`
              : ""}
          </button>
        ))}
      </nav>

      <div
        id={`lead-panel-${tab}`}
        className="crm-lead-tab-panel"
        role="tabpanel"
        aria-labelledby={`lead-tab-${tab}`}
      >
        {tab === "overview" ? (
          <div className="crm-lead-detail-overview">
            <LeadQualificationCard
              lead={lead}
              qualification={qualification}
              canManage={canManage}
            />
            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Lead profile" title="Qualification context" />
              <dl className="crm-lead-profile-grid">
                {[
                  ["Company", lead.companyName],
                  ["Job title", lead.jobTitle],
                  ["Email", lead.email],
                  ["Mobile", lead.mobile],
                  ["Alternate phone", lead.phone],
                  ["Website", lead.website],
                  ["Industry", lead.industry],
                  [
                    "Location",
                    [lead.city, lead.state, lead.countryCode]
                      .filter(Boolean)
                      .join(", "),
                  ],
                  ["Product interest", lead.productInterest],
                  ["Rating", nice(lead.rating)],
                  ["Email consent", lead.consentEmail ? "Yes" : "No"],
                  ["SMS consent", lead.consentSms ? "Yes" : "No"],
                  ["WhatsApp consent", lead.consentWhatsapp ? "Yes" : "No"],
                  ["Do not contact", lead.doNotContact ? "Yes" : "No"],
                ].map(([label, value]) => (
                  <div key={String(label)}>
                    <dt>{String(label)}</dt>
                    <dd>{String(value || "—")}</dd>
                  </div>
                ))}
              </dl>
            </Surface>
            <aside className="crm-suite-surface">
              <h2>Relationship summary</h2>
              <div className="crm-lead-relationship-counts">
                <button type="button" onClick={() => setTab("activities")}>
                  <strong>{activityRows.length}</strong>
                  <span>Activities</span>
                </button>
                <button type="button" onClick={() => setTab("communications")}>
                  <strong>{communicationRows.length}</strong>
                  <span>Email history</span>
                </button>
                <button type="button" onClick={() => setTab("notes")}>
                  <strong>{notes.length}</strong>
                  <span>Notes</span>
                </button>
                <button type="button" onClick={() => setTab("opportunities")}>
                  <strong>{opportunities.length}</strong>
                  <span>Opportunities</span>
                </button>
              </div>
              <h2 className="crm-suite-subheading">Quick work</h2>
              {canManageActivities ? (
                <ActionButton
                  className="full"
                  type="button"
                  onClick={() => setTab("activities")}
                >
                  Add follow-up
                </ActionButton>
              ) : null}
              {canManage ? (
                <ActionButton
                  className="full"
                  type="button"
                  onClick={() => setTab("notes")}
                >
                  Add internal note
                </ActionButton>
              ) : null}
              {canManage ? (
                <ActionButton
                  className="full"
                  type="button"
                  busy={pending === "score"}
                  onClick={() =>
                    void api(
                      `/api/crm/leads/${id}/score`,
                      { reason: "Lead detail recalculation" },
                      "score",
                    )
                  }
                >
                  Recalculate score
                </ActionButton>
              ) : null}
              <h2 className="crm-suite-subheading">Ownership history</h2>
              <div className="crm-owner-history">
                {assignmentHistory.slice(0, 5).map((event) => (
                  <article key={String(event.id)}>
                    <strong>
                      {String(event.previous_owner_name || "Unassigned")} →{" "}
                      {String(event.new_owner_name || "Unassigned")}
                    </strong>
                    <small>
                      {String(event.actor_name || "System")} ·{" "}
                      {dateTime(event.created_at)}
                    </small>
                    <small>{assignmentReason(event)}</small>
                  </article>
                ))}
                {!assignmentHistory.length ? (
                  <p>No owner changes recorded yet.</p>
                ) : null}
              </div>
            </aside>
          </div>
        ) : null}

        {tab === "governance" ? (
          <div className="crm-suite-two-column wide">
            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Trust & acquisition" title="Provenance and consent evidence" />
              <h3>Lead provenance</h3>
              <div className="crm-suite-list">
                {provenance.map((row) => (
                  <article key={String(row.id)}>
                    <div>
                      <strong>{nice(row.source_channel || "source")}</strong>
                      <small>
                        {String(row.provider || "Internal")} · {dateTime(row.created_at)}
                      </small>
                      <p>
                        External reference: {String(row.external_id || row.source_record_id || "—")}
                      </p>
                      {row.attribution ? <small>Attribution: {jsonText(row.attribution)}</small> : null}
                    </div>
                    <span>{row.content_hash ? `#${String(row.content_hash).slice(0, 10)}` : "Recorded"}</span>
                  </article>
                ))}
                {!provenance.length ? <p>No provenance evidence recorded yet.</p> : null}
              </div>

              <h3 className="crm-suite-subheading">Consent history</h3>
              <div className="crm-suite-list">
                {consentEvents.map((row) => (
                  <article key={String(row.id)}>
                    <div>
                      <strong>{nice(row.action)} · {nice(row.channel)}</strong>
                      <small>{nice(row.purpose)} · {dateTime(row.occurred_at)}</small>
                      <p>{nice(row.lawful_basis || "not specified")} · {nice(row.source || "manual")}</p>
                    </div>
                    <span>{row.expires_at ? `Expires ${dateTime(row.expires_at)}` : "No expiry"}</span>
                  </article>
                ))}
                {canManagePrivacy && !consentEvents.length ? <p>No consent events recorded for this Lead.</p> : null}
                {!canManagePrivacy ? <p>Consent evidence is limited to privacy managers.</p> : null}
              </div>
              {canManagePrivacy ? (
                <form className="crm-suite-form" onSubmit={recordConsent}>
                  <h3>Record consent event</h3>
                  <FormField label="Channel" htmlFor="lead-consent-channel">
                    <select id="lead-consent-channel" name="channel" defaultValue="email">
                      <option value="email">Email</option>
                      <option value="sms">SMS</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="call">Call</option>
                      <option value="postal">Postal</option>
                      <option value="all">All channels</option>
                    </select>
                  </FormField>
                  <FormField label="Purpose" htmlFor="lead-consent-purpose">
                    <select id="lead-consent-purpose" name="purpose" defaultValue="sales">
                      <option value="sales">Sales</option>
                      <option value="marketing">Marketing</option>
                      <option value="service">Service</option>
                      <option value="transactional">Transactional</option>
                      <option value="research">Research</option>
                      <option value="other">Other</option>
                    </select>
                  </FormField>
                  <FormField label="Action" htmlFor="lead-consent-action">
                    <select id="lead-consent-action" name="action" defaultValue="granted">
                      <option value="granted">Granted</option>
                      <option value="withdrawn">Withdrawn</option>
                      <option value="suppressed">Suppressed</option>
                      <option value="resubscribed">Resubscribed</option>
                      <option value="expired">Expired</option>
                    </select>
                  </FormField>
                  <FormField label="Lawful basis" htmlFor="lead-consent-lawful-basis">
                    <select id="lead-consent-lawful-basis" name="lawfulBasis" defaultValue="consent">
                      <option value="consent">Consent</option>
                      <option value="contract">Contract</option>
                      <option value="legal_obligation">Legal obligation</option>
                      <option value="legitimate_interest">Legitimate interest</option>
                      <option value="vital_interest">Vital interest</option>
                      <option value="public_task">Public task</option>
                    </select>
                  </FormField>
                  <FormField label="Occurred at" htmlFor="lead-consent-occurred-at">
                    <input id="lead-consent-occurred-at" name="occurredAt" type="datetime-local" />
                  </FormField>
                  <FormField label="Evidence note" htmlFor="lead-consent-evidence-note">
                    <textarea id="lead-consent-evidence-note" name="evidenceNote" rows={2} maxLength={1000} />
                  </FormField>
                  <ActionButton type="submit" tone="primary" busy={pending === "consent"}>
                    {pending === "consent" ? "Recording…" : "Record immutable event"}
                  </ActionButton>
                </form>
              ) : null}
            </Surface>

            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Lead operations" title="SLA and data quality" />
              <h3>First-response SLA</h3>
              {currentSla ? (
                <dl className="crm-lead-profile-grid">
                  <div><dt>Policy</dt><dd>{String(currentSla.policy_name || "—")}</dd></div>
                  <div><dt>Status</dt><dd>{nice(currentSla.status)}</dd></div>
                  <div><dt>Response due</dt><dd>{dateTime(currentSla.response_due_at)}</dd></div>
                  <div><dt>First response</dt><dd>{dateTime(currentSla.first_responded_at)}</dd></div>
                </dl>
              ) : (
                <p>No SLA case is active for this Lead.</p>
              )}
              {canManage ? (
                <div className="crm-inline-actions">
                  {!currentSla || !["open", "paused", "breached"].includes(String(currentSla.status || "")) ? (
                    <ActionButton busy={pending === "sla-open"} type="button" onClick={() => void startSlaTracking()}>
                      {pending === "sla-open" ? "Starting…" : "Start SLA tracking"}
                    </ActionButton>
                  ) : null}
                  {currentSla && !currentSla.first_responded_at && ["open", "paused", "breached"].includes(String(currentSla.status || "")) ? (
                    <ActionButton busy={pending === "sla-respond"} type="button" onClick={() => void recordSlaResponse()}>
                      {pending === "sla-respond" ? "Recording…" : "Record first response"}
                    </ActionButton>
                  ) : null}
                </div>
              ) : null}
              <div className="crm-suite-list">
                {slaEvents.slice(0, 8).map((row) => (
                  <article key={String(row.id)}>
                    <div><strong>{nice(row.event_type)}</strong><small>{dateTime(row.occurred_at)}</small></div>
                    <span>{jsonText(row.evidence)}</span>
                  </article>
                ))}
              </div>

              <h3 className="crm-suite-subheading">Data quality</h3>
              {canManageDataQuality && dataQuality ? (
                <>
                  <dl className="crm-lead-profile-grid">
                    <div><dt>Overall</dt><dd>{scoreText(dataQuality.overall_score)}</dd></div>
                    <div><dt>Completeness</dt><dd>{scoreText(dataQuality.completeness_score)}</dd></div>
                    <div><dt>Validity</dt><dd>{scoreText(dataQuality.validity_score)}</dd></div>
                    <div><dt>Freshness</dt><dd>{scoreText(dataQuality.freshness_score)}</dd></div>
                    <div><dt>Duplicate risk</dt><dd>{scoreText(dataQuality.duplicate_risk_score)}</dd></div>
                    <div><dt>Calculated</dt><dd>{dateTime(dataQuality.calculated_at)}</dd></div>
                  </dl>
                  {dataQuality.issues ? <p className="crm-helper-copy">Issues: {jsonText(dataQuality.issues)}</p> : null}
                </>
              ) : canManageDataQuality ? (
                <p>No data-quality score has been calculated yet.</p>
              ) : (
                <p>Data-quality evidence is limited to data-quality managers.</p>
              )}
            </Surface>

            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Human-reviewed enrichment" title="Enrichment review queue" />
              {canManageDataQuality ? (
                <div className="crm-suite-list">
                  {enrichmentReviews.map((row) => {
                    const reviewKey = String(row.id);
                    const proposed = objectValue(row.proposed_changes);
                    const proposedKeys = Object.keys(proposed);
                    const selectedKeys = enrichmentSelections[reviewKey] ?? proposedKeys;
                    return (
                      <article key={reviewKey}>
                        <div>
                          <strong>{String(row.provider || "Enrichment")} · {nice(row.status)}</strong>
                          <small>Confidence {scoreText(row.confidence)} · {dateTime(row.created_at)}</small>
                          {String(row.status) === "pending" && proposedKeys.length ? (
                            <div className="crm-tag-picker">
                              {proposedKeys.map((key) => (
                                <label key={key} className={selectedKeys.includes(key) ? "selected" : ""}>
                                  <input
                                    type="checkbox"
                                    checked={selectedKeys.includes(key)}
                                    onChange={(event) => {
                                      const next = event.currentTarget.checked
                                        ? [...new Set([...selectedKeys, key])]
                                        : selectedKeys.filter((item) => item !== key);
                                      setEnrichmentSelections((current) => ({ ...current, [reviewKey]: next }));
                                    }}
                                  />
                                  <span>{nice(key)}: {jsonText(proposed[key])}</span>
                                </label>
                              ))}
                            </div>
                          ) : (
                            <p>Proposed: {jsonText(row.proposed_changes)}</p>
                          )}
                          {row.accepted_changes && Object.keys(objectValue(row.accepted_changes)).length ? <small>Accepted: {jsonText(row.accepted_changes)}</small> : null}
                          {row.rejected_changes && Object.keys(objectValue(row.rejected_changes)).length ? <small>Rejected: {jsonText(row.rejected_changes)}</small> : null}
                        </div>
                        {String(row.status) === "pending" ? (
                          <div className="crm-inline-actions">
                            <ActionButton
                              tone="quiet"
                              disabled={!selectedKeys.length}
                              busy={pending === `enrichment-${reviewKey}`}
                              type="button"
                              onClick={() => void reviewEnrichment(reviewKey, { acceptedKeys: selectedKeys })}
                            >
                              Apply selected
                            </ActionButton>
                            <ActionButton
                              tone="danger"
                              busy={pending === `enrichment-${reviewKey}`}
                              type="button"
                              onClick={() => void reviewEnrichment(reviewKey, { decision: "rejected" })}
                            >
                              Reject all
                            </ActionButton>
                          </div>
                        ) : null}
                      </article>
                    );
                  })}
                  {!enrichmentReviews.length ? <p>No enrichment reviews for this Lead.</p> : null}
                </div>
              ) : (
                <p>Enrichment reviews are limited to data-quality managers.</p>
              )}
            </Surface>

            <Surface as="section" className="crm-suite-surface">
              <SectionHeader
                eyebrow="Explainable intelligence"
                title="Score explanation and AI predictions"
                actions={
                  canManage ? (
                    <ActionButton
                      busy={pending === "score"}
                      type="button"
                      onClick={() => void api(`/api/crm/leads/${id}/score`, { reason: "Lead 360 governance recalculation" }, "score")}
                    >
                      Recalculate score
                    </ActionButton>
                  ) : null
                }
              />
              <dl className="crm-lead-profile-grid">
                <div><dt>Current score</dt><dd>{String(lead.score || 0)}</dd></div>
                <div><dt>Grade</dt><dd>{nice(lead.leadGrade || lead.rating || "ungraded")}</dd></div>
                <div><dt>Calculated</dt><dd>{dateTime(lead.scoreCalculatedAt)}</dd></div>
                <div><dt>Model</dt><dd>{String(scoreModel.name || scoreModel.id || scoreExplanation.modelId || "Deterministic rules")}</dd></div>
                <div><dt>Version</dt><dd>{String(scoreModel.version || scoreExplanation.version || "—")}</dd></div>
                <div><dt>Uncertainty</dt><dd>{String(scoreExplanation.uncertainty || "—")}</dd></div>
              </dl>
              {scoreContributions.length ? (
                <div className="crm-suite-list">
                  {scoreContributions.slice(0, 12).map((item, index) => {
                    const row = objectValue(item);
                    return (
                      <article key={`${String(row.key || row.factor || "factor")}-${index}`}>
                        <div><strong>{nice(row.label || row.key || row.factor || "Score factor")}</strong><small>{String(row.reason || row.source || "Rule contribution")}</small></div>
                        <span>{String(row.points ?? row.weight ?? row.value ?? "—")}</span>
                      </article>
                    );
                  })}
                </div>
              ) : <p>No detailed deterministic contribution breakdown is available yet.</p>}
              {aiPredictions.length ? (
                <>
                  <h3 className="crm-suite-subheading">AI predictions</h3>
                  <div className="crm-suite-list">
                    {aiPredictions.map((row) => (
                      <article key={String(row.id)}>
                        <div>
                          <strong>{nice(row.prediction_type)} · {String(row.label || "Unlabelled")}</strong>
                          <small>{String(row.model_provider || "model")} / {String(row.model_name || "unknown")} / {String(row.model_version || "unversioned")} · {dateTime(row.generated_at)}</small>
                          <p>{jsonText(row.explanation)}</p>
                        </div>
                        <span>{row.score === null || row.score === undefined ? nice(row.status) : scoreText(Number(row.score) <= 1 ? Number(row.score) * 100 : row.score)}</span>
                      </article>
                    ))}
                  </div>
                </>
              ) : null}
            </Surface>
          </div>
        ) : null}

        {tab === "timeline" ? (
          <Surface as="section" className="crm-suite-surface">
            <h2>Complete lead timeline</h2>
            <div className="crm-lead-timeline">
              {timeline.map((event, index) => (
                <article
                  key={`${String(event.__kind)}-${String(event.id)}-${index}`}
                >
                  <span>{String(event.__kind).slice(0, 1)}</span>
                  <div>
                    <strong>{String(event.__title || event.__kind)}</strong>
                    <small>
                      {String(event.__kind)} · {dateTime(event.__date)}
                    </small>
                    <p>
                      {String(
                        event.description ||
                          event.body ||
                          event.outcome ||
                          event.status ||
                          "",
                      )}
                    </p>
                  </div>
                </article>
              ))}
              {!timeline.length ? (
                <StatePanel title="No timeline events yet." />
              ) : null}
              {activitiesHasMore || communicationsHasMore ? (
                <ActionButton
                  type="button"
                  busy={loadingActivities || loadingCommunications}
                  onClick={() => {
                    if (activitiesHasMore) void loadOlderTimelineItems("activities");
                    if (communicationsHasMore) void loadOlderTimelineItems("communications");
                  }}
                >
                  {loadingActivities || loadingCommunications
                    ? "Loading…"
                    : "Load older timeline events"}
                </ActionButton>
              ) : null}
            </div>
          </Surface>
        ) : null}

        {tab === "activities" ? (
          <div className="crm-suite-two-column">
            <Surface as="section" className="crm-suite-surface">
              <h2>Activity history</h2>
              <div className="crm-suite-list">
                {activityRows.map((row) => (
                  <article key={String(row.id)}>
                    <div>
                      <strong>{String(row.subject)}</strong>
                      <small>
                        {nice(row.activity_type || row.activityType)} ·{" "}
                        {String(row.assigned_name || "Unassigned")} ·{" "}
                        {dateTime(row.due_at || row.dueAt)}
                      </small>
                      {row.description ? (
                        <p>{String(row.description)}</p>
                      ) : null}
                    </div>
                    <span>{nice(row.status)}</span>
                  </article>
                ))}
                {!activityRows.length ? <p>No activities yet.</p> : null}
                {activitiesHasMore ? (
                  <ActionButton
                    type="button"
                    busy={loadingActivities}
                    onClick={() => void loadOlderTimelineItems("activities")}
                  >
                    {loadingActivities ? "Loading…" : "Load older activities"}
                  </ActionButton>
                ) : null}
              </div>
            </Surface>
            <Surface as="section" className="crm-suite-surface">
              <h2>Plan next action</h2>
              {canManageActivities ? (
                <form
                  id="crm-lead-follow-up-form"
                  className="crm-suite-form"
                  onSubmit={scheduleFollowUp}
                >
                  <FormField label="Type" htmlFor="lead-followup-type">
                    <select id="lead-followup-type" name="activityType" defaultValue="call">
                      <option value="task">Task</option>
                      <option value="call">Call</option>
                      <option value="meeting">Meeting</option>
                      <option value="email">Email follow-up</option>
                      <option value="whatsapp">WhatsApp follow-up log</option>
                      <option value="sms">SMS follow-up log</option>
                    </select>
                  </FormField>
                  <FormField label="Subject" htmlFor="lead-followup-subject" required>
                    <input
                      id="lead-followup-subject"
                      name="subject"
                      required
                      placeholder="Discovery call"
                    />
                  </FormField>
                  <FormField label="Description" htmlFor="lead-followup-description">
                    <textarea id="lead-followup-description" name="description" rows={3} />
                  </FormField>
                  <FormField label="Owner" htmlFor="lead-followup-assignee">
                    <select
                      id="lead-followup-assignee"
                      name="assignedTo"
                      defaultValue={String(lead.ownerUserId || "")}
                    >
                      <option value="">Unassigned</option>
                      {options.users?.map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name}
                        </option>
                      ))}
                    </select>
                  </FormField>
                  <FormField label="Priority" htmlFor="lead-followup-priority">
                    <select id="lead-followup-priority" name="priority" defaultValue="medium">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </FormField>
                  <FormField label="Due" htmlFor="lead-followup-due" required>
                    <input id="lead-followup-due" name="dueAt" type="datetime-local" required />
                  </FormField>
                  <ActionButton
                    type="submit"
                    tone="primary"
                    busy={pending === "followup"}
                  >
                    {pending === "followup" ? "Scheduling…" : "Add follow-up"}
                  </ActionButton>
                </form>
              ) : (
                <p>You do not have permission to create CRM activities.</p>
              )}
            </Surface>
          </div>
        ) : null}

        {tab === "communications" ? (
          <div className="crm-suite-two-column wide">
            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Email & communication history" title="Email, call, SMS, chat and WhatsApp log" />
              <div className="crm-suite-list">
                {communicationRows.map((row) => (
                  <article key={String(row.id)}>
                    <div>
                      <strong>
                        {String(row.subject || nice(row.channel))}
                      </strong>
                      <small>
                        {nice(row.direction)} · {nice(row.channel)} ·{" "}
                        {String(row.provider || "manual")} ·{" "}
                        {dateTime(row.occurred_at)}
                      </small>
                      <p>{String(row.body || "")}</p>
                    </div>
                    <span>{nice(row.status)}</span>
                  </article>
                ))}
                {!communicationRows.length ? (
                  <p>No communication history yet.</p>
                ) : null}
                {communicationsHasMore ? (
                  <ActionButton
                    type="button"
                    busy={loadingCommunications}
                    onClick={() => void loadOlderTimelineItems("communications")}
                  >
                    {loadingCommunications ? "Loading…" : "Load older communications"}
                  </ActionButton>
                ) : null}
              </div>
            </Surface>
            <aside className="crm-suite-surface">
              <h2>Log communication</h2>
              {canManageCommunications ? (
                <form className="crm-suite-form" onSubmit={createCommunication}>
                  <FormField label="Channel" htmlFor="lead-comm-channel">
                    <select id="lead-comm-channel" name="channel" defaultValue="call">
                      <option value="email">Email</option>
                      <option value="call">Call</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="sms">SMS</option>
                      <option value="chat">Chat</option>
                      <option value="other">Other</option>
                    </select>
                  </FormField>
                  <FormField label="Direction" htmlFor="lead-comm-direction">
                    <select id="lead-comm-direction" name="direction" defaultValue="outbound">
                      <option value="outbound">Outbound</option>
                      <option value="inbound">Inbound</option>
                    </select>
                  </FormField>
                  <FormField label="Subject" htmlFor="lead-comm-subject">
                    <input id="lead-comm-subject" name="subject" />
                  </FormField>
                  <FormField label="Message / notes" htmlFor="lead-comm-body" required>
                    <textarea id="lead-comm-body" name="body" required rows={5} />
                  </FormField>
                  <FormField label="From" htmlFor="lead-comm-from">
                    <input id="lead-comm-from" name="fromAddress" />
                  </FormField>
                  <FormField label="Occurred" htmlFor="lead-comm-occurred-at">
                    <input id="lead-comm-occurred-at" name="occurredAt" type="datetime-local" />
                  </FormField>
                  <FormField label="Status" htmlFor="lead-comm-status">
                    <select id="lead-comm-status" name="status" defaultValue="logged">
                      <option value="logged">Logged</option>
                      <option value="received">Received</option>
                      <option value="sent">Sent</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  </FormField>
                  <ActionButton
                    type="submit"
                    tone="primary"
                    busy={pending === "communication"}
                  >
                    Log communication
                  </ActionButton>
                </form>
              ) : (
                <p>You do not have communication-management permission.</p>
              )}
            </aside>
          </div>
        ) : null}

        {tab === "notes" ? (
          <div className="crm-suite-two-column">
            <Surface as="section" className="crm-suite-surface">
              <h2>Internal notes</h2>
              <div className="crm-suite-list">
                {notes.map((row) => (
                  <article key={String(row.id)}>
                    <div>
                      <strong>
                        {row.is_pinned ? "Pinned note" : "Note"}
                        {row.visibility === "private" ? " · Private" : ""}
                      </strong>
                      <p>{String(row.body)}</p>
                      <small>
                        {String(row.author_name || "Team member")} ·{" "}
                        {dateTime(row.created_at)}
                      </small>
                    </div>
                  </article>
                ))}
                {!notes.length ? <p>No notes yet.</p> : null}
              </div>
            </Surface>
            <Surface as="section" className="crm-suite-surface">
              <h2>Add note</h2>
              {canManage ? (
                <form className="crm-suite-form" onSubmit={createNote}>
                  <FormField label="Note" htmlFor="lead-note-body" required>
                    <textarea id="lead-note-body" name="body" required rows={6} />
                  </FormField>
                  <label className="crm-suite-check">
                    <input name="isPinned" type="checkbox" />
                    <span>Pin this note</span>
                  </label>
                  <label className="crm-suite-check">
                    <input name="visibility" type="checkbox" value="private" />
                    <span>Private — visible only to me and managers</span>
                  </label>
                  <ActionButton
                    type="submit"
                    tone="primary"
                    busy={pending === "note"}
                  >
                    Add note
                  </ActionButton>
                </form>
              ) : null}
              <div className="crm-file-divider" />
              <h2>Attachments</h2>
              <div className="crm-attachment-list">
                {attachments.map((attachment) => {
                  const logicalId = String(
                    attachment.logical_id || attachment.logicalId || attachment.id,
                  );
                  const version = Number(attachment.version || 1);
                  const versions = attachmentVersions[logicalId];
                  return (
                    <div key={String(attachment.id)}>
                      <span>
                        <a
                          href={`/api/crm/leads/${id}/attachments/${String(attachment.id)}`}
                        >
                          {String(attachment.file_name || "Attachment")}
                        </a>
                        <small>
                          {String(attachment.mime_type || "file")} ·{" "}
                          {Math.max(
                            1,
                            Math.round(num(attachment.size_bytes) / 1024),
                          )}{" "}
                          KB{version > 1 ? ` · v${version}` : ""}
                        </small>
                      </span>
                      {canManage ? (
                        <ActionButton
                          tone="danger"
                          type="button"
                          busy={
                            pending === `attachment-${String(attachment.id)}`
                          }
                          onClick={() =>
                            void removeAttachment(String(attachment.id))
                          }
                        >
                          Remove
                        </ActionButton>
                      ) : null}
                      <ActionButton
                        tone="quiet"
                        type="button"
                        onClick={() => void toggleAttachmentVersions(logicalId)}
                      >
                        {versions !== undefined ? "Hide versions" : "Version history"}
                      </ActionButton>
                      {canManage ? (
                        <label>
                          {pending === `attachment-replace-${logicalId}`
                            ? "Uploading replacement…"
                            : "Replace file"}
                          <input
                            type="file"
                            className={kernelStyles.visuallyHidden}
                            disabled={pending === `attachment-replace-${logicalId}`}
                            onChange={(event) => {
                              const file = event.target.files?.[0];
                              event.target.value = "";
                              if (file) void replaceAttachment(logicalId, file);
                            }}
                          />
                        </label>
                      ) : null}
                      {versions ? (
                        <div className="crm-attachment-list">
                          {versions.map((entry) => (
                            <div key={String(entry.id)}>
                              <span>
                                {String(entry.lifecycle_status || entry.lifecycleStatus) === "clean" ? (
                                  <a href={`/api/crm/leads/${id}/attachments/${String(entry.id)}`}>
                                    v{String(entry.version)}
                                    {(entry.is_current || entry.isCurrent) ? " (current)" : ""} — {String(entry.file_name || entry.fileName)}
                                  </a>
                                ) : (
                                  <span>
                                    v{String(entry.version)} — {String(entry.file_name || entry.fileName)}
                                  </span>
                                )}
                              </span>
                            </div>
                          ))}
                          {!versions.length ? <p>No version history available.</p> : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
                {!attachments.length ? <p>No files attached yet.</p> : null}
              </div>
              {canManage ? (
                <form
                  className="crm-suite-form crm-attachment-form"
                  onSubmit={uploadAttachment}
                >
                  <FormField
                    label="Attach file"
                    htmlFor="lead-attachment-file"
                    hint="PDF, PNG, JPEG, TXT or CSV · up to 5 MB."
                    required
                  >
                    <input
                      id="lead-attachment-file"
                      name="file"
                      type="file"
                      required
                      accept="application/pdf,image/png,image/jpeg,text/plain,text/csv"
                    />
                  </FormField>
                  <ActionButton type="submit" busy={pending === "attachment"}>
                    {pending === "attachment" ? "Uploading…" : "Upload file"}
                  </ActionButton>
                </form>
              ) : null}
            </Surface>
          </div>
        ) : null}

        {tab === "opportunities" ? (
          <Surface as="section" className="crm-suite-surface">
            <SectionHeader
              eyebrow="Conversion path"
              title="Opportunities created from this lead"
              actions={
                canManage && recordStatus === "active" ? (
                  <ActionButton
                    tone="primary"
                    busy={pending === "convert"}
                    onClick={() => void convert()}
                  >
                    {pending === "convert"
                      ? "Converting…"
                      : "Convert to opportunity"}
                  </ActionButton>
                ) : null
              }
            />
            <div className="crm-suite-list">
              {opportunities.map((row) => (
                <article key={String(row.id)}>
                  <div>
                    <Link href={`/crm/opportunities/${String(row.id)}`}>
                      <strong>{String(row.name)}</strong>
                    </Link>
                    <small>
                      {String(row.code || "")} · {nice(row.status)}
                    </small>
                  </div>
                  <span>
                    {String(row.amount || 0)}{" "}
                    {String(row.currency_code || lead.currencyCode || "INR")}
                  </span>
                </article>
              ))}
              {!opportunities.length ? (
                <p>No linked opportunities yet.</p>
              ) : null}
            </div>
          </Surface>
        ) : null}

        {tab === "score" ? (
          <Surface as="section" className="crm-suite-surface">
            <SectionHeader
              eyebrow="Scoring history"
              title="Explainable score changes"
              actions={
                canManage ? (
                  <ActionButton
                    busy={pending === "score"}
                    onClick={() =>
                      void api(
                        `/api/crm/leads/${id}/score`,
                        { reason: "Lead detail recalculation" },
                        "score",
                      )
                    }
                  >
                    Recalculate
                  </ActionButton>
                ) : null
              }
            />
            <div className="crm-lead-score-history">
              {scoreHistory.map((row) => (
                <article key={String(row.id)}>
                  <div>
                    <strong>{String(row.reason)}</strong>
                    <small>{dateTime(row.created_at)}</small>
                  </div>
                  <span>
                    {String(row.previous_score)} →{" "}
                    <b>{String(row.new_score)}</b>
                  </span>
                </article>
              ))}
              {!scoreHistory.length ? <p>No score changes recorded.</p> : null}
            </div>
          </Surface>
        ) : null}

        {tab === "custom" ? (
          <div className="crm-suite-two-column">
            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Classification" title="Tags" />
              <div className="crm-tag-picker">
                {(options.tags || []).map((tag) => {
                  const checked = tagIds.has(tag.id);
                  return (
                    <label key={tag.id} className={checked ? "selected" : ""}>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canManage}
                        onChange={(event) => {
                          const next = new Set(tagIds);
                          if (event.currentTarget.checked) next.add(tag.id);
                          else next.delete(tag.id);
                          setTagIds(next);
                        }}
                      />
                      <span>{tag.name}</span>
                    </label>
                  );
                })}
                {!options.tags?.length ? (
                  <p>Create tags in CRM Setup, then apply them here.</p>
                ) : null}
              </div>
              {canManage ? (
                <ActionButton
                  type="button"
                  busy={pending === "tags"}
                  onClick={() => void saveTags()}
                >
                  Save tags
                </ActionButton>
              ) : null}
            </Surface>
            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Flexible data" title="Custom fields" />
              <p className="crm-helper-copy">
                Use short snake_case keys so fields remain stable across exports
                and APIs.
              </p>
              <div className="crm-custom-field-editor">
                {customRows.map((row, index) => (
                  <div key={row.id}>
                    <FormField label="Field key" htmlFor={`custom-field-key-${row.id}`}>
                      <input
                        id={`custom-field-key-${row.id}`}
                        value={row.key}
                        disabled={!canManage}
                        placeholder="implementation_timeline"
                        onChange={(event) =>
                          setCustomRows((rows) =>
                            rows.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, key: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </FormField>
                    <FormField label="Value" htmlFor={`custom-field-value-${row.id}`}>
                      <input
                        id={`custom-field-value-${row.id}`}
                        value={row.value}
                        disabled={!canManage}
                        placeholder="Q4 2026"
                        onChange={(event) =>
                          setCustomRows((rows) =>
                            rows.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, value: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </FormField>
                    {canManage ? (
                      <ActionButton
                        tone="danger"
                        type="button"
                        onClick={() =>
                          setCustomRows((rows) =>
                            rows.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        Remove
                      </ActionButton>
                    ) : null}
                  </div>
                ))}
                {!customRows.length ? (
                  <p>No custom fields on this lead.</p>
                ) : null}
              </div>
              {canManage ? (
                <div className="crm-inline-actions">
                  <ActionButton
                    type="button"
                    onClick={() =>
                      setCustomRows((rows) => [
                        ...rows,
                        {
                          id: `${Date.now()}-${rows.length}`,
                          key: "",
                          value: "",
                        },
                      ])
                    }
                  >
                    Add field
                  </ActionButton>
                  <ActionButton
                    tone="primary"
                    type="button"
                    busy={pending === "custom"}
                    onClick={() => void saveCustomFields()}
                  >
                    Save custom fields
                  </ActionButton>
                </div>
              ) : null}
            </Surface>
          </div>
        ) : null}

        {tab === "duplicates" ? (
          <Surface as="section" className="crm-suite-surface">
            <SectionHeader eyebrow="Duplicate management" title="Potential matching leads" />
            <div className="crm-duplicate-compare">
              {duplicates.map((row, index) => {
                const restricted = Boolean(row.restricted);
                const id = restricted ? "" : String(row.id || "");
                const signals = Array.isArray(row.signals)
                  ? row.signals.map(String).join(", ")
                  : "";
                return (
                  <article key={id || `restricted-duplicate-${index}`}>
                    <div>
                      <strong>
                        {restricted
                          ? "Existing Lead (restricted)"
                          : String(
                              row.name ||
                                row.fullName ||
                                row.full_name ||
                                row.code ||
                                "Existing Lead",
                            )}
                      </strong>
                      <small>
                        {restricted
                          ? "A matching Lead exists outside your current record access. Private details are not disclosed."
                          : `${String(
                              row.company ||
                                row.companyName ||
                                row.company_name ||
                                "No company",
                            )} · ${String(
                              row.recordStatus ||
                                row.lifecycleStage ||
                                row.status ||
                                "existing",
                            )}`}
                      </small>
                      <span>
                        {String(row.classification || "probable").replace(
                          /^./,
                          (character) => character.toUpperCase(),
                        )}
                        {signals
                          ? ` · matched on ${signals.replaceAll("_", " ")}`
                          : ""}
                      </span>
                    </div>
                    {id ? <Link href={`/crm/leads/${id}`}>Open</Link> : null}
                    {canManage && id ? (
                      <ActionButton
                        tone="danger"
                        busy={pending === "merge"}
                        onClick={() => void merge(id)}
                      >
                        Merge current into this
                      </ActionButton>
                    ) : null}
                    {canManageDataQuality && id && row.classification !== "exact" ? (
                      <ActionButton
                        tone="quiet"
                        busy={pending === "dismiss"}
                        onClick={() => void dismissDuplicate(id)}
                      >
                        Not a duplicate
                      </ActionButton>
                    ) : null}
                  </article>
                );
              })}
              {!duplicates.length ? (
                <StatePanel title="No likely duplicate found." />
              ) : null}
            </div>
          </Surface>
        ) : null}
      </div>
    </Record360Archetype>
  );
}
