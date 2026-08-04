import {
  getCrmMarketingReadiness,
  getMarketingDashboard,
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
    id: "segment",
    label: "Save audience segment",
    description:
      "Create a static or dynamic, parameterised marketing audience.",
    endpoint: "/api/crm/marketing/segments",
    fields: [
      { name: "name", label: "Segment name", required: true },
      {
        name: "subjectType",
        label: "Subject type",
        type: "select",
        defaultValue: "lead",
        options: [
          { label: "Lead", value: "lead" },
          { label: "Contact", value: "contact" },
          { label: "Account", value: "party" },
        ],
      },
      {
        name: "segmentType",
        label: "Segment type",
        type: "select",
        defaultValue: "dynamic",
        options: [
          { label: "Dynamic", value: "dynamic" },
          { label: "Static", value: "static" },
        ],
      },
      {
        name: "definition",
        label: "Segment definition",
        type: "json",
        required: true,
        defaultValue: {
          operator: "and",
          rules: [{ field: "status", operator: "equals", value: "qualified" }],
        },
      },
    ],
  },
  {
    id: "refresh-segment",
    label: "Refresh segment",
    description: "Re-evaluate dynamic membership with tenant-safe parameters.",
    endpoint: "/api/crm/marketing/segments",
    fixedBody: { action: "refresh" },
    fields: [{ name: "segmentId", label: "Segment ID", required: true }],
  },
  {
    id: "campaign",
    label: "Save campaign",
    description: "Configure budget, attribution and expected revenue.",
    endpoint: "/api/crm/marketing/campaigns",
    fields: [
      { name: "code", label: "Campaign code", required: true },
      { name: "name", label: "Campaign name", required: true },
      {
        name: "attributionModel",
        label: "Attribution model",
        type: "select",
        defaultValue: "position_based",
        options: [
          { label: "First touch", value: "first_touch" },
          { label: "Last touch", value: "last_touch" },
          { label: "Linear", value: "linear" },
          { label: "Position based", value: "position_based" },
          { label: "Time decay", value: "time_decay" },
        ],
      },
      { name: "budget", label: "Budget", type: "number" },
      { name: "expectedRevenue", label: "Expected revenue", type: "number" },
    ],
  },
  {
    id: "campaign-run",
    label: "Create campaign run",
    description:
      "Build a consent and frequency-governed email/SMS delivery run.",
    endpoint: "/api/crm/marketing/campaigns",
    fixedBody: { action: "create-run" },
    fields: [
      { name: "campaignId", label: "Campaign ID", required: true },
      { name: "segmentId", label: "Segment ID", required: true },
      {
        name: "channel",
        label: "Channel",
        type: "select",
        defaultValue: "email",
        options: [
          { label: "Email", value: "email" },
          { label: "SMS", value: "sms" },
          { label: "Mixed", value: "mixed" },
        ],
      },
      { name: "provider", label: "Provider", defaultValue: "native" },
      { name: "subject", label: "Subject" },
      { name: "body", label: "Message body", type: "textarea", required: true },
      {
        name: "maximumMessages",
        label: "Maximum messages",
        type: "number",
        defaultValue: 100,
      },
    ],
  },
  {
    id: "process-run",
    label: "Process campaign run",
    description: "Advance queued deliveries through the configured provider.",
    endpoint: "/api/crm/marketing/campaigns",
    fixedBody: { action: "process-run" },
    fields: [{ name: "runId", label: "Campaign run ID", required: true }],
  },
  {
    id: "journey",
    label: "Save marketing journey",
    description: "Create validated waits, branches, sends and exit criteria.",
    endpoint: "/api/crm/marketing/journeys",
    fields: [
      { name: "name", label: "Journey name", required: true },
      {
        name: "steps",
        label: "Journey steps",
        type: "json",
        required: true,
        defaultValue: [
          {
            sequence: 1,
            actionType: "send_email",
            subject: "Welcome",
            body: "Thank you for your interest.",
          },
          { sequence: 2, actionType: "wait", delayMinutes: 1440 },
          {
            sequence: 3,
            actionType: "branch",
            condition: { field: "engaged", operator: "equals", value: true },
          },
        ],
      },
      {
        name: "entryCriteria",
        label: "Entry criteria",
        type: "json",
        defaultValue: {},
      },
      {
        name: "exitCriteria",
        label: "Exit criteria",
        type: "json",
        defaultValue: {},
      },
    ],
  },
  {
    id: "enroll-journey",
    label: "Enroll journey member",
    description: "Add an eligible lead/contact/account to an active journey.",
    endpoint: "/api/crm/marketing/journeys",
    fixedBody: { action: "enroll" },
    fields: [
      { name: "journeyId", label: "Journey ID", required: true },
      { name: "subjectType", label: "Subject type", defaultValue: "lead" },
      { name: "subjectId", label: "Subject ID", required: true },
    ],
  },
  {
    id: "event",
    label: "Save event or webinar",
    description: "Publish a capacity-controlled event and registration token.",
    endpoint: "/api/crm/marketing/events",
    fields: [
      { name: "name", label: "Event name", required: true },
      { name: "eventType", label: "Event type", defaultValue: "webinar" },
      {
        name: "startsAt",
        label: "Starts at",
        type: "datetime-local",
        required: true,
      },
      {
        name: "endsAt",
        label: "Ends at",
        type: "datetime-local",
        required: true,
      },
      {
        name: "capacity",
        label: "Capacity",
        type: "number",
        defaultValue: 100,
      },
      {
        name: "registrationFields",
        label: "Registration fields",
        type: "json",
        defaultValue: ["name", "email"],
      },
    ],
  },
  {
    id: "survey",
    label: "Save survey",
    description: "Publish a governed survey with validated questions.",
    endpoint: "/api/crm/marketing/surveys",
    fields: [
      { name: "name", label: "Survey name", required: true },
      {
        name: "questions",
        label: "Questions",
        type: "json",
        required: true,
        defaultValue: [
          {
            key: "recommend",
            label: "How likely are you to recommend us?",
            type: "number",
            min: 0,
            max: 10,
          },
        ],
      },
    ],
  },
  {
    id: "touchpoint",
    label: "Record attribution touchpoint",
    description: "Attach an engagement or revenue event to campaign influence.",
    endpoint: "/api/crm/marketing/attribution",
    fixedBody: { action: "record" },
    fields: [
      { name: "campaignId", label: "Campaign ID", required: true },
      { name: "subjectType", label: "Subject type", defaultValue: "lead" },
      { name: "subjectId", label: "Subject ID", required: true },
      { name: "eventType", label: "Event type", defaultValue: "engagement" },
      { name: "occurredAt", label: "Occurred at", type: "datetime-local" },
      { name: "revenue", label: "Revenue", type: "number" },
      { name: "metadata", label: "Metadata", type: "json", defaultValue: {} },
    ],
  },
];

export default async function MarketingPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return <AccessDenied area="marketing execution" returnHref="/crm" />;
  }
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getMarketingDashboard(client, context),
        getCrmMarketingReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const campaigns = (dashboard.campaigns || []) as Row[];
  const segments = (dashboard.segments || []) as Row[];
  const journeys = (dashboard.journeys || []) as Row[];
  const events = (dashboard.events || []) as Row[];
  const surveys = (dashboard.surveys || []) as Row[];

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/campaigns", label: "Campaign records" },
        { href: "/crm/communications", label: "Communications" },
        { href: "/crm/lead-acquisition", label: "Lead acquisition" },
        { href: "/crm/reports", label: "Reports" },
      ]}
      description="Build consent-aware audiences, execute campaigns and journeys, run experiments, manage events and connect revenue to attributable touchpoints."
      eyebrow="Marketing execution"
      metrics={[
        {
          label: "Active segments",
          value: String(summary.active_segments ?? 0),
        },
        {
          label: "Active journeys",
          value: String(summary.active_enrollments ?? 0),
        },
        { label: "Delivered", value: String(summary.delivered ?? 0) },
        {
          label: "Influenced revenue",
          value: String(summary.influenced_revenue ?? 0),
        },
      ]}
      status={`${String(readiness.readiness || "blocked")} · ${String(readiness.score || 0)}%`}
      statusTone={readiness.readiness === "ready" ? "success" : "warning"}
      title="Segments, journeys and attributable growth"
    >
      <CrmActionWorkbench actions={actions} />
      <section className="panel crm-product-provider-note">
        <h2>Channel promotion gate</h2>
        <p>
          Native/mock campaign execution proves internal orchestration only.
          Production email, SMS, webinar and external survey providers require
          real delivery receipts before their acceptance tier becomes
          production.
        </p>
      </section>
      <div className="crm-product-data-grid">
        <section className="panel">
          <h2>Campaign execution</h2>
          <div className="crm-stage-summary">
            {campaigns.length ? (
              campaigns.slice(0, 8).map((campaign) => (
                <div key={String(campaign.id)}>
                  <span>
                    <strong>{String(campaign.name)}</strong>
                    <small>
                      {String(campaign.runs || 0)} runs ·{" "}
                      {String(campaign.sent || 0)} sent ·{" "}
                      {String(campaign.responses || 0)} responses
                    </small>
                  </span>
                  <b>{String(campaign.status)}</b>
                </div>
              ))
            ) : (
              <p>No governed campaign run.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Audience segments</h2>
          <div className="crm-stage-summary">
            {segments.length ? (
              segments.slice(0, 8).map((segment) => (
                <div key={String(segment.id)}>
                  <span>
                    <strong>{String(segment.name)}</strong>
                    <small>
                      {String(segment.subject_type)} ·{" "}
                      {String(segment.member_count || 0)} members
                    </small>
                  </span>
                  <b>{String(segment.refresh_status)}</b>
                </div>
              ))
            ) : (
              <p>No marketing segment.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Journeys, events and surveys</h2>
          <div className="crm-stage-summary">
            {[...journeys, ...events, ...surveys].length ? (
              [...journeys, ...events, ...surveys]
                .slice(0, 12)
                .map((record) => (
                  <div key={`${String(record.id)}-${String(record.name)}`}>
                    <span>
                      <strong>{String(record.name)}</strong>
                      <small>
                        {record.enrollments !== undefined
                          ? `${String(record.enrollments)} enrolments`
                          : record.registrations !== undefined
                            ? `${String(record.registrations)} registrations`
                            : `${String(record.responses || 0)} responses`}
                      </small>
                    </span>
                    <b>{String(record.status)}</b>
                  </div>
                ))
            ) : (
              <p>No journey, event or survey.</p>
            )}
          </div>
        </section>
      </div>
    </CrmWorkspaceShell>
  );
}
