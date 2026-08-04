import {
  getConversationIntelligenceDashboard,
  getCrmConversationReadiness,
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
    id: "connection",
    label: "Connect telephony provider",
    description:
      "Register a provider using a secret reference, never raw credentials.",
    endpoint: "/api/crm/conversation-intelligence/connections",
    fields: [
      {
        name: "provider",
        label: "Provider",
        type: "select",
        required: true,
        defaultValue: "custom",
        options: [
          { label: "Twilio", value: "twilio" },
          { label: "Exotel", value: "exotel" },
          { label: "Plivo", value: "plivo" },
          { label: "Custom", value: "custom" },
          { label: "Mock (non-production)", value: "mock" },
        ],
      },
      { name: "displayName", label: "Connection name", required: true },
      {
        name: "credentialReference",
        label: "Credential reference",
        placeholder: "env:CRM_TELEPHONY_PROVIDER",
        required: true,
      },
      { name: "webhookKey", label: "Webhook key" },
      {
        name: "defaultFromNumber",
        label: "Default caller number",
        type: "tel",
      },
      { name: "recordingEnabled", label: "Enable recording", type: "checkbox" },
      {
        name: "transcriptionEnabled",
        label: "Enable transcription",
        type: "checkbox",
      },
      {
        name: "requireRecordingConsent",
        label: "Require recording consent",
        type: "checkbox",
        defaultValue: true,
      },
      {
        name: "retentionDays",
        label: "Retention days",
        type: "number",
        defaultValue: 90,
      },
      {
        name: "metadata",
        label: "Provider metadata",
        type: "json",
        defaultValue: {},
      },
    ],
  },
  {
    id: "call",
    label: "Start click-to-call",
    description: "Queue a consent-aware outbound provider command.",
    endpoint: "/api/crm/conversation-intelligence/calls",
    fields: [
      { name: "connectionId", label: "Connection ID", required: true },
      { name: "fromNumber", label: "From number", type: "tel" },
      { name: "toNumber", label: "To number", type: "tel", required: true },
      { name: "title", label: "Call title" },
      {
        name: "consentStatus",
        label: "Recording consent",
        type: "select",
        required: true,
        defaultValue: "granted",
        options: [
          { label: "Granted", value: "granted" },
          { label: "Not required", value: "not_required" },
          { label: "Denied", value: "denied" },
          { label: "Unknown", value: "unknown" },
        ],
      },
      { name: "leadId", label: "Lead ID" },
      { name: "opportunityId", label: "Opportunity ID" },
      { name: "partyId", label: "Account ID" },
      { name: "contactId", label: "Contact ID" },
      { name: "idempotencyKey", label: "Idempotency key" },
    ],
  },
  {
    id: "recording",
    label: "Register recording",
    description:
      "Attach provider recording metadata with consent and retention.",
    endpoint:
      "/api/crm/conversation-intelligence/conversations/{conversationId}/recordings",
    fields: [
      {
        name: "conversationId",
        label: "Conversation ID",
        path: true,
        required: true,
      },
      {
        name: "provider",
        label: "Provider",
        defaultValue: "custom",
        required: true,
      },
      { name: "providerRecordingId", label: "Provider recording ID" },
      {
        name: "storageReference",
        label: "Secure storage reference",
        required: true,
      },
      { name: "mediaType", label: "Media type", defaultValue: "audio/mpeg" },
      { name: "durationSeconds", label: "Duration seconds", type: "number" },
      { name: "byteSize", label: "Byte size", type: "number" },
      { name: "checksumSha256", label: "SHA-256 checksum" },
      {
        name: "consentStatus",
        label: "Consent status",
        type: "select",
        required: true,
        defaultValue: "granted",
        options: [
          { label: "Granted", value: "granted" },
          { label: "Not required", value: "not_required" },
          { label: "Denied", value: "denied" },
          { label: "Unknown", value: "unknown" },
        ],
      },
      {
        name: "retentionUntil",
        label: "Retention until",
        type: "datetime-local",
        required: true,
      },
    ],
  },
  {
    id: "transcription",
    label: "Queue transcription",
    description:
      "Submit an available recording to a governed transcription provider.",
    endpoint:
      "/api/crm/conversation-intelligence/conversations/{conversationId}/transcriptions",
    fields: [
      {
        name: "conversationId",
        label: "Conversation ID",
        path: true,
        required: true,
      },
      {
        name: "provider",
        label: "Provider",
        type: "select",
        defaultValue: "custom",
        options: [
          { label: "Custom", value: "custom" },
          { label: "OpenAI-compatible", value: "openai" },
          { label: "Azure", value: "azure" },
          { label: "Google", value: "google" },
          { label: "AWS", value: "aws" },
          { label: "Deepgram", value: "deepgram" },
          { label: "Mock", value: "mock" },
        ],
      },
      { name: "credentialReference", label: "Credential reference" },
      { name: "languageCode", label: "Language", defaultValue: "en-IN" },
      {
        name: "diarizationEnabled",
        label: "Speaker diarisation",
        type: "checkbox",
        defaultValue: true,
      },
      {
        name: "redactionEnabled",
        label: "Redact sensitive text",
        type: "checkbox",
        defaultValue: true,
      },
      { name: "idempotencyKey", label: "Idempotency key" },
    ],
  },
  {
    id: "recording-access",
    label: "Issue recording access",
    description: "Create a purpose-bound, short-lived recording access grant.",
    endpoint:
      "/api/crm/conversation-intelligence/recordings/{recordingId}/access",
    fields: [
      {
        name: "recordingId",
        label: "Recording ID",
        path: true,
        required: true,
      },
      { name: "purpose", label: "Purpose", required: true },
      {
        name: "expiresInMinutes",
        label: "Expires in minutes",
        type: "number",
        defaultValue: 15,
      },
    ],
  },
];

export default async function ConversationIntelligencePage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return <AccessDenied area="conversation intelligence" returnHref="/crm" />;
  }
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getConversationIntelligenceDashboard(client, context),
        getCrmConversationReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const connections = (dashboard.connections || []) as Row[];
  const jobs = (dashboard.jobs || []) as Row[];
  const recent = (dashboard.recent || []) as Row[];

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/communications", label: "Communications" },
        { href: "/crm/activities", label: "Activities" },
        { href: "/crm/readiness", label: "CRM readiness" },
      ]}
      description="Operate telephony commands, consent-controlled recordings, transcription queues, summaries and action items."
      eyebrow="Conversation intelligence"
      metrics={[
        { label: "Calls in 30 days", value: String(summary.calls_30d ?? 0) },
        { label: "Active calls", value: String(summary.active_calls ?? 0) },
        {
          label: "Recordings",
          value: String(summary.recordings_available ?? 0),
        },
        {
          label: "Transcripts pending",
          value: String(summary.transcripts_pending ?? 0),
          tone: Number(summary.transcripts_pending || 0)
            ? "warning"
            : "success",
        },
      ]}
      status={`${String(readiness.readiness || "blocked")} · provider ${String(readiness.providerReadiness || "sandbox")}`}
      statusTone={
        readiness.providerReadiness === "production" ? "success" : "warning"
      }
      title="Calls, recordings and transcripts"
    >
      <CrmActionWorkbench actions={actions} />
      <section className="panel crm-product-provider-note">
        <h2>Worker requirement</h2>
        <p>
          Queued telephony and transcription jobs require the dedicated
          <code> crm:provider-jobs </code> worker. Production readiness also
          requires real provider credentials, webhooks and delivery receipts.
        </p>
      </section>
      <div className="crm-product-data-grid">
        <section className="panel">
          <h2>Telephony connections</h2>
          <div className="crm-stage-summary">
            {connections.length ? (
              connections.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.display_name)}</strong>
                    <small>
                      {String(row.provider)} · last webhook{" "}
                      {String(row.last_webhook_at || "never")}
                    </small>
                  </span>
                  <b>{String(row.status)}</b>
                </div>
              ))
            ) : (
              <p>No telephony connection is configured.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Transcription jobs</h2>
          <div className="crm-stage-summary">
            {jobs.length ? (
              jobs.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.provider)}</strong>
                    <small>
                      {String(row.conversation_id)} · attempts{" "}
                      {String(row.attempts)}
                    </small>
                  </span>
                  <b>{String(row.status)}</b>
                </div>
              ))
            ) : (
              <p>No transcription jobs.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Recent conversations</h2>
          <div className="crm-stage-summary">
            {recent.length ? (
              recent.slice(0, 8).map((row, index) => (
                <div key={String(row.id || index)}>
                  <span>
                    <strong>
                      {String(row.title || row.event_type || "Conversation")}
                    </strong>
                    <small>
                      {String(row.occurred_at || row.started_at || "")}
                    </small>
                  </span>
                  <b>{String(row.status || row.channel || "")}</b>
                </div>
              ))
            ) : (
              <p>No recent conversations.</p>
            )}
          </div>
        </section>
      </div>
    </CrmWorkspaceShell>
  );
}
