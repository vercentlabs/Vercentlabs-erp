"use client";

import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import FavouriteToggle from "@/components/favourite-toggle";
import { requestJson } from "@/lib/client-request";

type Row = Record<string, unknown>;
type Option = { id: string; name: string };
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
function option(options: Record<string, Option[]>, key: string, id: unknown) {
  return options[key]?.find((item) => item.id === String(id))?.name || "—";
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
  canManage,
  canManageActivities,
  canManageCommunications,
  initialFavourited,
}: {
  lead: Row;
  activities: Row[];
  communications: Row[];
  notes: Row[];
  scoreHistory: Row[];
  opportunities: Row[];
  duplicates: Row[];
  options: Record<string, Option[]>;
  canManage: boolean;
  canManageActivities: boolean;
  canManageCommunications: boolean;
  initialFavourited: boolean;
}) {
  const router = useRouter();
  const [tab, setTab] = useState("overview");
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const id = String(lead.id);
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
      ].sort(
        (a, b) =>
          new Date(String(b.__date || 0)).getTime() -
          new Date(String(a.__date || 0)).getTime(),
      ),
    [activities, communications, notes, opportunities],
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
    let reason = "";
    if (nextStatus === "unqualified") {
      reason = window.prompt("Disqualification reason")?.trim() || "";
      if (!reason) return;
    }
    await api(
      `/api/crm/leads/${id}/status`,
      { status: nextStatus, unqualifiedReason: reason },
      "status",
    );
  }
  async function convert() {
    if (!confirm("Convert this lead into an account, contact and opportunity?"))
      return;
    await api(
      `/api/crm/leads/${id}/convert`,
      { createOpportunity: true },
      "convert",
    );
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
  async function createActivity(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const result = await api(
      "/api/crm/activities",
      {
        entityType: "lead",
        entityId: id,
        activityType: String(form.get("activityType") || "task"),
        subject: String(form.get("subject") || ""),
        description: String(form.get("description") || ""),
        assignedTo: String(form.get("assignedTo") || lead.ownerUserId || ""),
        priority: String(form.get("priority") || "medium"),
        dueAt: String(form.get("dueAt") || ""),
      },
      "activity",
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
  const tabs = [
    "overview",
    "timeline",
    "activities",
    "communications",
    "notes",
    "opportunities",
    "score",
    "duplicates",
  ];
  const contact = [lead.email, lead.mobile, lead.phone]
    .filter(Boolean)
    .join(" · ");

  return (
    <div className="crm-suite-page crm-lead-detail-page">
      <header className="crm-lead-detail-command">
        <div className="crm-lead-detail-identity">
          <Link href="/crm/leads">← Lead queue</Link>
          <p className="eyebrow">Lead · {String(lead.code)}</p>
          <h1>{name}</h1>
          <p>
            {[lead.companyName, lead.jobTitle, contact]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        <div className="crm-lead-detail-right">
          <div className="crm-lead-detail-badges">
            <span>{nice(lead.status)}</span>
            <span>Score {String(lead.score || 0)}</span>
            <span>{nice(lead.leadGrade || lead.rating || "ungraded")}</span>
          </div>
          <FavouriteToggle
            href={`/crm/leads/${id}`}
            label={name}
            targetType="crm-lead"
            moduleKey="crm"
            initialFavourited={initialFavourited}
          />
          {canManage &&
          lead.status !== "converted" &&
          lead.status !== "archived" ? (
            <button
              className="primary-button"
              disabled={pending === "convert"}
              onClick={() => void convert()}
            >
              Convert lead
            </button>
          ) : null}
        </div>
      </header>
      <section className="crm-lead-detail-facts">
        <div>
          <small>Owner</small>
          <strong>{option(options, "users", lead.ownerUserId)}</strong>
        </div>
        <div>
          <small>Source</small>
          <strong>{option(options, "sources", lead.sourceId)}</strong>
        </div>
        <div>
          <small>Campaign</small>
          <strong>{option(options, "campaigns", lead.campaignId)}</strong>
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
      {canManage && !["converted", "archived"].includes(String(lead.status)) ? (
        <section className="crm-lead-stage-strip">
          <span>Move lifecycle</span>
          {["new", "contacted", "working", "qualified", "unqualified"].map(
            (stage) => (
              <button
                key={stage}
                type="button"
                className={String(lead.status) === stage ? "active" : ""}
                disabled={pending === "status" || String(lead.status) === stage}
                onClick={() => void moveStatus(stage)}
              >
                {nice(stage)}
              </button>
            ),
          )}
        </section>
      ) : null}
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <nav
        className="crm-suite-tabs lead-detail-tabs"
        aria-label="Lead record sections"
      >
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {nice(item)}
            {item === "duplicates" && duplicates.length
              ? ` (${duplicates.length})`
              : ""}
          </button>
        ))}
      </nav>

      {tab === "overview" ? (
        <div className="crm-lead-detail-overview">
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
                ["Website", lead.website],
                ["Industry", lead.industry],
                [
                  "City / state",
                  [lead.city, lead.state].filter(Boolean).join(", "),
                ],
                ["Product interest", lead.productInterest],
                ["Rating", nice(lead.rating)],
                ["Disqualification reason", lead.unqualifiedReason],
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
                <span>Communications</span>
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
                Plan follow-up
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
                    `/api/crm/lead-intelligence/scores/${id}`,
                    { reason: "Lead detail recalculation" },
                    "score",
                  )
                }
              >
                Recalculate score
              </button>
            ) : null}
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
                    {row.description ? <p>{String(row.description)}</p> : null}
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
              <form className="crm-suite-form" onSubmit={createActivity}>
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
                  <input name="subject" required placeholder="Discovery call" />
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
                  <input name="dueAt" type="datetime-local" />
                </label>
                <button
                  className="primary-button"
                  disabled={pending === "activity"}
                >
                  Create activity
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
                <p className="eyebrow">Communication history</p>
                <h2>Email, call, SMS, chat and WhatsApp log</h2>
              </div>
              <Link href="/crm/communications">Communication workspace →</Link>
            </div>
            <div className="crm-suite-list">
              {communications.map((row) => (
                <article key={String(row.id)}>
                  <div>
                    <strong>{String(row.subject || nice(row.channel))}</strong>
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
            lead.status !== "converted" &&
            lead.status !== "archived" ? (
              <button className="primary-button" onClick={() => void convert()}>
                Convert lead
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
            {!opportunities.length ? <p>No linked opportunities yet.</p> : null}
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
                    `/api/crm/lead-intelligence/scores/${id}`,
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
                  {String(row.previous_score)} → <b>{String(row.new_score)}</b>
                </span>
              </article>
            ))}
            {!scoreHistory.length ? <p>No score changes recorded.</p> : null}
          </div>
        </section>
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
  );
}
