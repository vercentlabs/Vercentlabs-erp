"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { requestJson } from "@/shared/http/client-request";
import { ActionButton, FormField, SectionHeader, StatePanel, StatusBadge, Surface } from "@/shared/design";
import TimelinePanel from "@/modules/crm/components/timeline-panel";
import NotesPanel from "@/modules/crm/components/notes-panel";
import AttachmentsPanel from "@/modules/crm/components/attachments-panel";

type Row = Record<string, unknown>;
type User = { id: string; fullName: string };
type Competitor = { id: string; name: string };

type Props = {
  opportunityId: string;
  partyId: string | null;
  currentUserId: string;
  canManage: boolean;
  canManageRisks: boolean;
  canManageStakeholders: boolean;
  opportunityStatus: string;
  currencyCode: string;
  items: Row[];
  team: Row[];
  competitors: Row[];
  risks: Row[];
  committees: Row[];
  committeeMembers: Row[];
  actionPlan: Row | null;
  actionPlanEvaluation: Row | null;
  winLossReview: Row | null;
  quotations: Row[];
  users: User[];
  allCompetitors: Competitor[];
  history: Row[];
  probabilityHistory: Row[];
};

const TABS = ["overview", "products", "stakeholders", "team", "risks", "plan", "related", "notes", "history"] as const;
type Tab = (typeof TABS)[number];

function tabLabel(tab: Tab) {
  switch (tab) {
    case "overview": return "Overview";
    case "products": return "Products";
    case "stakeholders": return "Stakeholders";
    case "team": return "Team";
    case "risks": return "Risks";
    case "plan": return "Plan";
    case "related": return "Related";
    case "notes": return "Notes & Files";
    case "history": return "History";
  }
}

function money(value: unknown, currency: string) {
  return new Intl.NumberFormat("en-IN", { style: "currency", currency, minimumFractionDigits: 0, maximumFractionDigits: 2 }).format(Number(value || 0));
}
function dateOnly(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(date);
}
function dateTime(value: unknown) {
  if (!value) return "—";
  const date = new Date(String(value));
  return Number.isNaN(date.getTime()) ? String(value) : new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(date);
}
function nice(value: unknown) {
  return String(value ?? "—").replaceAll("_", " ").replace(/^./, (c) => c.toUpperCase());
}

export default function OpportunityWorkspaceTabs(props: Props) {
  const { canManage, canManageRisks, canManageStakeholders, opportunityStatus } = props;
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("overview");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const editable = canManage && opportunityStatus === "open";

  async function post(path: string, body: Record<string, unknown>) {
    setPending(true);
    setMessage("");
    try {
      const result = await requestJson(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!result.ok) throw new Error(result.message || "That action could not be completed.");
      setMessage(result.message || "Saved.");
      router.refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That action could not be completed.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function patch(path: string, body: Record<string, unknown>) {
    setPending(true);
    setMessage("");
    try {
      const result = await requestJson(path, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!result.ok) throw new Error(result.message || "That action could not be completed.");
      setMessage(result.message || "Saved.");
      router.refresh();
      return true;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That action could not be completed.");
      return false;
    } finally {
      setPending(false);
    }
  }

  async function del(path: string) {
    setPending(true);
    setMessage("");
    try {
      const result = await requestJson(path, { method: "DELETE" });
      if (!result.ok) throw new Error(result.message || "That action could not be completed.");
      setMessage(result.message || "Removed.");
      router.refresh();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "That action could not be completed.");
    } finally {
      setPending(false);
    }
  }

  return (
    <section aria-label="Opportunity record sections">
      <label className="lead-detail-section-picker">
        <span>Record section</span>
        <select value={tab} onChange={(event) => setTab(event.target.value as Tab)}>
          {TABS.map((item) => (
            <option key={item} value={item}>
              {tabLabel(item)}
            </option>
          ))}
        </select>
      </label>
      <nav
        className="crm-suite-tabs lead-detail-tabs"
        aria-label="Opportunity record sections"
        role="tablist"
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const current = TABS.indexOf(tab);
          const next = event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : (current + (event.key === "ArrowRight" ? 1 : -1) + TABS.length) % TABS.length;
          setTab(TABS[next]);
          window.requestAnimationFrame(() => document.getElementById(`opportunity-tab-${TABS[next]}`)?.focus());
        }}
      >
        {TABS.map((item) => (
          <button
            key={item}
            id={`opportunity-tab-${item}`}
            type="button"
            role="tab"
            aria-selected={tab === item}
            aria-controls={`opportunity-panel-${item}`}
            tabIndex={tab === item ? 0 : -1}
            className={tab === item ? "active" : ""}
            onClick={() => setTab(item)}
          >
            {tabLabel(item)}
          </button>
        ))}
      </nav>

      {message ? <p className="notice" role="status">{message}</p> : null}

      <div id={`opportunity-panel-${tab}`} className="crm-lead-tab-panel" role="tabpanel" aria-labelledby={`opportunity-tab-${tab}`}>
        {tab === "overview" ? <OverviewPanel {...props} /> : null}
        {tab === "products" ? <ProductsPanel {...props} editable={editable} pending={pending} post={post} del={del} /> : null}
        {tab === "stakeholders" ? <StakeholdersPanel {...props} editable={canManageStakeholders && opportunityStatus !== "archived"} pending={pending} post={post} del={del} /> : null}
        {tab === "team" ? <TeamPanel {...props} editable={editable} pending={pending} post={post} del={del} /> : null}
        {tab === "risks" ? <RisksPanel {...props} editable={canManageRisks} pending={pending} post={post} patch={patch} /> : null}
        {tab === "plan" ? <PlanPanel {...props} editable={editable} pending={pending} post={post} /> : null}
        {tab === "related" ? <RelatedPanel {...props} editable={editable} pending={pending} post={post} del={del} /> : null}
        {tab === "notes" ? (
          <>
            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Notes" title="Internal notes" />
              <NotesPanel listEndpoint={`/api/crm/opportunities/${props.opportunityId}/notes`} currentUserId={props.currentUserId} canManage={canManage} />
            </Surface>
            <Surface as="section" className="crm-suite-surface">
              <SectionHeader eyebrow="Files" title="Attachments" />
              <AttachmentsPanel listEndpoint={`/api/crm/opportunities/${props.opportunityId}/attachments`} canManage={canManage} />
            </Surface>
          </>
        ) : null}
        {tab === "history" ? <HistoryPanel {...props} /> : null}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

function OverviewPanel(props: Props) {
  const { items, team, risks, committeeMembers, actionPlanEvaluation, currencyCode } = props;
  const openRisks = risks.filter((risk) => risk.status === "open" || risk.status === "acknowledged");
  const primaryStakeholder = committeeMembers.find((member) => member.memberRole === "economic_buyer") || committeeMembers[0];
  return (
    <div className="crm-lead-detail-overview">
      <Surface as="section" className="crm-suite-surface">
        <SectionHeader eyebrow="Commercial snapshot" title="What matters right now" />
        <dl className="crm-lead-profile-grid">
          <div><dt>Products</dt><dd>{items.length} line item(s)</dd></div>
          <div><dt>Deal team</dt><dd>{team.length} member(s)</dd></div>
          <div><dt>Open risks</dt><dd>{openRisks.length ? <StatusBadge tone="danger">{openRisks.length} open</StatusBadge> : "None"}</dd></div>
          <div><dt>Key stakeholder</dt><dd>{primaryStakeholder ? `${String(primaryStakeholder.name)} · ${nice(primaryStakeholder.memberRole)}` : "Not identified"}</dd></div>
          <div><dt>Mutual action plan</dt><dd>{actionPlanEvaluation ? `${Number(actionPlanEvaluation.completedCount || 0)}/${Number(actionPlanEvaluation.totalCount || 0)} milestones complete` : "No plan yet"}</dd></div>
        </dl>
      </Surface>
      {openRisks.length ? (
        <Surface as="section" className="crm-suite-surface">
          <SectionHeader eyebrow="Attention" title="Open deal risks" />
          <div className="crm-stage-summary">
            {openRisks.slice(0, 5).map((risk) => (
              <div key={String(risk.id)}><span><StatusBadge tone={risk.severity === "critical" || risk.severity === "high" ? "danger" : "warning"}>{nice(risk.severity)}</StatusBadge> {String(risk.title)}</span></div>
            ))}
          </div>
        </Surface>
      ) : null}
      <Surface as="section" className="crm-suite-surface">
        <SectionHeader eyebrow="Products & services" title="What's included" />
        <div className="crm-stage-summary">
          {items.map((item) => (
            <div key={String(item.id)}><span><strong>{String(item.itemName)}</strong><small>{String(item.quantity)} × {money(item.unitPrice, currencyCode)}</small></span><b>{money(item.lineTotal, currencyCode)}</b></div>
          ))}
          {!items.length ? <StatePanel title="No products or services added yet." /> : null}
        </div>
      </Surface>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

function ProductsPanel({ opportunityId, items, currencyCode, editable, pending, post, del }: Props & { editable: boolean; pending: boolean; post: (path: string, body: Record<string, unknown>) => Promise<boolean>; del: (path: string) => Promise<void> }) {
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [unitPrice, setUnitPrice] = useState("");
  const [discountPercent, setDiscountPercent] = useState("0");

  async function addItem() {
    const ok = await post(`/api/crm/opportunities/${opportunityId}/items`, {
      itemId,
      quantity: Number(quantity),
      unitPrice: unitPrice.trim() ? Number(unitPrice) : undefined,
      discountPercent: Number(discountPercent),
    });
    if (ok) { setItemId(""); setQuantity("1"); setUnitPrice(""); setDiscountPercent("0"); }
  }

  return (
    <Surface as="section" className="crm-suite-surface">
      <SectionHeader eyebrow="Commercial value" title="Products & services" />
      <div className="crm-stage-summary">
        {items.map((item) => (
          <div key={String(item.id)}>
            <span><strong>{String(item.itemName)}</strong><small>{String(item.quantity)} × {money(item.unitPrice, currencyCode)}{Number(item.discountPercent) ? ` · ${item.discountPercent}% off` : ""}</small></span>
            <b>{money(item.lineTotal, currencyCode)}</b>
            {editable ? (
              <ActionButton tone="danger" type="button" disabled={pending} onClick={() => void del(`/api/crm/opportunities/${opportunityId}/items/${String(item.id)}`)}>
                Remove
              </ActionButton>
            ) : null}
          </div>
        ))}
        {!items.length ? <StatePanel title="No products or services added yet." /> : null}
      </div>
      {editable ? (
        <div className="crm-inline-form">
          <FormField label="Product/service ID" htmlFor="opportunity-item-id">
            <input id="opportunity-item-id" value={itemId} onChange={(event) => setItemId(event.target.value)} placeholder="Item ID" disabled={pending} />
          </FormField>
          <FormField label="Quantity" htmlFor="opportunity-item-quantity">
            <input id="opportunity-item-quantity" type="number" min="0.01" step="0.01" value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={pending} />
          </FormField>
          <FormField label="Unit price (optional — defaults to catalogue price)" htmlFor="opportunity-item-price">
            <input id="opportunity-item-price" type="number" min="0" step="0.01" value={unitPrice} onChange={(event) => setUnitPrice(event.target.value)} disabled={pending} />
          </FormField>
          <FormField label="Discount %" htmlFor="opportunity-item-discount">
            <input id="opportunity-item-discount" type="number" min="0" max="100" step="0.01" value={discountPercent} onChange={(event) => setDiscountPercent(event.target.value)} disabled={pending} />
          </FormField>
          <ActionButton tone="primary" type="button" disabled={pending || !itemId} busy={pending} onClick={() => void addItem()}>
            Add product
          </ActionButton>
        </div>
      ) : null}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Stakeholders / buying committee
// ---------------------------------------------------------------------------

const MEMBER_ROLES = ["economic_buyer", "decision_maker", "champion", "influencer", "user", "blocker", "procurement", "legal", "technical"];
const INFLUENCE_LEVELS = ["low", "medium", "high", "critical"];

function StakeholdersPanel({ opportunityId, partyId, committees, committeeMembers, editable, pending, post, del }: Props & { editable: boolean; pending: boolean; post: (path: string, body: Record<string, unknown>) => Promise<boolean>; del: (path: string) => Promise<void> }) {
  const committee = committees[0] || null;
  const [name, setName] = useState("");
  const [role, setRole] = useState("influencer");
  const [influence, setInfluence] = useState("medium");

  async function createCommittee() {
    if (!partyId) return;
    await post("/api/crm/buying-committees", { opportunityId, partyId, name: "Buying committee", status: "active" });
  }
  async function addMember() {
    if (!committee) return;
    const ok = await post("/api/crm/buying-committee-members", {
      committeeId: String(committee.id), name, memberRole: role, influenceLevel: influence, status: "active",
    });
    if (ok) { setName(""); setRole("influencer"); setInfluence("medium"); }
  }

  return (
    <Surface as="section" className="crm-suite-surface">
      <SectionHeader eyebrow="Buying committee" title="Stakeholders" />
      {!committee ? (
        <>
          <StatePanel
            title={partyId ? "No buying committee identified yet." : "Link an Account before starting a buying committee."}
          />
          {editable && partyId ? <ActionButton tone="primary" type="button" disabled={pending} busy={pending} onClick={() => void createCommittee()}>Start a buying committee</ActionButton> : null}
        </>
      ) : (
        <>
          <div className="crm-stage-summary">
            {committeeMembers.map((member) => (
              <div key={String(member.id)}>
                <span>
                  <strong>{String(member.name)}</strong>
                  <small>{nice(member.memberRole)} · {nice(member.influenceLevel)} influence · {nice(member.sentiment)}</small>
                </span>
                {editable ? (
                  <ActionButton tone="danger" type="button" disabled={pending} onClick={() => void del(`/api/crm/${"buying-committee-members"}/${String(member.id)}`)}>
                    Remove
                  </ActionButton>
                ) : null}
              </div>
            ))}
            {!committeeMembers.length ? <StatePanel title="No stakeholders added yet — coverage gap." /> : null}
          </div>
          {editable ? (
            <div className="crm-inline-form">
              <FormField label="Name" htmlFor="stakeholder-name">
                <input id="stakeholder-name" value={name} onChange={(event) => setName(event.target.value)} disabled={pending} />
              </FormField>
              <FormField label="Role" htmlFor="stakeholder-role">
                <select id="stakeholder-role" value={role} onChange={(event) => setRole(event.target.value)} disabled={pending}>
                  {MEMBER_ROLES.map((value) => <option key={value} value={value}>{nice(value)}</option>)}
                </select>
              </FormField>
              <FormField label="Influence" htmlFor="stakeholder-influence">
                <select id="stakeholder-influence" value={influence} onChange={(event) => setInfluence(event.target.value)} disabled={pending}>
                  {INFLUENCE_LEVELS.map((value) => <option key={value} value={value}>{nice(value)}</option>)}
                </select>
              </FormField>
              <ActionButton tone="primary" type="button" disabled={pending || !name.trim()} busy={pending} onClick={() => void addMember()}>
                Add stakeholder
              </ActionButton>
            </div>
          ) : null}
        </>
      )}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Team
// ---------------------------------------------------------------------------

const ACCESS_LEVELS = ["view", "edit", "manager"];

function TeamPanel({ opportunityId, team, users, editable, pending, post, del }: Props & { editable: boolean; pending: boolean; post: (path: string, body: Record<string, unknown>) => Promise<boolean>; del: (path: string) => Promise<void> }) {
  const [userId, setUserId] = useState("");
  const [teamRole, setTeamRole] = useState("contributor");
  const [accessLevel, setAccessLevel] = useState("view");

  async function addMember() {
    const ok = await post(`/api/crm/opportunities/${opportunityId}/team`, { userId, teamRole, accessLevel });
    if (ok) { setUserId(""); setTeamRole("contributor"); setAccessLevel("view"); }
  }

  return (
    <Surface as="section" className="crm-suite-surface">
      <SectionHeader eyebrow="Deal team" title="Who's working this deal" />
      <div className="crm-stage-summary">
        {team.map((member) => (
          <div key={String(member.id)}>
            <span><strong>{String(member.fullName)}</strong><small>{nice(member.teamRole)} · {nice(member.accessLevel)} access</small></span>
            {editable ? (
              <ActionButton tone="danger" type="button" disabled={pending} onClick={() => void del(`/api/crm/opportunities/${opportunityId}/team/${String(member.id)}`)}>
                Remove
              </ActionButton>
            ) : null}
          </div>
        ))}
        {!team.length ? <StatePanel title="No team members added yet — the owner is the only participant." /> : null}
      </div>
      {editable ? (
        <div className="crm-inline-form">
          <FormField label="Team member" htmlFor="team-member-user">
            <select id="team-member-user" value={userId} onChange={(event) => setUserId(event.target.value)} disabled={pending}>
              <option value="">Choose a user…</option>
              {users.map((user) => <option key={user.id} value={user.id}>{user.fullName}</option>)}
            </select>
          </FormField>
          <FormField label="Role" htmlFor="team-member-role">
            <input id="team-member-role" value={teamRole} onChange={(event) => setTeamRole(event.target.value)} placeholder="e.g. Solutions engineer" disabled={pending} />
          </FormField>
          <FormField label="Access" htmlFor="team-member-access">
            <select id="team-member-access" value={accessLevel} onChange={(event) => setAccessLevel(event.target.value)} disabled={pending}>
              {ACCESS_LEVELS.map((value) => <option key={value} value={value}>{nice(value)}</option>)}
            </select>
          </FormField>
          <ActionButton tone="primary" type="button" disabled={pending || !userId} busy={pending} onClick={() => void addMember()}>
            Add to team
          </ActionButton>
        </div>
      ) : null}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Risks
// ---------------------------------------------------------------------------

const RISK_TYPES = ["stale_activity", "close_date_slip", "missing_stakeholder", "missing_next_step", "low_engagement", "competitor", "pricing", "qualification", "forecast", "custom"];
const RISK_SEVERITIES = ["low", "medium", "high", "critical"];

function RisksPanel({ opportunityId, risks, editable, pending, post, patch }: Props & { editable: boolean; pending: boolean; post: (path: string, body: Record<string, unknown>) => Promise<boolean>; patch: (path: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const [title, setTitle] = useState("");
  const [riskType, setRiskType] = useState("custom");
  const [severity, setSeverity] = useState("medium");

  async function addRisk() {
    const ok = await post("/api/crm/deal-risks", { opportunityId, title, riskType, severity, status: "open" });
    if (ok) { setTitle(""); setRiskType("custom"); setSeverity("medium"); }
  }
  async function resolveRisk(id: string) {
    await patch(`/api/crm/deal-risks/${id}`, { status: "resolved" });
  }

  return (
    <Surface as="section" className="crm-suite-surface">
      <SectionHeader eyebrow="Deal risks" title="What could stop this deal" />
      <div className="crm-stage-summary">
        {risks.map((risk) => (
          <div key={String(risk.id)}>
            <span>
              <StatusBadge tone={risk.severity === "critical" || risk.severity === "high" ? "danger" : risk.status === "resolved" ? "success" : "warning"}>{nice(risk.severity)}</StatusBadge>{" "}
              <strong>{String(risk.title)}</strong>
              <small>{nice(risk.riskType)} · {nice(risk.status)}</small>
            </span>
            {editable && risk.status !== "resolved" ? (
              <ActionButton tone="secondary" type="button" disabled={pending} onClick={() => void resolveRisk(String(risk.id))}>
                Mark resolved
              </ActionButton>
            ) : null}
          </div>
        ))}
        {!risks.length ? <StatePanel title="No risks recorded — keep it that way." /> : null}
      </div>
      {editable ? (
        <div className="crm-inline-form">
          <FormField label="Risk" htmlFor="risk-title">
            <input id="risk-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder="e.g. Budget not yet confirmed" disabled={pending} />
          </FormField>
          <FormField label="Type" htmlFor="risk-type">
            <select id="risk-type" value={riskType} onChange={(event) => setRiskType(event.target.value)} disabled={pending}>
              {RISK_TYPES.map((value) => <option key={value} value={value}>{nice(value)}</option>)}
            </select>
          </FormField>
          <FormField label="Severity" htmlFor="risk-severity">
            <select id="risk-severity" value={severity} onChange={(event) => setSeverity(event.target.value)} disabled={pending}>
              {RISK_SEVERITIES.map((value) => <option key={value} value={value}>{nice(value)}</option>)}
            </select>
          </FormField>
          <ActionButton tone="primary" type="button" disabled={pending || !title.trim()} busy={pending} onClick={() => void addRisk()}>
            Log risk
          </ActionButton>
        </div>
      ) : null}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Mutual action plan
// ---------------------------------------------------------------------------

function PlanPanel({ opportunityId, actionPlan, editable, pending, post }: Props & { editable: boolean; pending: boolean; post: (path: string, body: Record<string, unknown>) => Promise<boolean> }) {
  const [milestoneTitle, setMilestoneTitle] = useState("");
  const [dueDate, setDueDate] = useState("");
  const milestones = (actionPlan?.milestones as Row[] | undefined) || [];

  async function createPlan() {
    await post("/api/crm/opportunity-revenue", { action: "save-action-plan", opportunityId, name: "Mutual action plan", milestones: [] });
  }
  async function addMilestone() {
    const nextMilestones = [
      ...milestones.map((m) => ({ title: m.title, dueDate: m.dueDate, required: m.required, status: m.status })),
      { title: milestoneTitle, dueDate: dueDate || null, required: true, status: "planned" },
    ];
    const ok = await post("/api/crm/opportunity-revenue", { action: "save-action-plan", opportunityId, name: String(actionPlan?.name || "Mutual action plan"), milestones: nextMilestones });
    if (ok) { setMilestoneTitle(""); setDueDate(""); }
  }

  return (
    <Surface as="section" className="crm-suite-surface">
      <SectionHeader eyebrow="Commercial plan" title="Mutual action plan" />
      {!actionPlan ? (
        <>
          <StatePanel title="No mutual action plan started yet." />
          {editable ? <ActionButton tone="primary" type="button" disabled={pending} busy={pending} onClick={() => void createPlan()}>Start a plan</ActionButton> : null}
        </>
      ) : (
        <>
          <div className="crm-stage-summary">
            {milestones.map((milestone) => {
              const overdue = milestone.dueDate && milestone.status !== "completed" && new Date(String(milestone.dueDate)) < new Date();
              return (
                <div key={String(milestone.id ?? milestone.sequence)}>
                  <span>
                    <strong>{String(milestone.title)}</strong>
                    <small>Due {dateOnly(milestone.dueDate)}{overdue ? " · overdue" : ""}</small>
                  </span>
                  <StatusBadge tone={milestone.status === "completed" ? "success" : overdue ? "danger" : "neutral"}>{nice(milestone.status)}</StatusBadge>
                </div>
              );
            })}
            {!milestones.length ? <StatePanel title="No milestones yet." /> : null}
          </div>
          {editable ? (
            <div className="crm-inline-form">
              <FormField label="Milestone" htmlFor="milestone-title">
                <input id="milestone-title" value={milestoneTitle} onChange={(event) => setMilestoneTitle(event.target.value)} disabled={pending} />
              </FormField>
              <FormField label="Due date" htmlFor="milestone-due">
                <input id="milestone-due" type="date" value={dueDate} onChange={(event) => setDueDate(event.target.value)} disabled={pending} />
              </FormField>
              <ActionButton tone="primary" type="button" disabled={pending || !milestoneTitle.trim()} busy={pending} onClick={() => void addMilestone()}>
                Add milestone
              </ActionButton>
            </div>
          ) : null}
        </>
      )}
    </Surface>
  );
}

// ---------------------------------------------------------------------------
// Related: competitors, quotations, win/loss review
// ---------------------------------------------------------------------------

function RelatedPanel({ opportunityId, competitors, allCompetitors, quotations, winLossReview, opportunityStatus, editable, pending, post, del }: Props & { editable: boolean; pending: boolean; post: (path: string, body: Record<string, unknown>) => Promise<boolean>; del: (path: string) => Promise<void> }) {
  const [competitorId, setCompetitorId] = useState("");

  async function addCompetitor() {
    const ok = await post(`/api/crm/opportunities/${opportunityId}/competitors`, { competitorId });
    if (ok) setCompetitorId("");
  }

  return (
    <>
      <Surface as="section" className="crm-suite-surface">
        <SectionHeader eyebrow="Competitive context" title="Competitors" />
        <div className="crm-stage-summary">
          {competitors.map((competitor) => (
            <div key={String(competitor.competitorId)}>
              <span>{competitor.isPrimary ? <StatusBadge tone="warning">Primary</StatusBadge> : null} <strong>{String(competitor.name)}</strong></span>
              {editable ? (
                <ActionButton tone="danger" type="button" disabled={pending} onClick={() => void del(`/api/crm/opportunities/${opportunityId}/competitors/${String(competitor.competitorId)}`)}>
                  Unlink
                </ActionButton>
              ) : null}
            </div>
          ))}
          {!competitors.length ? <StatePanel title="No competitors identified on this deal." /> : null}
        </div>
        {editable ? (
          <div className="crm-inline-form">
            <FormField label="Competitor" htmlFor="competitor-picker">
              <select id="competitor-picker" value={competitorId} onChange={(event) => setCompetitorId(event.target.value)} disabled={pending}>
                <option value="">Choose a competitor…</option>
                {allCompetitors.map((competitor) => <option key={competitor.id} value={competitor.id}>{competitor.name}</option>)}
              </select>
            </FormField>
            <ActionButton tone="primary" type="button" disabled={pending || !competitorId} busy={pending} onClick={() => void addCompetitor()}>
              Link competitor
            </ActionButton>
          </div>
        ) : null}
      </Surface>

      <Surface as="section" className="crm-suite-surface">
        <SectionHeader eyebrow="Sales handoff" title="Quotations" />
        <div className="crm-stage-summary">
          {quotations.map((quotation) => (
            <div key={String(quotation.id)}><span><strong>{String(quotation.quotationNumber)}</strong><small>{dateTime(quotation.createdAt)}</small></span><StatusBadge tone="neutral">{nice(quotation.lifecycleStatus)}</StatusBadge></div>
          ))}
          {!quotations.length ? <StatePanel title="No quotations created from this Opportunity yet." /> : null}
        </div>
      </Surface>

      {["won", "lost"].includes(opportunityStatus) ? (
        <Surface as="section" className="crm-suite-surface">
          <SectionHeader eyebrow="Post-mortem" title="Win / loss review" />
          {winLossReview ? (
            <dl className="crm-lead-profile-grid">
              <div><dt>Primary reason</dt><dd>{String(winLossReview.primaryReason)}</dd></div>
              <div><dt>Competitor</dt><dd>{String(winLossReview.competitorName || "—")}</dd></div>
              <div><dt>Sales cycle</dt><dd>{String(winLossReview.salesCycleDays)} days</dd></div>
            </dl>
          ) : (
            <StatePanel title="No win/loss review submitted yet." />
          )}
        </Surface>
      ) : null}
    </>
  );
}

// ---------------------------------------------------------------------------
// History
// ---------------------------------------------------------------------------

function HistoryPanel({ history, probabilityHistory, opportunityId }: Props) {
  return (
    <>
      <Surface as="section" className="crm-suite-surface">
        <SectionHeader eyebrow="Stage history" title="Pipeline movement" />
        <div className="crm-timeline">
          {history.map((row) => (
            <article key={String(row.id)}><span>→</span><div><strong>{String(row.from_stage || "Created")} → {String(row.to_stage || "Stage")}</strong>{row.outcome_reason_label ? <p><em>{nice(row.status)} reason at the time: {String(row.outcome_reason_label)}</em></p> : null}<p>{String(row.note || "")}</p><time>{dateTime(row.changed_at)}</time></div></article>
          ))}
          {!history.length ? <StatePanel title="No stage movement recorded yet." /> : null}
        </div>
      </Surface>
      <Surface as="section" className="crm-suite-surface">
        <SectionHeader eyebrow="Probability history" title="Revenue confidence changes" />
        <div className="crm-timeline">
          {probabilityHistory.map((row) => (
            <article key={String(row.id)}><span>%</span><div><strong>{String(row.from_probability)}% → {String(row.to_probability)}%</strong><p><StatusBadge tone="neutral">{row.source ? nice(row.source) : "Legacy · source not recorded"}</StatusBadge> {String(row.note || "")}</p><time>{dateTime(row.changed_at)}</time></div></article>
          ))}
          {!probabilityHistory.length ? <StatePanel title="No probability changes recorded yet." /> : null}
        </div>
      </Surface>
      <Surface as="section" className="crm-suite-surface">
        <SectionHeader eyebrow="Timeline" title="Activities, communications, notes and files" />
        {/* F019 closeout: Opportunity previously had no timeline at all
            beyond this tab's own static, unpaginated 40-row snapshot (see
            page.tsx's `timeline` array) — now backed by the SAME canonical,
            cursor-paginated, permission-gated projection Account/Contact
            already use (timeline.js's getCrmTimelinePage), rather than a
            fourth hand-rolled implementation. Stage/probability stay their
            own panels above, matching the canonical service's own
            documented scope decision. */}
        <TimelinePanel endpoint={`/api/crm/opportunities/${opportunityId}/timeline`} />
      </Surface>
    </>
  );
}
