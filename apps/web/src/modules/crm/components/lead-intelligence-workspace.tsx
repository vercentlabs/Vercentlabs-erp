"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";

type Row = Record<string, unknown>;
type Option = { id: string; name: string };
function num(value: unknown) {
  const result = Number(value || 0);
  return Number.isFinite(result) ? result : 0;
}
function nice(value: unknown) {
  return String(value ?? "—")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}

export default function CrmLeadIntelligenceWorkspace({
  dashboard,
  readiness,
  options,
  initialPolicies,
  canManage,
  canManageRouting,
}: {
  dashboard: Row;
  readiness: Row;
  options: Record<string, Option[]>;
  initialPolicies: Row[];
  canManage: boolean;
  canManageRouting: boolean;
}) {
  const router = useRouter();
  const summary = (dashboard.summary || {}) as Row;
  const grades = (dashboard.grades || []) as Row[];
  const sla = (dashboard.sla || []) as Row[];
  const queue = (dashboard.topQueue || []) as Row[];
  const [tab, setTab] = useState("priorities");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState("");
  const [selectedLead, setSelectedLead] = useState(
    options.leads?.[0]?.id || "",
  );
  const [explanation, setExplanation] = useState<Row | null>(null);
  const [policies, setPolicies] = useState(initialPolicies);
  const gradeMax = Math.max(1, ...grades.map((row) => num(row.leads)));
  const slaMax = Math.max(1, ...sla.map((row) => num(row.cases)));
  const tabs = ["priorities", "scoring", "sla", "routing"];

  async function api(
    path: string,
    body: Record<string, unknown>,
    key = "action",
  ) {
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
  async function explain() {
    if (!selectedLead) return;
    setPending("explain");
    try {
      const result = await requestJson<Row>(
        `/api/crm/lead-intelligence/scores/${selectedLead}`,
      );
      if (!result.ok)
        throw new Error(result.message || "Score explanation unavailable.");
      setExplanation(result);
    } catch (error) {
      setMessage(
        error instanceof Error
          ? error.message
          : "Score explanation unavailable.",
      );
    } finally {
      setPending("");
    }
  }
  async function recalc() {
    if (!selectedLead) return;
    const result = await api(
      `/api/crm/lead-intelligence/scores/${selectedLead}`,
      { reason: "Manual recalculation from Lead Intelligence" },
      "score",
    );
    if (result) await explain();
  }
  async function queueAction(itemId: string, action: string) {
    const body: Row = { itemId, action };
    if (action === "snooze") {
      const hours = Number(
        window.prompt("Snooze for how many hours?", "24") || 0,
      );
      if (!hours) return;
      body.until = new Date(Date.now() + hours * 3_600_000).toISOString();
    }
    if (action === "exit")
      body.reason =
        window.prompt("Exit reason", "manual_exit") || "manual_exit";
    await api("/api/crm/lead-intelligence/nurture", body, `queue-${itemId}`);
  }
  async function refreshPolicies() {
    const result = await requestJson<{ policies?: Row[] }>(
      "/api/crm/leads/assignment-policies",
    );
    if (result.ok) setPolicies(result.policies || []);
  }
  async function savePolicy(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const criteriaField = String(form.get("criteriaField") || "");
    const criteriaValue = String(form.get("criteriaValue") || "").trim();
    const result = await api(
      "/api/crm/leads/assignment-policies",
      {
        name: String(form.get("name") || ""),
        sequence: Number(form.get("sequence") || 100),
        mode: String(form.get("mode") || "workload"),
        assigneeUserId: String(form.get("assigneeUserId") || "") || null,
        memberUserIds: form.getAll("memberUserIds").map(String),
        territoryId: String(form.get("territoryId") || "") || null,
        criteria:
          criteriaField && criteriaValue
            ? { [criteriaField]: criteriaValue }
            : {},
      },
      "policy",
    );
    if (result) {
      formElement.reset();
      await refreshPolicies();
    }
  }

  return (
    <div className="crm-suite-page crm-intel-page">
      <header className="crm-suite-command">
        <div>
          <p className="eyebrow">CRM · Lead intelligence</p>
          <h1>Scoring, SLA &amp; nurture</h1>
          <p>
            Operate deterministic, explainable scoring; first-response
            commitments; seller priorities; and governed assignment. Rule-based
            scoring is not presented as AI.
          </p>
        </div>
        <div className="crm-suite-command-actions">
          <Link className="secondary-button" href="/crm/leads">
            Lead queue
          </Link>
          <Link className="secondary-button" href="/crm/lead-acquisition">
            Acquisition
          </Link>
          {canManage ? (
            <button
              className="primary-button"
              type="button"
              disabled={pending === "refresh"}
              onClick={() =>
                void api(
                  "/api/crm/lead-intelligence/nurture",
                  { action: "refresh" },
                  "refresh",
                )
              }
            >
              Refresh nurture queue
            </button>
          ) : null}
        </div>
      </header>
      <section className="crm-suite-metrics">
        {[
          ["Active leads", summary.active_leads],
          ["Qualified", summary.qualified_leads],
          ["Average score", summary.average_score],
          ["Unscored", summary.unscored_leads],
          ["Readiness", `${String(readiness.score || 0)}%`],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <small>{String(label)}</small>
            <strong>{String(value ?? 0)}</strong>
          </div>
        ))}
      </section>
      <section className="crm-suite-readiness">
        <span className={`state-${String(readiness.readiness || "blocked")}`} />
        <div>
          <strong>
            Lead Intelligence: {nice(readiness.readiness || "blocked")}
          </strong>
          <small>
            Active scoring models, rules, SLA policies, nurture policies and
            acceptance evidence determine this state.
          </small>
        </div>
      </section>
      <nav className="crm-suite-tabs" aria-label="Lead Intelligence sections">
        {tabs.map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {nice(item)}
          </button>
        ))}
      </nav>
      {message ? (
        <p className="notice" role="status">
          {message}
        </p>
      ) : null}

      {tab === "priorities" ? (
        <div className="crm-suite-two-column wide">
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Seller priority queue</p>
                <h2>Work the highest-value next action first</h2>
              </div>
            </div>
            <div className="crm-intel-queue">
              {queue.slice(0, 50).map((row) => (
                <article key={String(row.id)}>
                  <div className="crm-intel-priority">
                    {Math.round(num(row.priority_score))}
                  </div>
                  <div>
                    <Link href={`/crm/leads/${String(row.lead_id)}`}>
                      {String(row.full_name || row.company_name || row.code)}
                    </Link>
                    <small>
                      {String(row.recommended_action || "Follow up")} · lead
                      score {String(row.score ?? 0)}
                    </small>
                    <p>
                      {Array.isArray(row.reason_codes)
                        ? row.reason_codes.map(nice).join(" · ")
                        : String(row.reason_codes || "")}
                    </p>
                  </div>
                  <time>
                    {row.due_at
                      ? new Date(String(row.due_at)).toLocaleString("en-IN")
                      : "No deadline"}
                  </time>
                  {canManage ? (
                    <div className="crm-intel-queue-actions">
                      <button
                        className="link-button"
                        type="button"
                        disabled={pending === `queue-${String(row.id)}`}
                        onClick={() =>
                          void queueAction(String(row.id), "claim")
                        }
                      >
                        Claim
                      </button>
                      <button
                        className="link-button"
                        type="button"
                        disabled={pending === `queue-${String(row.id)}`}
                        onClick={() =>
                          void queueAction(String(row.id), "complete")
                        }
                      >
                        Complete
                      </button>
                      <button
                        className="link-button"
                        type="button"
                        disabled={pending === `queue-${String(row.id)}`}
                        onClick={() =>
                          void queueAction(String(row.id), "snooze")
                        }
                      >
                        Snooze
                      </button>
                      <button
                        className="link-button danger"
                        type="button"
                        disabled={pending === `queue-${String(row.id)}`}
                        onClick={() => void queueAction(String(row.id), "exit")}
                      >
                        Exit
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
              {!queue.length ? (
                <div className="crm-suite-empty">
                  <strong>No active nurture work.</strong>
                  <p>Refresh after active nurture policies are configured.</p>
                </div>
              ) : null}
            </div>
          </section>
          <aside className="crm-suite-surface">
            <h2>Lead grade distribution</h2>
            <div className="crm-intel-bars">
              {grades.map((row) => (
                <div key={String(row.lead_grade)}>
                  <span>
                    <strong>{nice(row.lead_grade || "ungraded")}</strong>
                    <b>{String(row.leads)}</b>
                  </span>
                  <i>
                    <b
                      style={{
                        width: `${Math.max(3, (num(row.leads) / gradeMax) * 100)}%`,
                      }}
                    />
                  </i>
                </div>
              ))}
            </div>
            <h2 className="crm-suite-subheading">SLA state</h2>
            <div className="crm-intel-bars">
              {sla.map((row) => (
                <div key={String(row.status)}>
                  <span>
                    <strong>{nice(row.status)}</strong>
                    <b>{String(row.cases)}</b>
                  </span>
                  <i>
                    <b
                      style={{
                        width: `${Math.max(3, (num(row.cases) / slaMax) * 100)}%`,
                      }}
                    />
                  </i>
                </div>
              ))}
            </div>
          </aside>
        </div>
      ) : null}

      {tab === "scoring" ? (
        <div className="crm-suite-two-column">
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Explainable scoring lab</p>
                <h2>Inspect the current score or recalculate it</h2>
              </div>
            </div>
            <div className="crm-suite-form">
              <label>
                Lead
                <select
                  value={selectedLead}
                  onChange={(event) => {
                    setSelectedLead(event.currentTarget.value);
                    setExplanation(null);
                  }}
                >
                  <option value="">Select lead</option>
                  {options.leads?.map((lead) => (
                    <option key={lead.id} value={lead.id}>
                      {lead.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="crm-suite-actions">
                <button
                  className="secondary-button"
                  type="button"
                  disabled={!selectedLead || pending === "explain"}
                  onClick={() => void explain()}
                >
                  Explain score
                </button>
                {canManage ? (
                  <button
                    className="primary-button"
                    type="button"
                    disabled={!selectedLead || pending === "score"}
                    onClick={() => void recalc()}
                  >
                    Recalculate
                  </button>
                ) : null}
              </div>
            </div>
            {explanation ? (
              <div className="crm-intel-explanation">
                <div>
                  <small>Current score</small>
                  <strong>
                    {String(
                      explanation.score ?? explanation.current_score ?? "—",
                    )}
                  </strong>
                </div>
                <div>
                  <small>Grade</small>
                  <strong>
                    {nice(explanation.lead_grade || explanation.grade)}
                  </strong>
                </div>
                <pre>
                  {JSON.stringify(
                    explanation.score_explanation ||
                      explanation.explanation ||
                      explanation,
                    null,
                    2,
                  )}
                </pre>
              </div>
            ) : null}
          </section>
          <section className="crm-suite-surface">
            <h2>Record a behaviour signal</h2>
            {canManage ? (
              <form
                className="crm-suite-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  const form = new FormData(event.currentTarget);
                  void api(
                    "/api/crm/lead-intelligence/events",
                    {
                      leadId: String(form.get("leadId") || ""),
                      eventType: String(
                        form.get("eventType") || "seller_signal",
                      ),
                      eventKey: String(form.get("eventKey") || crypto.randomUUID()),
                      value: Number(form.get("value") || 1),
                      occurredAt: new Date().toISOString(),
                      metadata: { source: "lead-intelligence-workspace" },
                    },
                    "signal",
                  );
                }}
              >
                <label>
                  Lead
                  <select name="leadId" required>
                    <option value="">Select lead</option>
                    {options.leads?.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Signal type
                  <input
                    name="eventType"
                    defaultValue="seller_signal"
                    required
                  />
                </label>
                <label>
                  Idempotency key
                  <input
                    name="eventKey"
                    placeholder="Generated automatically if blank"
                  />
                </label>
                <label>
                  Signal value
                  <input
                    name="value"
                    type="number"
                    step="any"
                    defaultValue="1"
                  />
                </label>
                <button
                  className="primary-button"
                  disabled={pending === "signal"}
                >
                  Record signal
                </button>
              </form>
            ) : (
              <p>
                Lead-management permission is required to add scoring signals.
              </p>
            )}
          </section>
        </div>
      ) : null}

      {tab === "sla" ? (
        <div className="crm-suite-two-column">
          <section className="crm-suite-surface">
            <h2>First-response SLA controls</h2>
            {canManage ? (
              <div className="crm-suite-form">
                <label>
                  Lead
                  <select
                    value={selectedLead}
                    onChange={(event) =>
                      setSelectedLead(event.currentTarget.value)
                    }
                  >
                    <option value="">Select lead</option>
                    {options.leads?.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="crm-suite-actions">
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!selectedLead || pending === "sla"}
                    onClick={() =>
                      void api(
                        "/api/crm/lead-intelligence/sla",
                        {
                          action: "open",
                          leadId: selectedLead,
                          openedAt: new Date().toISOString(),
                        },
                        "sla",
                      )
                    }
                  >
                    Open SLA case
                  </button>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={!selectedLead || pending === "sla"}
                    onClick={() =>
                      void api(
                        "/api/crm/lead-intelligence/sla",
                        {
                          action: "respond",
                          leadId: selectedLead,
                          respondedAt: new Date().toISOString(),
                          channel: "manual",
                        },
                        "sla",
                      )
                    }
                  >
                    Record first response
                  </button>
                  <button
                    className="primary-button"
                    type="button"
                    disabled={pending === "sla"}
                    onClick={() =>
                      void api(
                        "/api/crm/lead-intelligence/sla",
                        { action: "scan", now: new Date().toISOString() },
                        "sla",
                      )
                    }
                  >
                    Scan breaches
                  </button>
                </div>
              </div>
            ) : (
              <p>Lead-management permission is required to mutate SLA state.</p>
            )}
          </section>
          <section className="crm-suite-surface">
            <h2>Current SLA cases</h2>
            <div className="crm-intel-bars">
              {sla.map((row) => (
                <div key={String(row.status)}>
                  <span>
                    <strong>{nice(row.status)}</strong>
                    <b>{String(row.cases)}</b>
                  </span>
                  <i>
                    <b
                      style={{
                        width: `${Math.max(3, (num(row.cases) / slaMax) * 100)}%`,
                      }}
                    />
                  </i>
                </div>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "routing" ? (
        <div className="crm-suite-two-column">
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Lead routing</p>
                <h2>Fixed, round-robin, workload or territory</h2>
              </div>
            </div>
            {canManageRouting ? (
              <form className="crm-suite-form" onSubmit={savePolicy}>
                <label>
                  Policy name
                  <input
                    name="name"
                    required
                    placeholder="Manufacturing leads — West"
                  />
                </label>
                <label>
                  Sequence
                  <input name="sequence" type="number" defaultValue="100" />
                </label>
                <label>
                  Match field
                  <select name="criteriaField" defaultValue="productInterest">
                    <option value="">All leads</option>
                    <option value="productInterest">Product interest</option>
                    <option value="industry">Industry</option>
                    <option value="sourceId">Source ID</option>
                    <option value="priority">Priority</option>
                    <option value="rating">Rating</option>
                  </select>
                </label>
                <label>
                  Exact match value
                  <input name="criteriaValue" placeholder="Manufacturing" />
                </label>
                <label>
                  Strategy
                  <select name="mode" defaultValue="workload">
                    <option value="fixed">Fixed owner</option>
                    <option value="round_robin">Round robin</option>
                    <option value="workload">Least active workload</option>
                    <option value="territory">Territory workload</option>
                  </select>
                </label>
                <label>
                  Fixed owner
                  <select name="assigneeUserId">
                    <option value="">None</option>
                    {options.users?.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Round-robin / workload members
                  <select
                    name="memberUserIds"
                    multiple
                    size={Math.min(7, Math.max(3, options.users?.length || 3))}
                  >
                    {options.users?.map((user) => (
                      <option key={user.id} value={user.id}>
                        {user.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Territory
                  <select name="territoryId">
                    <option value="">None</option>
                    {options.territories?.map((territory) => (
                      <option key={territory.id} value={territory.id}>
                        {territory.name}
                      </option>
                    ))}
                  </select>
                </label>
                <p className="field-help">
                  Product routing uses product-interest criteria; territory mode
                  resolves active territory sellers, then assigns the
                  least-loaded eligible seller.
                </p>
                <button
                  className="primary-button"
                  disabled={pending === "policy"}
                >
                  Create routing policy
                </button>
              </form>
            ) : (
              <div className="crm-suite-boundary">
                <strong>
                  Routing administration requires team-wide CRM visibility
                </strong>
                <p>
                  Policy writes require crm.leads.manage and
                  crm.records.view_all so a restricted seller cannot route
                  records to users they cannot administer.
                </p>
              </div>
            )}
          </section>
          <section className="crm-suite-surface">
            <h2>Active routing policies</h2>
            <div className="crm-suite-list">
              {policies.map((policy) => (
                <article key={String(policy.id)}>
                  <div>
                    <strong>{String(policy.name)}</strong>
                    <small>
                      #{String(policy.sequence)} · {nice(policy.mode)} ·{" "}
                      {Object.keys((policy.criteria || {}) as object).length
                        ? JSON.stringify(policy.criteria)
                        : "all matching leads"}
                    </small>
                  </div>
                  <span>
                    {String(
                      policy.assignee_name ||
                        policy.territory_name ||
                        (Array.isArray(policy.member_user_ids)
                          ? `${policy.member_user_ids.length} members`
                          : "configured"),
                    )}
                  </span>
                  {canManageRouting ? (
                    <button
                      className="link-button danger"
                      type="button"
                      onClick={async () => {
                        if (!confirm("Disable this routing policy?")) return;
                        await api(
                          "/api/crm/leads/assignment-policies",
                          { action: "archive", policyId: policy.id },
                          "policy",
                        );
                        await refreshPolicies();
                      }}
                    >
                      Disable
                    </button>
                  ) : null}
                </article>
              ))}
              {!policies.length ? (
                <p>
                  No active routing policies. Leads without a matching policy
                  keep the supplied owner or normal fallback.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
