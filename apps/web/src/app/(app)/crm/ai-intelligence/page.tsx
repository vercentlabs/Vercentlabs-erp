import { getCrmAiDashboard, getCrmAiReadiness } from "@vercentlabs/api";

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
    id: "next-best-action",
    label: "Recommend next action",
    description: "Rank a governed, explainable action for a CRM record.",
    endpoint: "/api/crm/ai-intelligence",
    fixedBody: { action: "next-best-action" },
    fields: [
      {
        name: "entityType",
        label: "Record type",
        type: "select",
        required: true,
        defaultValue: "lead",
        options: [
          { label: "Lead", value: "lead" },
          { label: "Opportunity", value: "opportunity" },
          { label: "Account", value: "account" },
        ],
      },
      {
        name: "entityId",
        label: "Record ID",
        required: true,
        placeholder: "UUID",
      },
      {
        name: "candidates",
        label: "Action candidates",
        type: "json",
        required: true,
        defaultValue: [
          {
            key: "follow-up",
            label: "Schedule a follow-up",
            score: 80,
            reasons: ["No activity in seven days"],
          },
        ],
      },
    ],
  },
  {
    id: "assistant-draft",
    label: "Create grounded draft",
    description: "Prepare a review-required message from supplied facts.",
    endpoint: "/api/crm/ai-intelligence",
    fixedBody: { action: "draft" },
    fields: [
      {
        name: "entityType",
        label: "Record type",
        type: "select",
        defaultValue: "lead",
        options: [
          { label: "Lead", value: "lead" },
          { label: "Opportunity", value: "opportunity" },
          { label: "Account", value: "account" },
        ],
      },
      { name: "entityId", label: "Record ID", placeholder: "UUID" },
      {
        name: "purpose",
        label: "Purpose",
        defaultValue: "follow-up",
        required: true,
      },
      { name: "subject", label: "Subject" },
      {
        name: "facts",
        label: "Grounded facts",
        type: "json",
        required: true,
        defaultValue: [
          "The customer requested an ERP demonstration.",
          "The next review is planned for Friday.",
        ],
      },
      {
        name: "nextStep",
        label: "Next step",
        defaultValue: "Confirm the preferred meeting time.",
      },
      {
        name: "context",
        label: "Redactable context",
        type: "json",
        defaultValue: {},
      },
    ],
  },
  {
    id: "provider-draft",
    label: "Create provider-backed draft",
    description:
      "Use the configured external model while preserving grounding and human approval.",
    endpoint: "/api/crm/ai-intelligence",
    fixedBody: { action: "draft-provider" },
    fields: [
      {
        name: "entityType",
        label: "Record type",
        type: "select",
        defaultValue: "lead",
        options: [
          { label: "Lead", value: "lead" },
          { label: "Opportunity", value: "opportunity" },
          { label: "Account", value: "account" },
        ],
      },
      { name: "entityId", label: "Record ID", placeholder: "UUID" },
      {
        name: "purpose",
        label: "Purpose",
        defaultValue: "follow-up",
        required: true,
      },
      { name: "subject", label: "Subject" },
      {
        name: "facts",
        label: "Grounded facts",
        type: "json",
        required: true,
        defaultValue: [
          "The customer requested an ERP demonstration.",
          "The next review is planned for Friday.",
        ],
      },
      {
        name: "nextStep",
        label: "Next step",
        defaultValue: "Confirm the preferred meeting time.",
      },
      {
        name: "context",
        label: "Redactable context",
        type: "json",
        defaultValue: {},
      },
    ],
  },
  {
    id: "relationship",
    label: "Capture relationship intelligence",
    description: "Create an explainable relationship-strength snapshot.",
    endpoint: "/api/crm/ai-intelligence",
    fixedBody: { action: "relationship", entityType: "party" },
    fields: [
      { name: "entityId", label: "Account or contact ID", required: true },
      {
        name: "daysSinceLastInteraction",
        label: "Days since interaction",
        type: "number",
        defaultValue: 7,
      },
      {
        name: "interactionCount90d",
        label: "Interactions in 90 days",
        type: "number",
        defaultValue: 5,
      },
      {
        name: "responseRate",
        label: "Response rate (%)",
        type: "number",
        defaultValue: 70,
      },
      {
        name: "sentiment",
        label: "Sentiment",
        type: "select",
        defaultValue: "positive",
        options: [
          { label: "Positive", value: "positive" },
          { label: "Neutral", value: "neutral" },
          { label: "Negative", value: "negative" },
        ],
      },
    ],
  },
  {
    id: "deal-risk",
    label: "Capture deal risk",
    description: "Store an auditable risk snapshot for an opportunity.",
    endpoint: "/api/crm/ai-intelligence",
    fixedBody: { action: "deal-risk" },
    fields: [
      { name: "opportunityId", label: "Opportunity ID", required: true },
      {
        name: "probability",
        label: "Probability (%)",
        type: "number",
        defaultValue: 40,
      },
      {
        name: "daysWithoutActivity",
        label: "Days without activity",
        type: "number",
        defaultValue: 14,
      },
      {
        name: "closeOverdue",
        label: "Expected close date is overdue",
        type: "checkbox",
      },
      {
        name: "missingDecisionMaker",
        label: "Decision maker is missing",
        type: "checkbox",
      },
    ],
  },
  {
    id: "feedback",
    label: "Record AI feedback",
    description: "Accept, reject or correct a recommendation or draft.",
    endpoint: "/api/crm/ai-intelligence",
    fixedBody: { action: "feedback" },
    fields: [
      { name: "recommendationId", label: "Recommendation ID" },
      { name: "draftId", label: "Draft ID" },
      {
        name: "outcome",
        label: "Outcome",
        type: "select",
        required: true,
        defaultValue: "accepted",
        options: [
          { label: "Accepted", value: "accepted" },
          { label: "Rejected", value: "rejected" },
          { label: "Edited", value: "edited" },
        ],
      },
      { name: "reason", label: "Reason", type: "textarea" },
      {
        name: "correction",
        label: "Correction",
        type: "json",
        defaultValue: {},
      },
    ],
  },
];

export default async function AiPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return <AccessDenied area="CRM intelligence" returnHref="/crm" />;
  }
  const context = crmContext(session);
  const { dashboard, readiness } = (await tenantTransaction(
    context.organizationId,
    async (client) => ({
      dashboard: await getCrmAiDashboard(client, context),
      readiness: await getCrmAiReadiness(client, context),
    }),
  )) as { dashboard: Row; readiness: Row };

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/opportunities", label: "Open opportunities" },
        { href: "/crm/communications", label: "Communications" },
        { href: "/crm/readiness", label: "CRM readiness" },
      ]}
      description="Review explainable recommendations, grounded drafts, relationship signals and deal risk with mandatory human approval."
      eyebrow="CRM intelligence"
      metrics={[
        {
          label: "Pending recommendations",
          value: String(dashboard.pending_recommendations ?? 0),
        },
        {
          label: "Drafts to review",
          value: String(dashboard.drafts_to_review ?? 0),
        },
        {
          label: "Relationship score",
          value: String(dashboard.relationship_score ?? 0),
        },
        {
          label: "High-risk deals",
          value: String(dashboard.risky_deals ?? 0),
          tone: Number(dashboard.risky_deals || 0) ? "warning" : "success",
        },
      ]}
      status={`${String(readiness.readiness || "blocked")} · ${String(readiness.passed || 0)}/${String(readiness.total || 4)}`}
      statusTone={readiness.readiness === "ready" ? "success" : "warning"}
      title="Recommendations, relationships and assistants"
    >
      <CrmActionWorkbench actions={actions} />
      <section className="panel crm-product-provider-note">
        <h2>Provider status</h2>
        <p>
          Rules-based recommendations and grounded drafting are available now.
          External model execution is only production-accepted when a configured
          provider passes staging and production evidence gates.
        </p>
      </section>
    </CrmWorkspaceShell>
  );
}
