import {
  getCrmPartnerEngagementReadiness,
  getPartnerEngagementDashboard,
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
    id: "register-partner-deal",
    label: "Register partner deal",
    description: "Protect a partner-sourced opportunity from channel conflict.",
    endpoint: "/api/crm/partner-engagement",
    fixedBody: { action: "register-partner-deal" },
    fields: [
      { name: "partnerAccountId", label: "Partner account ID", required: true },
      { name: "opportunityName", label: "Opportunity name", required: true },
      { name: "customerName", label: "Customer name", required: true },
      { name: "expectedAmount", label: "Expected amount", type: "number" },
      { name: "expectedCloseDate", label: "Expected close", type: "date" },
      { name: "notes", label: "Notes", type: "textarea" },
    ],
  },
  {
    id: "submit-mdf",
    label: "Submit MDF request",
    description: "Request governed market-development funding.",
    endpoint: "/api/crm/partner-engagement",
    fixedBody: { action: "submit-mdf" },
    fields: [
      { name: "partnerAccountId", label: "Partner account ID", required: true },
      {
        name: "amount",
        label: "Requested amount",
        type: "number",
        required: true,
      },
      { name: "purpose", label: "Purpose", type: "textarea", required: true },
      { name: "startsAt", label: "Starts", type: "date" },
      { name: "endsAt", label: "Ends", type: "date" },
    ],
  },
  {
    id: "field-visit",
    label: "Record field visit",
    description: "Capture a geolocated seller visit and outcome.",
    endpoint: "/api/crm/partner-engagement",
    fixedBody: { action: "record-field-visit" },
    fields: [
      { name: "accountId", label: "Account ID", required: true },
      { name: "latitude", label: "Latitude", type: "number", required: true },
      { name: "longitude", label: "Longitude", type: "number", required: true },
      { name: "accuracyMeters", label: "Accuracy (metres)", type: "number" },
      { name: "outcome", label: "Outcome", required: true },
      { name: "notes", label: "Visit notes", type: "textarea" },
    ],
  },
  {
    id: "sequence-branch",
    label: "Save sequence branch",
    description: "Define a conditional engagement path.",
    endpoint: "/api/crm/partner-engagement",
    fixedBody: { action: "save-sequence-branch" },
    fields: [
      { name: "sequenceId", label: "Sequence ID", required: true },
      { name: "stepId", label: "Step ID", required: true },
      {
        name: "condition",
        label: "Condition",
        type: "json",
        required: true,
        defaultValue: { field: "status", operator: "equals", value: "replied" },
      },
      { name: "nextStepId", label: "Next step ID", required: true },
    ],
  },
  {
    id: "coaching-scorecard",
    label: "Create coaching scorecard",
    description: "Record seller coaching evidence against a conversation.",
    endpoint: "/api/crm/partner-engagement",
    fixedBody: { action: "create-scorecard" },
    fields: [
      { name: "conversationId", label: "Conversation ID", required: true },
      { name: "sellerUserId", label: "Seller user ID", required: true },
      {
        name: "scores",
        label: "Scores",
        type: "json",
        required: true,
        defaultValue: { discovery: 80, clarity: 75, nextStep: 90 },
      },
      { name: "feedback", label: "Coaching feedback", type: "textarea" },
    ],
  },
  {
    id: "gamification",
    label: "Award points",
    description: "Create an auditable gamification event.",
    endpoint: "/api/crm/partner-engagement",
    fixedBody: { action: "award-points" },
    fields: [
      { name: "userId", label: "User ID", required: true },
      { name: "points", label: "Points", type: "number", required: true },
      { name: "reason", label: "Reason", required: true },
      { name: "referenceType", label: "Reference type" },
      { name: "referenceId", label: "Reference ID" },
    ],
  },
  {
    id: "inbound-email",
    label: "Process inbound email",
    description: "Convert a governed inbound email into CRM work.",
    endpoint: "/api/crm/partner-engagement",
    fixedBody: { action: "process-inbound-email" },
    fields: [
      {
        name: "externalMessageId",
        label: "External message ID",
        required: true,
      },
      { name: "from", label: "Sender email", type: "email", required: true },
      { name: "subject", label: "Subject", required: true },
      { name: "body", label: "Message body", type: "textarea", required: true },
    ],
  },
];

export default async function PartnerEngagementPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return (
      <AccessDenied area="partner and seller engagement" returnHref="/crm" />
    );
  }
  const context = crmContext(session);
  const { dashboard, readiness } = (await tenantTransaction(
    context.organizationId,
    async (client) => ({
      dashboard: await getPartnerEngagementDashboard(client, context),
      readiness: await getCrmPartnerEngagementReadiness(client, context),
    }),
  )) as { dashboard: Row; readiness: Row };

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/accounts", label: "Accounts" },
        { href: "/crm/opportunities", label: "Opportunities" },
      ]}
      description="Operate partner-sourced revenue, MDF, field sales, engagement sequences, coaching and seller incentives from one governed workspace."
      eyebrow="Partner and seller engagement"
      metrics={[
        { label: "Partner deals", value: String(dashboard.partner_deals ?? 0) },
        {
          label: "MDF pending",
          value: String(dashboard.mdf_pending ?? 0),
          tone: Number(dashboard.mdf_pending || 0) ? "warning" : "success",
        },
        { label: "Field visits", value: String(dashboard.field_visits ?? 0) },
        {
          label: "Coaching scorecards",
          value: String(dashboard.scorecards ?? 0),
        },
        { label: "Points awarded", value: String(dashboard.points ?? 0) },
        {
          label: "Inbound conversions",
          value: String(dashboard.inbound_conversions ?? 0),
        },
      ]}
      status={`${String(readiness.readiness || "blocked")} · ${String(readiness.passed || 0)}/${String(readiness.total || 0)}`}
      statusTone={readiness.readiness === "ready" ? "success" : "warning"}
      title="Partner revenue and seller performance"
    >
      <CrmActionWorkbench actions={actions} />
    </CrmWorkspaceShell>
  );
}
