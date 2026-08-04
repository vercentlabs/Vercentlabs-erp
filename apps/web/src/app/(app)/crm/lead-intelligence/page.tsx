import {
  getCrmLeadIntelligenceReadiness,
  getLeadIntelligenceDashboard,
} from "@vercentlabs/api";

import AccessDenied from "@/components/access-denied";
import CrmActionWorkbench, {
  type CrmActionDefinition,
} from "@/components/crm/crm-action-workbench";
import CrmWorkspaceShell from "@/components/crm/crm-workspace-shell";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";
type Row = Record<string, unknown>;

const actions: CrmActionDefinition[] = [
  {
    id: "behavior-event",
    label: "Record behaviour event",
    description:
      "Add an idempotent marketing, product or seller signal to a lead.",
    endpoint: "/api/crm/lead-intelligence/events",
    fields: [
      { name: "leadId", label: "Lead ID", required: true },
      { name: "eventType", label: "Event type", required: true },
      { name: "eventKey", label: "Event key", required: true },
      { name: "occurredAt", label: "Occurred at", type: "datetime-local" },
      { name: "value", label: "Signal value", type: "number", defaultValue: 1 },
      { name: "metadata", label: "Metadata", type: "json", defaultValue: {} },
    ],
  },
  {
    id: "score",
    label: "Recalculate lead score",
    description: "Run the active explainable scoring model for a lead.",
    endpoint: "/api/crm/lead-intelligence/scores/{leadId}",
    fields: [
      { name: "leadId", label: "Lead ID", path: true, required: true },
      { name: "reason", label: "Reason", defaultValue: "Manual recalculation" },
    ],
  },
  {
    id: "open-sla",
    label: "Open SLA case",
    description: "Calculate a business-hours-aware response deadline.",
    endpoint: "/api/crm/lead-intelligence/sla",
    fixedBody: { action: "open" },
    fields: [
      { name: "leadId", label: "Lead ID", required: true },
      { name: "policyId", label: "SLA policy ID" },
      { name: "openedAt", label: "Opened at", type: "datetime-local" },
    ],
  },
  {
    id: "response",
    label: "Record first response",
    description: "Close the active SLA case with response evidence.",
    endpoint: "/api/crm/lead-intelligence/sla",
    fixedBody: { action: "respond" },
    fields: [
      { name: "leadId", label: "Lead ID", required: true },
      { name: "respondedAt", label: "Responded at", type: "datetime-local" },
      { name: "channel", label: "Channel", defaultValue: "email" },
      { name: "evidenceId", label: "Communication or activity ID" },
    ],
  },
  {
    id: "scan-sla",
    label: "Scan SLA breaches",
    description: "Escalate overdue lead response cases.",
    endpoint: "/api/crm/lead-intelligence/sla",
    fixedBody: { action: "scan" },
    fields: [{ name: "now", label: "Evaluation time", type: "datetime-local" }],
  },
  {
    id: "refresh-nurture",
    label: "Refresh nurture queue",
    description:
      "Rebuild seller priorities from score, SLA, consent and recency.",
    endpoint: "/api/crm/lead-intelligence/nurture",
    fixedBody: { action: "refresh" },
  },
  {
    id: "update-nurture",
    label: "Update nurture item",
    description: "Claim, complete, snooze or exit a seller work item.",
    endpoint: "/api/crm/lead-intelligence/nurture",
    fields: [
      { name: "itemId", label: "Queue item ID", required: true },
      {
        name: "action",
        label: "Action",
        type: "select",
        required: true,
        defaultValue: "claim",
        options: [
          { label: "Claim", value: "claim" },
          { label: "Complete", value: "complete" },
          { label: "Snooze", value: "snooze" },
          { label: "Exit", value: "exit" },
          { label: "Reopen", value: "reopen" },
        ],
      },
      { name: "snoozedUntil", label: "Snoozed until", type: "datetime-local" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
];

export default async function LeadIntelligencePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return <AccessDenied area="lead intelligence" returnHref="/crm" />;
  }
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getLeadIntelligenceDashboard(client, context),
        getCrmLeadIntelligenceReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const grades = (dashboard.grades || []) as Row[];
  const sla = (dashboard.sla || []) as Row[];
  const queue = (dashboard.topQueue || []) as Row[];

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/leads", label: "Leads" },
        { href: "/crm/activities", label: "Activities" },
        { href: "/crm/readiness", label: "CRM readiness" },
      ]}
      description="Operate explainable scoring, response deadlines, escalations and the consent-aware seller nurture queue."
      eyebrow="Lead intelligence"
      metrics={[
        { label: "Active leads", value: String(summary.active_leads ?? 0) },
        {
          label: "Qualified",
          value: String(summary.qualified_leads ?? 0),
          tone: "success",
        },
        { label: "Average score", value: String(summary.average_score ?? 0) },
        {
          label: "Unscored leads",
          value: String(summary.unscored_leads ?? 0),
          tone: Number(summary.unscored_leads || 0) ? "warning" : "success",
        },
      ]}
      status={`${String(readiness.readiness || "blocked")} · ${String(readiness.score || 0)}%`}
      statusTone={readiness.readiness === "ready" ? "success" : "warning"}
      title="Scoring, SLA and nurture priorities"
    >
      <CrmActionWorkbench actions={actions} />
      <div className="crm-product-data-grid">
        <section className="panel">
          <h2>Lead grades</h2>
          <div className="crm-stage-summary">
            {grades.length ? (
              grades.map((row) => (
                <div key={String(row.lead_grade)}>
                  <span>
                    <strong>{String(row.lead_grade)}</strong>
                  </span>
                  <b>{String(row.leads)}</b>
                </div>
              ))
            ) : (
              <p>No scored leads.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>SLA cases</h2>
          <div className="crm-stage-summary">
            {sla.length ? (
              sla.map((row) => (
                <div key={String(row.status)}>
                  <span>
                    <strong>{String(row.status)}</strong>
                  </span>
                  <b>{String(row.cases)}</b>
                </div>
              ))
            ) : (
              <p>No SLA cases.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Seller nurture queue</h2>
          <div className="crm-stage-summary">
            {queue.length ? (
              queue.slice(0, 10).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>
                      {String(row.full_name || row.company_name || row.code)}
                    </strong>
                    <small>
                      {String(row.recommended_action)} · score{" "}
                      {String(row.score)}
                    </small>
                  </span>
                  <b>{String(row.priority_score)}</b>
                </div>
              ))
            ) : (
              <p>No active nurture work.</p>
            )}
          </div>
        </section>
      </div>
    </CrmWorkspaceShell>
  );
}
