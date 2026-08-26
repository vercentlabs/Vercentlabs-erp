"use client";

import { FormEvent, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import LeadAssigneeCombobox, {
  type LeadAssigneeOption,
} from "./lead-assignee-combobox";

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
}: {
  policies: Row[];
  sources: Source[];
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
        <button className="primary-button" onClick={beginCreate} type="button">
          New rule
        </button>
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
          <div className="crm-assignment-rule-list">
            {policies.map((policy) => (
              <article
                className={policy.status === "active" ? "" : "is-inactive"}
                key={String(policy.id)}
              >
                <div className="crm-assignment-rule-priority">
                  {String(policy.sequence)}
                </div>
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
                <span
                  className={`status-badge ${policy.status === "active" ? "success" : "neutral"}`}
                >
                  {String(policy.status)}
                </span>
                <div className="crm-assignment-rule-actions">
                  <button
                    className="secondary-button"
                    onClick={() => beginEdit(policy)}
                    type="button"
                  >
                    Edit
                  </button>
                  <button
                    className="link-button"
                    disabled={pending === String(policy.id)}
                    onClick={() => void changeStatus(policy)}
                    type="button"
                  >
                    {policy.status === "active" ? "Deactivate" : "Activate"}
                  </button>
                </div>
              </article>
            ))}
            {!policies.length ? (
              <div className="crm-suite-empty">
                <strong>No assignment rules yet.</strong>
                <p>
                  New Leads remain unassigned unless an authorized creator
                  chooses an owner.
                </p>
              </div>
            ) : null}
          </div>
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
              <label>
                Name
                <input
                  name="name"
                  required
                  defaultValue={String(editing?.name || "")}
                  maxLength={160}
                />
              </label>
              <label>
                Priority
                <input
                  name="sequence"
                  required
                  type="number"
                  min={0}
                  max={100000}
                  defaultValue={Number(editing?.sequence || 100)}
                />
              </label>
              <label>
                When
                <select
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
              </label>
              {(conditionField || condition.field) === "sourceId" ? (
                <label>
                  Is
                  <select
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
                </label>
              ) : conditionField || condition.field ? (
                <label>
                  Is
                  <input
                    name="conditionValue"
                    defaultValue={condition.value}
                    required
                    maxLength={500}
                  />
                </label>
              ) : null}
              <label>
                Assignment method
                <select
                  value={mode}
                  onChange={(event) => setMode(event.currentTarget.value)}
                >
                  <option value="fixed">Fixed owner</option>
                  <option value="round_robin">Round robin</option>
                </select>
              </label>
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
                  <button
                    className="secondary-button"
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
                  </button>
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
                <button
                  className="secondary-button"
                  onClick={() => {
                    setEditing(null);
                    setCreating(false);
                  }}
                  type="button"
                >
                  Cancel
                </button>
                <button
                  className="primary-button"
                  disabled={pending === "save"}
                  type="submit"
                >
                  {pending === "save" ? "Saving…" : "Save rule"}
                </button>
              </footer>
            </form>
          </section>
        ) : null}
      </div>
    </div>
  );
}
