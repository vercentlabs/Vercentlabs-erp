"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import LeadAssigneeCombobox, {
  type LeadAssigneeOption,
} from "./lead-assignee-combobox";
import {
  ActionButton,
  EnterpriseDataGrid,
  FormField,
  StatePanel,
  StatusBadge,
  type DataGridColumn,
} from "@/shared/design";

type Row = Record<string, unknown>;
type Source = { id: string; name: string };

const CONDITION_FIELDS = [
  { value: "", label: "Any lead" },
  { value: "sourceId", label: "Lead source" },
  { value: "countryCode", label: "Country code" },
  { value: "industry", label: "Industry" },
  { value: "productInterest", label: "Product interest" },
];

function criteriaEntry(policy: Row | null) {
  const criteria =
    policy?.criteria && typeof policy.criteria === "object"
      ? (policy.criteria as Record<string, unknown>)
      : {};
  const [field = "", value = ""] = Object.entries(criteria)[0] || [];
  return { field, value: String(value || "") };
}

export default function LeadAssignmentRulesWorkspace({
  policies,
  sources,
  fallback,
  availability,
}: {
  policies: Row[];
  sources: Source[];
  fallback: Row;
  availability: Row[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<Row | null>(null);
  const [creating, setCreating] = useState(false);
  const [pending, setPending] = useState("");
  const [message, setMessage] = useState("");
  const [mode, setMode] = useState("fixed");
  const [conditionField, setConditionField] = useState("");
  const [fixedAssignee, setFixedAssignee] = useState<LeadAssigneeOption | null>(
    null,
  );
  const [memberCandidate, setMemberCandidate] =
    useState<LeadAssigneeOption | null>(null);
  const [members, setMembers] = useState<LeadAssigneeOption[]>([]);
  const activePolicy = creating ? null : editing;
  const condition = useMemo(() => criteriaEntry(activePolicy), [activePolicy]);
  const showingForm = creating || Boolean(editing);
  const [fallbackAssignee, setFallbackAssignee] = useState<LeadAssigneeOption | null>(
    fallback.fallback_user_id
      ? {
          id: String(fallback.fallback_user_id),
          name: String(fallback.fallback_user_name || "Current fallback owner"),
          email: String(fallback.fallback_user_email || ""),
        }
      : null,
  );
  const [awayAssignee, setAwayAssignee] = useState<LeadAssigneeOption | null>(null);
  const [awayStartsAt, setAwayStartsAt] = useState("");
  const [awayEndsAt, setAwayEndsAt] = useState("");
  const [awayReason, setAwayReason] = useState("");

  async function saveFallback() {
    setPending("fallback");
    setMessage("");
    try {
      const result = await requestJson<Row>("/api/crm/leads/assignment-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "set-fallback", fallbackUserId: fallbackAssignee?.id || null }),
      });
      if (!result.ok) throw new Error(String(result.message || "Fallback owner could not be saved."));
      setMessage("Fallback owner saved.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Fallback owner could not be saved.");
    } finally {
      setPending("");
    }
  }

  async function markAway(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!awayAssignee || !awayStartsAt || !awayEndsAt) {
      setMessage("Select a team member and both dates.");
      return;
    }
    setPending("away");
    setMessage("");
    try {
      const result = await requestJson<Row>("/api/crm/leads/assignment-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set-availability",
          userId: awayAssignee.id,
          startsAt: new Date(awayStartsAt).toISOString(),
          endsAt: new Date(awayEndsAt).toISOString(),
          reason: awayReason.trim() || null,
        }),
      });
      if (!result.ok) throw new Error(String(result.message || "Out-of-office window could not be saved."));
      setMessage("Out-of-office window saved. Automatic assignment will skip this person until it ends.");
      setAwayAssignee(null);
      setAwayStartsAt("");
      setAwayEndsAt("");
      setAwayReason("");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Out-of-office window could not be saved.");
    } finally {
      setPending("");
    }
  }

  async function clearAway(id: string) {
    setPending(`away-${id}`);
    setMessage("");
    try {
      const result = await requestJson<Row>("/api/crm/leads/assignment-policies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "clear-availability", availabilityId: id }),
      });
      if (!result.ok) throw new Error(String(result.message || "Could not clear this window."));
      setMessage("Out-of-office window cleared.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not clear this window.");
    } finally {
      setPending("");
    }
  }

  function beginCreate() {
    setCreating(true);
    setEditing(null);
    setMode("fixed");
    setConditionField("");
    setFixedAssignee(null);
    setMembers([]);
    setMessage("");
  }

  function beginEdit(policy: Row) {
    const nextCondition = criteriaEntry(policy);
    setCreating(false);
    setEditing(policy);
    setMode(String(policy.mode || "fixed"));
    setConditionField(nextCondition.field);
    setFixedAssignee(
      policy.assignee_user_id
        ? {
            id: String(policy.assignee_user_id),
            name: String(policy.assignee_name || "Current assignee"),
            email: "",
          }
        : null,
    );
    setMembers(
      Array.isArray(policy.members)
        ? (policy.members as LeadAssigneeOption[])
        : [],
    );
    setMessage("");
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const conditionValue = String(form.get("conditionValue") || "").trim();
    if (mode === "fixed" && !fixedAssignee) {
      setMessage("Select the fixed assignee.");
      return;
    }
    if (mode === "round_robin" && !members.length) {
      setMessage("Add at least one round-robin member.");
      return;
    }
    if (conditionField && !conditionValue) {
      setMessage("Complete the assignment condition.");
      return;
    }
    setPending("save");
    setMessage("");
    try {
      const result = await requestJson<Row>(
        "/api/crm/leads/assignment-policies",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            id: editing?.id,
            name: String(form.get("name") || ""),
            sequence: Number(form.get("sequence") || 100),
            criteria: conditionField
              ? { [conditionField]: conditionValue }
              : {},
            mode,
            assigneeUserId: fixedAssignee?.id || null,
            memberUserIds: members.map((member) => member.id),
            status: String(editing?.status || "active"),
          }),
        },
      );
      if (!result.ok)
        throw new Error(
          String(result.message || "Assignment rule could not be saved."),
        );
      setEditing(null);
      setCreating(false);
      setMessage("Assignment rule saved.");
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Assignment rule could not be saved.",
      );
    } finally {
      setPending("");
    }
  }

  async function changeStatus(policy: Row) {
    const activating = policy.status !== "active";
    setPending(String(policy.id));
    setMessage("");
    try {
      const result = await requestJson<Row>(
        "/api/crm/leads/assignment-policies",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: activating ? "activate" : "archive",
            policyId: policy.id,
          }),
        },
      );
      if (!result.ok)
        throw new Error(
          String(result.message || "Assignment rule could not be updated."),
        );
      setMessage(
        activating
          ? "Assignment rule activated."
          : "Assignment rule deactivated.",
      );
      router.refresh();
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Assignment rule could not be updated.",
      );
    } finally {
      setPending("");
    }
  }

  return (
    <div className="module-workbench crm-assignment-rules-page">
      <header className="crm-suite-command">
        <div>
          <p className="eyebrow">CRM setup · Lead management</p>
          <h1>Assignment rules</h1>
          <p>Route new Leads with simple, ordered ownership rules.</p>
        </div>
        <ActionButton tone="primary" onClick={beginCreate} type="button">
          New rule
        </ActionButton>
      </header>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}
      <div className="crm-assignment-rules-layout">
        <section
          className="crm-suite-surface"
          aria-labelledby="assignment-rule-list-title"
        >
          <div className="crm-suite-section-heading">
            <div>
              <p className="eyebrow">Evaluation order</p>
              <h2 id="assignment-rule-list-title">First eligible match wins</h2>
            </div>
          </div>
          {(() => {
            const columns: DataGridColumn<Row>[] = [
              {
                id: "priority",
                header: "Priority",
                width: "70px",
                cell: (policy) => (
                  <div className="crm-assignment-rule-priority">
                    {String(policy.sequence)}
                  </div>
                ),
              },
              {
                id: "rule",
                header: "Rule",
                cell: (policy) => (
                  <div>
                    <strong>{String(policy.name)}</strong>
                    <span>
                      {Object.keys((policy.criteria as Row) || {}).length
                        ? Object.entries((policy.criteria as Row) || {})
                            .map(([key, value]) => `${key} = ${String(value)}`)
                            .join(", ")
                        : "Any lead"}
                    </span>
                    <small>
                      {policy.mode === "fixed"
                        ? `Assign to ${String(policy.assignee_name || "Unavailable assignee")}`
                        : `Round robin · ${Array.isArray(policy.member_user_ids) ? policy.member_user_ids.length : 0} members`}
                    </small>
                  </div>
                ),
              },
              {
                id: "status",
                header: "Status",
                cell: (policy) => (
                  <StatusBadge tone={policy.status === "active" ? "success" : "neutral"}>
                    {String(policy.status)}
                  </StatusBadge>
                ),
              },
              {
                id: "actions",
                header: "Actions",
                cell: (policy) => (
                  <div className="crm-assignment-rule-actions">
                    <ActionButton onClick={() => beginEdit(policy)} type="button">
                      Edit
                    </ActionButton>
                    <ActionButton
                      tone="quiet"
                      disabled={pending === String(policy.id)}
                      onClick={() => void changeStatus(policy)}
                      type="button"
                    >
                      {policy.status === "active" ? "Deactivate" : "Activate"}
                    </ActionButton>
                  </div>
                ),
              },
            ];
            return (
              <EnterpriseDataGrid
                caption="Assignment rules"
                rows={policies}
                rowKey={(policy) => String(policy.id)}
                columns={columns}
                emptyState={
                  <StatePanel
                    title="No assignment rules yet."
                    description="New Leads remain unassigned unless an authorized creator chooses an owner."
                  />
                }
              />
            );
          })()}
        </section>

        {showingForm ? (
          <section
            className="crm-suite-surface crm-assignment-rule-editor"
            aria-labelledby="assignment-rule-editor-title"
          >
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Rule configuration</p>
                <h2 id="assignment-rule-editor-title">
                  {editing ? "Edit rule" : "New rule"}
                </h2>
              </div>
            </div>
            <form className="crm-suite-form" onSubmit={submit}>
              <FormField label="Name" htmlFor="assignment-rule-name" required>
                <input
                  id="assignment-rule-name"
                  name="name"
                  required
                  defaultValue={String(editing?.name || "")}
                  maxLength={160}
                />
              </FormField>
              <FormField label="Priority" htmlFor="assignment-rule-sequence" required>
                <input
                  id="assignment-rule-sequence"
                  name="sequence"
                  required
                  type="number"
                  min={0}
                  max={100000}
                  defaultValue={Number(editing?.sequence || 100)}
                />
              </FormField>
              <FormField label="When" htmlFor="assignment-rule-condition-field">
                <select
                  id="assignment-rule-condition-field"
                  value={conditionField || condition.field}
                  onChange={(event) =>
                    setConditionField(event.currentTarget.value)
                  }
                >
                  {CONDITION_FIELDS.map((field) => (
                    <option key={field.value} value={field.value}>
                      {field.label}
                    </option>
                  ))}
                </select>
              </FormField>
              {(conditionField || condition.field) === "sourceId" ? (
                <FormField label="Is" htmlFor="assignment-rule-condition-value" required>
                  <select
                    id="assignment-rule-condition-value"
                    name="conditionValue"
                    defaultValue={condition.value}
                    required
                  >
                    <option value="">Select source</option>
                    {sources.map((source) => (
                      <option key={source.id} value={source.id}>
                        {source.name}
                      </option>
                    ))}
                  </select>
                </FormField>
              ) : conditionField || condition.field ? (
                <FormField label="Is" htmlFor="assignment-rule-condition-value" required>
                  <input
                    id="assignment-rule-condition-value"
                    name="conditionValue"
                    defaultValue={condition.value}
                    required
                    maxLength={500}
                  />
                </FormField>
              ) : null}
              <FormField label="Assignment method" htmlFor="assignment-rule-mode">
                <select
                  id="assignment-rule-mode"
                  value={mode}
                  onChange={(event) => setMode(event.currentTarget.value)}
                >
                  <option value="fixed">Fixed owner</option>
                  <option value="round_robin">Round robin</option>
                </select>
              </FormField>
              {mode === "fixed" ? (
                <label>
                  Assign to
                  <LeadAssigneeCombobox
                    key={`fixed-${String(editing?.id || "new")}`}
                    purpose="rule"
                    value={fixedAssignee}
                    onChange={setFixedAssignee}
                  />
                </label>
              ) : (
                <div className="crm-assignment-member-editor">
                  <label>
                    Add eligible member
                    <LeadAssigneeCombobox
                      purpose="rule"
                      value={memberCandidate}
                      onChange={setMemberCandidate}
                    />
                  </label>
                  <ActionButton
                    disabled={!memberCandidate}
                    onClick={() => {
                      if (!memberCandidate) return;
                      setMembers((current) =>
                        current.some(
                          (member) => member.id === memberCandidate.id,
                        )
                          ? current
                          : [...current, memberCandidate],
                      );
                      setMemberCandidate(null);
                    }}
                    type="button"
                  >
                    Add member
                  </ActionButton>
                  <div className="crm-assignment-member-list">
                    {members.map((member) => (
                      <span key={member.id}>
                        {member.name}
                        <button
                          aria-label={`Remove ${member.name}`}
                          onClick={() =>
                            setMembers((current) =>
                              current.filter((item) => item.id !== member.id),
                            )
                          }
                          type="button"
                        >
                          ×
                        </button>
                      </span>
                    ))}
                  </div>
                </div>
              )}
              <footer>
                <ActionButton
                  onClick={() => {
                    setEditing(null);
                    setCreating(false);
                  }}
                  type="button"
                >
                  Cancel
                </ActionButton>
                <ActionButton
                  tone="primary"
                  busy={pending === "save"}
                  type="submit"
                >
                  {pending === "save" ? "Saving…" : "Save rule"}
                </ActionButton>
              </footer>
            </form>
          </section>
        ) : null}
      </div>

      <section className="crm-suite-surface" aria-labelledby="assignment-fallback-title">
        <div className="crm-suite-section-heading">
          <div>
            <p className="eyebrow">Last resort</p>
            <h2 id="assignment-fallback-title">Fallback owner</h2>
            <p>
              Used only when every active rule above either doesn&apos;t match
              or has no available owner (e.g. everyone in a round-robin group
              is currently marked out of office). Never a substitute for a
              real rule.
            </p>
          </div>
        </div>
        <div className="crm-assignment-fallback">
          <LeadAssigneeCombobox
            value={fallbackAssignee}
            onChange={setFallbackAssignee}
            allowUnassigned
            disabled={pending === "fallback"}
          />
          <ActionButton
            tone="primary"
            type="button"
            busy={pending === "fallback"}
            onClick={() => void saveFallback()}
          >
            {pending === "fallback" ? "Saving…" : "Save fallback owner"}
          </ActionButton>
        </div>
      </section>

      <section className="crm-suite-surface" aria-labelledby="assignment-availability-title">
        <div className="crm-suite-section-heading">
          <div>
            <p className="eyebrow">Availability</p>
            <h2 id="assignment-availability-title">Out of office</h2>
            <p>
              Round-robin, workload and territory assignment skip anyone
              marked away for the current moment. Manual assignment is never
              blocked by this — it&apos;s a routing signal, not a hard rule.
            </p>
          </div>
        </div>
        <form className="crm-assignment-away-form" onSubmit={(event) => void markAway(event)}>
          <LeadAssigneeCombobox
            value={awayAssignee}
            onChange={setAwayAssignee}
            disabled={pending === "away"}
          />
          <FormField label="From" htmlFor="assignment-away-starts-at" required>
            <input
              id="assignment-away-starts-at"
              type="datetime-local"
              value={awayStartsAt}
              onChange={(event) => setAwayStartsAt(event.target.value)}
              disabled={pending === "away"}
              required
            />
          </FormField>
          <FormField label="Until" htmlFor="assignment-away-ends-at" required>
            <input
              id="assignment-away-ends-at"
              type="datetime-local"
              value={awayEndsAt}
              onChange={(event) => setAwayEndsAt(event.target.value)}
              disabled={pending === "away"}
              required
            />
          </FormField>
          <FormField label="Reason (optional)" htmlFor="assignment-away-reason">
            <input
              id="assignment-away-reason"
              type="text"
              value={awayReason}
              onChange={(event) => setAwayReason(event.target.value)}
              placeholder="Vacation, sick leave…"
              disabled={pending === "away"}
            />
          </FormField>
          <ActionButton tone="primary" type="submit" busy={pending === "away"}>
            {pending === "away" ? "Saving…" : "Mark unavailable"}
          </ActionButton>
        </form>
        <div className="crm-assignment-away-list">
          {availability.map((row) => (
            <article key={String(row.id)}>
              <div>
                <strong>{String(row.user_name || "Team member")}</strong>
                <small>
                  {new Date(String(row.starts_at)).toLocaleString()} &ndash;{" "}
                  {new Date(String(row.ends_at)).toLocaleString()}
                  {row.reason ? ` · ${String(row.reason)}` : ""}
                </small>
              </div>
              <ActionButton
                tone="quiet"
                type="button"
                disabled={pending === `away-${String(row.id)}`}
                onClick={() => void clearAway(String(row.id))}
              >
                Clear
              </ActionButton>
            </article>
          ))}
          {!availability.length ? <p>No one is currently marked out of office.</p> : null}
        </div>
      </section>
    </div>
  );
}
