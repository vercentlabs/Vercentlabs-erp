"use client";

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import LeadAssigneeCombobox, {
  type LeadAssigneeOption,
} from "./lead-assignee-combobox";
import LeadQualificationCard from "./lead-qualification-card";

type Row = Record<string, unknown>;
type Option = {
  id: string;
  name: string;
  status?: string;
  code?: string;
  sortOrder?: number;
  allowedFromCodes?: string[];
};
type TimelineEvent = Row & {
  __kind: string;
  __date: unknown;
  __title: unknown;
};
function num(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}
function nice(value: unknown) {
  return String(value ?? "—")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}
function assignmentReason(event: Row) {
  if (event.policy_name) return `Automatic rule: ${String(event.policy_name)}`;
  const reason = String(event.reason || "manual");
  if (reason.startsWith("capture-form:")) return "Capture form assignment";
  if (reason.startsWith("policy:")) return "Automatic assignment rule";
  if (reason.startsWith("manual:")) return "Manual assignment";
  return "Assignment update";
}
function LeadOwnerDialog({
  lead,
  onClose,
}: {
  lead: Row;
  onClose: () => void;
}) {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  const [selected, setSelected] = useState<LeadAssigneeOption | null>(
    lead.ownerUserId && lead.ownerStatus === "active"
      ? {
          id: String(lead.ownerUserId),
          name: String(lead.ownerName || "Current owner"),
          email: String(lead.ownerEmail || ""),
        }
      : null,
  );
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (!dialog.open) dialog.showModal();
    const close = () => onCloseRef.current();
    dialog.addEventListener("close", close);
    return () => dialog.removeEventListener("close", close);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || pending) return;
    setPending(true);
    setMessage("");
    try {
      const result = await requestJson<Row>(
        `/api/crm/leads/${String(lead.id)}/assign`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ownerUserId: selected.id }),
        },
      );
      if (!result.ok)
        throw new Error(
          String(result.message || "Lead owner could not be changed."),
        );
      dialogRef.current?.close();
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Lead owner could not be changed.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <dialog
      className="crm-owner-dialog"
      ref={dialogRef}
      aria-labelledby="change-owner-title"
    >
      <form onSubmit={submit}>
        <header>
          <div>
            <p className="eyebrow">Lead ownership</p>
            <h2 id="change-owner-title">Change owner</h2>
          </div>
          <button
            aria-label="Close Change owner"
            className="icon-button"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            ×
          </button>
        </header>
        <div className="crm-owner-dialog__body">
          <div className="crm-owner-dialog__current">
            <span>Current owner</span>
            <strong>{String(lead.ownerName || "Unassigned")}</strong>
            {lead.ownerStatus === "inactive" ? (
              <small>Inactive organization member</small>
            ) : null}
          </div>
          <label>
            <span>New owner</span>
            <LeadAssigneeCombobox value={selected} onChange={setSelected} />
            <small>
              Only active CRM members with access to this company and branch are
              shown.
            </small>
          </label>
          {message ? (
            <p className="field-error" role="alert">
              {message}
            </p>
          ) : null}
        </div>
        <footer>
          <button
            className="secondary-button"
            disabled={pending}
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            Cancel
          </button>
          <button
            className="primary-button"
            disabled={!selected || pending}
            type="submit"
          >
            {pending ? "Assigning…" : "Assign owner"}
          </button>
        </footer>
      </form>
    </dialog>
  );
}

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
  canManage,
  canAssignOwner,
  canManageActivities,
  canManageCommunications,
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
  canManage: boolean;
  canAssignOwner: boolean;
  canManageActivities: boolean;
  canManageCommunications: boolean;
  embedded?: boolean;
  onEdit?: (lead: Row) => void;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [changingOwner, setChangingOwner] = useState(false);
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
  const id = String(lead.id);
  const leadSource = options.allSources?.find(
    (item) => item.id === String(lead.sourceId),
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
        ...activities.map((row) => ({
          ...row,
          __kind: "Activity",
          __date: row.completed_at || row.due_at || row.created_at,
          __title: row.subject,
        })),
        ...communications.map((row) => ({
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
      ].sort(
        (a, b) =>
          new Date(String(b.__date || 0)).getTime() -
          new Date(String(a.__date || 0)).getTime(),
      ),
    [activities, communications, notes, opportunities, lifecycleHistory],
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
      if (!result.ok) throw new Error(result.message || "Request failed.");
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
  async function moveStatus(nextStatus: string) {
    await api(
      `/api/crm/leads/${id}/stage`,
      { stageCode: nextStatus, source: "manual" },
      "status",
    );
  }
  async function archiveLead() {
    if (
      !confirm(
        `Archive ${name}?\n\nThis removes the lead from active workspaces. Historical information is preserved.`,
      )
    )
      return;
    setPending("archive");
    setMessage("");
    try {
      const result = await requestJson<Row>(`/api/crm/leads/${id}`, {
        method: "DELETE",
      });
      if (!result.ok)
        throw new Error(result.message || "Lead could not be archived.");
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
    if (!confirm("Convert this lead into an account, contact and opportunity?"))
      return;
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
    if (
      !confirm(
        "Merge this lead into the selected duplicate? The current lead will be archived.",
      )
    )
      return;
    const result = await api(
      `/api/crm/leads/${id}/merge`,
      { targetLeadId: target },
      "merge",
    );
    if (result?.ok) router.push(`/crm/leads/${target}`);
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
      },
      "note",
    );
    if (result) event.currentTarget.reset();
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
    if (!confirm("Remove this attachment?")) return;
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
  const tabs = [
    "overview",
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

  return (
    <div
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
            {!contact ? <span>No contact details</span> : null}
          </div>
        </div>
        <div className="crm-lead-detail-right">
          <div className="crm-lead-detail-badges">
            <span>
              {currentStage?.name || nice(lead.status)}
              {currentStage?.status === "inactive" ? " · Inactive" : ""}
            </span>
            <span>
              Score {String(lead.score || 0)} ·{" "}
              {nice(lead.leadGrade || lead.rating || "ungraded")}
            </span>
          </div>
          {canManage &&
          recordStatus === "active" ? (
            <div className="crm-lead-detail-actions">
              {onEdit ? (
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => onEdit(lead)}
                >
                  Edit lead
                </button>
              ) : (
                <Link
                  className="secondary-button"
                  href={`/crm/leads?edit=${encodeURIComponent(id)}`}
                >
                  Edit lead
                </Link>
              )}
              <button
                className="secondary-button danger"
                disabled={pending === "archive"}
                onClick={() => void archiveLead()}
              >
                {pending === "archive" ? "Archiving…" : "Archive lead"}
              </button>
            </div>
          ) : null}
        </div>
      </header>
      <section className="crm-lead-detail-facts">
        <div>
          <small>Owner</small>
          <strong>{String(lead.ownerName || "Unassigned")}</strong>
          {lead.ownerStatus === "inactive" ? (
            <span className="status-badge neutral">Inactive</span>
          ) : null}
          {canAssignOwner &&
          recordStatus === "active" ? (
            <button
              className="link-button"
              onClick={() => setChangingOwner(true)}
              type="button"
            >
              Change owner
            </button>
          ) : null}
        </div>
        <div>
          <small>Source</small>
          <strong>{leadSource?.name || "Not specified"}</strong>
          {leadSource?.status === "inactive" ? (
            <span className="status-badge neutral">Inactive</span>
          ) : null}
        </div>
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
            <section className="crm-suite-surface">
              <div className="crm-suite-section-heading">
                <div>
                  <p className="eyebrow">Lead profile</p>
                  <h2>Qualification context</h2>
                </div>
              </div>
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
            </section>
            <aside className="crm-suite-surface">
              <h2>Relationship summary</h2>
              <div className="crm-lead-relationship-counts">
                <button type="button" onClick={() => setTab("activities")}>
                  <strong>{activities.length}</strong>
                  <span>Activities</span>
                </button>
                <button type="button" onClick={() => setTab("communications")}>
                  <strong>{communications.length}</strong>
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
                <button
                  className="secondary-button full"
                  type="button"
                  onClick={() => setTab("activities")}
                >
                  Add follow-up
                </button>
              ) : null}
              {canManage ? (
                <button
                  className="secondary-button full"
                  type="button"
                  onClick={() => setTab("notes")}
                >
                  Add internal note
                </button>
              ) : null}
              {canManage ? (
                <button
                  className="secondary-button full"
                  type="button"
                  disabled={pending === "score"}
                  onClick={() =>
                    void api(
                      `/api/crm/leads/${id}/score`,
                      { reason: "Lead detail recalculation" },
                      "score",
                    )
                  }
                >
                  Recalculate score
                </button>
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

        {tab === "timeline" ? (
          <section className="crm-suite-surface">
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
                <div className="crm-suite-empty">
                  <strong>No timeline events yet.</strong>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}

        {tab === "activities" ? (
          <div className="crm-suite-two-column">
            <section className="crm-suite-surface">
              <h2>Activity history</h2>
              <div className="crm-suite-list">
                {activities.map((row) => (
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
                {!activities.length ? <p>No activities yet.</p> : null}
              </div>
            </section>
            <section className="crm-suite-surface">
              <h2>Plan next action</h2>
              {canManageActivities ? (
                <form
                  id="crm-lead-follow-up-form"
                  className="crm-suite-form"
                  onSubmit={scheduleFollowUp}
                >
                  <label>
                    Type
                    <select name="activityType" defaultValue="call">
                      <option value="task">Task</option>
                      <option value="call">Call</option>
                      <option value="meeting">Meeting</option>
                      <option value="email">Email follow-up</option>
                      <option value="whatsapp">WhatsApp follow-up log</option>
                      <option value="sms">SMS follow-up log</option>
                    </select>
                  </label>
                  <label>
                    Subject
                    <input
                      name="subject"
                      required
                      placeholder="Discovery call"
                    />
                  </label>
                  <label>
                    Description
                    <textarea name="description" rows={3} />
                  </label>
                  <label>
                    Owner
                    <select
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
                  </label>
                  <label>
                    Priority
                    <select name="priority" defaultValue="medium">
                      <option value="low">Low</option>
                      <option value="medium">Medium</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </label>
                  <label>
                    Due
                    <input name="dueAt" type="datetime-local" required />
                  </label>
                  <button
                    className="primary-button"
                    disabled={pending === "followup"}
                  >
                    {pending === "followup" ? "Scheduling…" : "Add follow-up"}
                  </button>
                </form>
              ) : (
                <p>You do not have permission to create CRM activities.</p>
              )}
            </section>
          </div>
        ) : null}

        {tab === "communications" ? (
          <div className="crm-suite-two-column wide">
            <section className="crm-suite-surface">
              <div className="crm-suite-section-heading">
                <div>
                  <p className="eyebrow">Email & communication history</p>
                  <h2>Email, call, SMS, chat and WhatsApp log</h2>
                </div>
              </div>
              <div className="crm-suite-list">
                {communications.map((row) => (
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
                {!communications.length ? (
                  <p>No communication history yet.</p>
                ) : null}
              </div>
            </section>
            <aside className="crm-suite-surface">
              <h2>Log communication</h2>
              {canManageCommunications ? (
                <form className="crm-suite-form" onSubmit={createCommunication}>
                  <label>
                    Channel
                    <select name="channel" defaultValue="call">
                      <option value="email">Email</option>
                      <option value="call">Call</option>
                      <option value="whatsapp">WhatsApp</option>
                      <option value="sms">SMS</option>
                      <option value="chat">Chat</option>
                      <option value="other">Other</option>
                    </select>
                  </label>
                  <label>
                    Direction
                    <select name="direction" defaultValue="outbound">
                      <option value="outbound">Outbound</option>
                      <option value="inbound">Inbound</option>
                    </select>
                  </label>
                  <label>
                    Subject
                    <input name="subject" />
                  </label>
                  <label>
                    Message / notes
                    <textarea name="body" required rows={5} />
                  </label>
                  <label>
                    From
                    <input name="fromAddress" />
                  </label>
                  <label>
                    Occurred
                    <input name="occurredAt" type="datetime-local" />
                  </label>
                  <label>
                    Status
                    <select name="status" defaultValue="logged">
                      <option value="logged">Logged</option>
                      <option value="received">Received</option>
                      <option value="sent">Sent</option>
                      <option value="delivered">Delivered</option>
                    </select>
                  </label>
                  <button
                    className="primary-button"
                    disabled={pending === "communication"}
                  >
                    Log communication
                  </button>
                </form>
              ) : (
                <p>You do not have communication-management permission.</p>
              )}
            </aside>
          </div>
        ) : null}

        {tab === "notes" ? (
          <div className="crm-suite-two-column">
            <section className="crm-suite-surface">
              <h2>Internal notes</h2>
              <div className="crm-suite-list">
                {notes.map((row) => (
                  <article key={String(row.id)}>
                    <div>
                      <strong>{row.is_pinned ? "Pinned note" : "Note"}</strong>
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
            </section>
            <section className="crm-suite-surface">
              <h2>Add note</h2>
              {canManage ? (
                <form className="crm-suite-form" onSubmit={createNote}>
                  <label>
                    Note
                    <textarea name="body" required rows={6} />
                  </label>
                  <label className="crm-suite-check">
                    <input name="isPinned" type="checkbox" />
                    <span>Pin this note</span>
                  </label>
                  <button
                    className="primary-button"
                    disabled={pending === "note"}
                  >
                    Add note
                  </button>
                </form>
              ) : null}
              <div className="crm-file-divider" />
              <h2>Attachments</h2>
              <div className="crm-attachment-list">
                {attachments.map((attachment) => (
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
                        KB
                      </small>
                    </span>
                    {canManage ? (
                      <button
                        type="button"
                        className="link-button danger"
                        disabled={
                          pending === `attachment-${String(attachment.id)}`
                        }
                        onClick={() =>
                          void removeAttachment(String(attachment.id))
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                {!attachments.length ? <p>No files attached yet.</p> : null}
              </div>
              {canManage ? (
                <form
                  className="crm-suite-form crm-attachment-form"
                  onSubmit={uploadAttachment}
                >
                  <label>
                    Attach file
                    <input
                      name="file"
                      type="file"
                      required
                      accept="application/pdf,image/png,image/jpeg,text/plain,text/csv"
                    />
                    <small>PDF, PNG, JPEG, TXT or CSV · up to 5 MB.</small>
                  </label>
                  <button
                    className="secondary-button"
                    disabled={pending === "attachment"}
                  >
                    {pending === "attachment" ? "Uploading…" : "Upload file"}
                  </button>
                </form>
              ) : null}
            </section>
          </div>
        ) : null}

        {tab === "opportunities" ? (
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Conversion path</p>
                <h2>Opportunities created from this lead</h2>
              </div>
              {canManage &&
              recordStatus === "active" ? (
                <button
                  className="primary-button"
                  disabled={pending === "convert"}
                  onClick={() => void convert()}
                >
                  {pending === "convert"
                    ? "Converting…"
                    : "Convert to opportunity"}
                </button>
              ) : null}
            </div>
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
          </section>
        ) : null}

        {tab === "score" ? (
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Scoring history</p>
                <h2>Explainable score changes</h2>
              </div>
              {canManage ? (
                <button
                  className="secondary-button"
                  disabled={pending === "score"}
                  onClick={() =>
                    void api(
                      `/api/crm/leads/${id}/score`,
                      { reason: "Lead detail recalculation" },
                      "score",
                    )
                  }
                >
                  Recalculate
                </button>
              ) : null}
            </div>
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
          </section>
        ) : null}

        {tab === "custom" ? (
          <div className="crm-suite-two-column">
            <section className="crm-suite-surface">
              <div className="crm-suite-section-heading">
                <div>
                  <p className="eyebrow">F028 · Classification</p>
                  <h2>Tags</h2>
                </div>
              </div>
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
                <button
                  className="secondary-button"
                  type="button"
                  disabled={pending === "tags"}
                  onClick={() => void saveTags()}
                >
                  Save tags
                </button>
              ) : null}
            </section>
            <section className="crm-suite-surface">
              <div className="crm-suite-section-heading">
                <div>
                  <p className="eyebrow">F028 · Flexible data</p>
                  <h2>Custom fields</h2>
                </div>
              </div>
              <p className="crm-helper-copy">
                Use short snake_case keys so fields remain stable across exports
                and APIs.
              </p>
              <div className="crm-custom-field-editor">
                {customRows.map((row, index) => (
                  <div key={row.id}>
                    <label>
                      Field key
                      <input
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
                    </label>
                    <label>
                      Value
                      <input
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
                    </label>
                    {canManage ? (
                      <button
                        type="button"
                        className="link-button danger"
                        onClick={() =>
                          setCustomRows((rows) =>
                            rows.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                      >
                        Remove
                      </button>
                    ) : null}
                  </div>
                ))}
                {!customRows.length ? (
                  <p>No custom fields on this lead.</p>
                ) : null}
              </div>
              {canManage ? (
                <div className="crm-inline-actions">
                  <button
                    type="button"
                    className="secondary-button"
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
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={pending === "custom"}
                    onClick={() => void saveCustomFields()}
                  >
                    Save custom fields
                  </button>
                </div>
              ) : null}
            </section>
          </div>
        ) : null}

        {tab === "duplicates" ? (
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Duplicate management</p>
                <h2>Potential matching leads</h2>
              </div>
            </div>
            <div className="crm-duplicate-compare">
              {duplicates.map((row) => (
                <article key={String(row.id)}>
                  <div>
                    <strong>
                      {String(row.fullName || row.full_name || row.code)}
                    </strong>
                    <small>
                      {String(
                        row.companyName || row.company_name || "No company",
                      )}{" "}
                      · {String(row.email || row.mobile || row.phone || "")}
                    </small>
                  </div>
                  <span>
                    Match {String(row.matchScore || row.match_score || "—")}
                  </span>
                  <Link href={`/crm/leads/${String(row.id)}`}>Open</Link>
                  {canManage ? (
                    <button
                      className="link-button danger"
                      disabled={pending === "merge"}
                      onClick={() => void merge(String(row.id))}
                    >
                      Merge current into this
                    </button>
                  ) : null}
                </article>
              ))}
              {!duplicates.length ? (
                <div className="crm-suite-empty">
                  <strong>No likely duplicate found.</strong>
                </div>
              ) : null}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
