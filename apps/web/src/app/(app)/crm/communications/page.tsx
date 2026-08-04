import {
  getCommunicationsDashboard,
  getCrmCommunicationsReadiness,
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
    id: "create-inbox",
    label: "Create shared inbox",
    description:
      "Configure an owned team queue with SLA and collision controls.",
    endpoint: "/api/crm/communications/inbox",
    fields: [
      { name: "name", label: "Inbox name", required: true },
      {
        name: "channel",
        label: "Channel",
        type: "select",
        defaultValue: "email",
        options: [
          { label: "Email", value: "email" },
          { label: "SMS", value: "sms" },
          { label: "WhatsApp", value: "whatsapp" },
          { label: "Social", value: "social" },
        ],
      },
      { name: "address", label: "Inbox address", type: "email" },
      { name: "syncAccountId", label: "Sync account ID" },
      {
        name: "slaMinutes",
        label: "SLA minutes",
        type: "number",
        defaultValue: 240,
      },
      {
        name: "collisionTimeoutMinutes",
        label: "Collision timeout",
        type: "number",
        defaultValue: 15,
      },
      {
        name: "businessHours",
        label: "Business hours",
        type: "json",
        defaultValue: {
          timezone: "Asia/Kolkata",
          start: "09:00",
          end: "18:00",
        },
      },
    ],
  },
  {
    id: "send-email",
    label: "Queue outbound email",
    description:
      "Send through governed consent, suppression and delivery controls.",
    endpoint: "/api/crm/communications/send",
    fields: [
      {
        name: "provider",
        label: "Provider",
        type: "select",
        defaultValue: "manual",
        options: [
          { label: "Manual/SMTP", value: "manual" },
          { label: "Gmail", value: "gmail" },
          { label: "Microsoft 365", value: "microsoft365" },
        ],
      },
      { name: "syncAccountId", label: "Sync account ID" },
      {
        name: "fromAddress",
        label: "From address",
        type: "email",
        required: true,
      },
      {
        name: "toAddresses",
        label: "Recipients",
        type: "json",
        required: true,
        defaultValue: ["customer@example.com"],
      },
      { name: "subject", label: "Subject", required: true },
      { name: "bodyText", label: "Message", type: "textarea", required: true },
      { name: "leadId", label: "Lead ID" },
      { name: "opportunityId", label: "Opportunity ID" },
      { name: "partyId", label: "Account ID" },
      { name: "contactId", label: "Contact ID" },
      { name: "timezone", label: "Timezone", defaultValue: "Asia/Kolkata" },
      {
        name: "sendWindow",
        label: "Send window",
        type: "json",
        defaultValue: { start: "08:00", end: "20:00" },
      },
    ],
  },
  {
    id: "sync-provider",
    label: "Run provider sync",
    description: "Execute a Gmail or Microsoft mailbox/calendar delta sync.",
    endpoint: "/api/crm/communications/sync",
    fixedBody: { executeProvider: true },
    fields: [
      { name: "syncAccountId", label: "Sync account ID", required: true },
      {
        name: "syncType",
        label: "Sync type",
        type: "select",
        defaultValue: "mailbox",
        options: [
          { label: "Mailbox", value: "mailbox" },
          { label: "Calendar", value: "calendar" },
        ],
      },
      {
        name: "maximumItems",
        label: "Maximum items",
        type: "number",
        defaultValue: 100,
      },
    ],
  },
  {
    id: "signature",
    label: "Save email signature",
    description: "Create a reusable governed sender signature.",
    endpoint: "/api/crm/communications/signatures",
    fields: [
      { name: "name", label: "Signature name", required: true },
      {
        name: "bodyHtml",
        label: "HTML signature",
        type: "textarea",
        required: true,
      },
      { name: "bodyText", label: "Plain-text signature", type: "textarea" },
      { name: "isDefault", label: "Make default", type: "checkbox" },
    ],
  },
  {
    id: "engagement",
    label: "Record engagement event",
    description:
      "Capture delivered, opened, clicked, bounced or unsubscribed evidence.",
    endpoint: "/api/crm/communications/engagement",
    fields: [
      { name: "messageId", label: "Email message ID", required: true },
      {
        name: "eventType",
        label: "Event type",
        type: "select",
        required: true,
        defaultValue: "opened",
        options: [
          { label: "Delivered", value: "delivered" },
          { label: "Opened", value: "opened" },
          { label: "Clicked", value: "clicked" },
          { label: "Bounced", value: "bounced" },
          { label: "Complaint", value: "complained" },
          { label: "Unsubscribed", value: "unsubscribed" },
        ],
      },
      { name: "providerEventId", label: "Provider event ID", required: true },
      { name: "occurredAt", label: "Occurred at", type: "datetime-local" },
      { name: "metadata", label: "Metadata", type: "json", defaultValue: {} },
    ],
  },
];

export default async function CrmCommunicationsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return <AccessDenied area="CRM communications" returnHref="/crm" />;
  }
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getCommunicationsDashboard(client, context),
        getCrmCommunicationsReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const inboxes = (dashboard.inboxes || []) as Row[];
  const threads = (dashboard.threads || []) as Row[];
  const meetings = (dashboard.upcomingMeetings || []) as Row[];
  const accounts = (dashboard.syncAccounts || []) as Row[];

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/activities", label: "Activities" },
        { href: "/crm/engagement-templates", label: "Templates" },
      ]}
      description="Operate shared inboxes, provider synchronisation, governed outbound messaging, engagement evidence and meeting operations."
      eyebrow="Communications"
      metrics={[
        { label: "Open threads", value: String(summary.open_threads ?? 0) },
        { label: "Unread", value: String(summary.unread_threads ?? 0) },
        {
          label: "Overdue SLA",
          value: String(summary.overdue_threads ?? 0),
          tone: Number(summary.overdue_threads || 0) ? "danger" : "success",
        },
        {
          label: "Suppressed",
          value: String(summary.active_suppressions ?? 0),
        },
      ]}
      status={`${String(readiness.readiness || "blocked")} · ${String(readiness.score || 0)}%`}
      statusTone={readiness.readiness === "ready" ? "success" : "warning"}
      title="Inbox, email and calendar"
    >
      <CrmActionWorkbench actions={actions} />
      <section className="panel crm-product-provider-note">
        <h2>Production provider acceptance</h2>
        <p>
          Gmail and Microsoft adapters are only production-ready after OAuth,
          token refresh, public webhook and real delivery evidence pass for the
          deployed environment. Local mock evidence does not satisfy that gate.
        </p>
      </section>
      <div className="crm-product-data-grid">
        <section className="panel">
          <h2>Shared inboxes</h2>
          <div className="crm-stage-summary">
            {inboxes.length ? (
              inboxes.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.name)}</strong>
                    <small>
                      {String(row.address || row.channel)} · SLA{" "}
                      {String(row.sla_minutes)} min
                    </small>
                  </span>
                  <b>{String(row.open_threads)} open</b>
                </div>
              ))
            ) : (
              <p>No shared inbox is configured.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Provider health</h2>
          <div className="crm-stage-summary">
            {accounts.length ? (
              accounts.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.display_name)}</strong>
                    <small>
                      {String(row.provider)} · last sync{" "}
                      {String(row.last_synced_at || "never")}
                    </small>
                  </span>
                  <b>{String(row.status)}</b>
                </div>
              ))
            ) : (
              <p>No provider account is connected.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Conversation queue</h2>
          <div className="crm-stage-summary">
            {threads.length ? (
              threads.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>
                      {String(row.subject || "Untitled conversation")}
                    </strong>
                    <small>
                      {String(row.inbox_name || row.provider)} ·{" "}
                      {String(row.last_message_at)}
                    </small>
                  </span>
                  <b>{String(row.priority)}</b>
                </div>
              ))
            ) : (
              <p>No open conversations.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Upcoming meetings</h2>
          <div className="crm-stage-summary">
            {meetings.length ? (
              meetings.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.meeting_name)}</strong>
                    <small>
                      {String(row.guest_name)} · {String(row.guest_email)}
                    </small>
                  </span>
                  <b>{String(row.starts_at)}</b>
                </div>
              ))
            ) : (
              <p>No upcoming self-service meetings.</p>
            )}
          </div>
        </section>
      </div>
    </CrmWorkspaceShell>
  );
}
