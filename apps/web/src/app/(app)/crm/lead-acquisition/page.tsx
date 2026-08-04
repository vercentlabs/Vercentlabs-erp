import {
  getCrmLeadAcquisitionReadiness,
  getLeadAcquisitionDashboard,
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
    id: "preview-import",
    label: "Preview lead import",
    description: "Validate mapping, duplicates and row errors before commit.",
    endpoint: "/api/crm/lead-acquisition/imports",
    fixedBody: { action: "preview" },
    fields: [
      {
        name: "fileName",
        label: "File name",
        defaultValue: "lead-import.csv",
        required: true,
      },
      {
        name: "duplicateStrategy",
        label: "Duplicate strategy",
        type: "select",
        defaultValue: "skip",
        options: [
          { label: "Skip", value: "skip" },
          { label: "Warn", value: "warn" },
          { label: "Update", value: "update" },
        ],
      },
      {
        name: "fieldMapping",
        label: "Field mapping",
        type: "json",
        defaultValue: { email: "email", fullName: "name", phone: "phone" },
      },
      {
        name: "rows",
        label: "Rows",
        type: "json",
        required: true,
        defaultValue: [
          {
            email: "buyer@example.com",
            name: "Sample Buyer",
            phone: "+919876543210",
          },
        ],
      },
    ],
  },
  {
    id: "commit-import",
    label: "Commit lead import",
    description: "Create validated leads from a previewed import batch.",
    endpoint: "/api/crm/lead-acquisition/imports",
    fixedBody: { action: "commit" },
    fields: [{ name: "batchId", label: "Import batch ID", required: true }],
  },
  {
    id: "rollback-import",
    label: "Rollback lead import",
    description: "Remove untouched leads created by a completed batch.",
    endpoint: "/api/crm/lead-acquisition/imports",
    fixedBody: { action: "rollback" },
    fields: [{ name: "batchId", label: "Import batch ID", required: true }],
  },
  {
    id: "form",
    label: "Create capture form",
    description:
      "Save a versioned public form with consent and origin controls.",
    endpoint: "/api/crm/lead-acquisition/forms",
    fields: [
      { name: "name", label: "Form name", required: true },
      {
        name: "allowedOrigins",
        label: "Allowed origins",
        type: "json",
        defaultValue: ["https://example.com"],
      },
      {
        name: "definition",
        label: "Form definition",
        type: "json",
        required: true,
        defaultValue: {
          fields: [
            {
              name: "fullName",
              label: "Full name",
              type: "text",
              required: true,
            },
            { name: "email", label: "Email", type: "email", required: true },
          ],
        },
      },
      { name: "consentText", label: "Consent text", type: "textarea" },
      {
        name: "duplicateStrategy",
        label: "Duplicate strategy",
        type: "select",
        defaultValue: "warn",
        options: [
          { label: "Warn", value: "warn" },
          { label: "Skip", value: "skip" },
          { label: "Update", value: "update" },
        ],
      },
    ],
  },
  {
    id: "publish-form",
    label: "Publish capture form",
    description: "Activate a reviewed form and issue its public capture key.",
    endpoint: "/api/crm/lead-acquisition/forms",
    fixedBody: { action: "publish" },
    fields: [{ name: "formId", label: "Form ID", required: true }],
  },
  {
    id: "connection",
    label: "Connect acquisition provider",
    description: "Register an advertising, social, chat or enrichment adapter.",
    endpoint: "/api/crm/lead-acquisition/connections",
    fields: [
      {
        name: "provider",
        label: "Provider",
        required: true,
        defaultValue: "custom",
      },
      { name: "displayName", label: "Connection name", required: true },
      {
        name: "credentialReference",
        label: "Credential reference",
        placeholder: "env:CRM_ACQUISITION_PROVIDER",
      },
      { name: "webhookSecretReference", label: "Webhook secret reference" },
      { name: "status", label: "Status", defaultValue: "sandbox" },
      { name: "metadata", label: "Metadata", type: "json", defaultValue: {} },
    ],
  },
  {
    id: "enrichment",
    label: "Queue enrichment",
    description:
      "Request allowlisted, review-required lead or account enrichment.",
    endpoint: "/api/crm/lead-acquisition/enrichment",
    fields: [
      {
        name: "entityType",
        label: "Entity type",
        type: "select",
        defaultValue: "lead",
        options: [
          { label: "Lead", value: "lead" },
          { label: "Account", value: "party" },
          { label: "Contact", value: "contact" },
        ],
      },
      { name: "entityId", label: "Entity ID", required: true },
      { name: "provider", label: "Provider", defaultValue: "custom" },
      {
        name: "requestedFields",
        label: "Requested fields",
        type: "json",
        defaultValue: ["industry", "jobTitle"],
      },
      {
        name: "proposedChanges",
        label: "Proposed changes",
        type: "json",
        defaultValue: {},
      },
      {
        name: "confidence",
        label: "Confidence",
        type: "number",
        defaultValue: 80,
      },
      {
        name: "provenance",
        label: "Provenance",
        type: "json",
        defaultValue: {},
      },
    ],
  },
  {
    id: "review-enrichment",
    label: "Review enrichment",
    description: "Approve or reject proposed external data changes.",
    endpoint: "/api/crm/lead-acquisition/enrichment",
    fixedBody: { action: "review" },
    fields: [
      { name: "reviewId", label: "Review ID", required: true },
      {
        name: "decision",
        label: "Decision",
        type: "select",
        required: true,
        defaultValue: "approved",
        options: [
          { label: "Approved", value: "approved" },
          { label: "Rejected", value: "rejected" },
        ],
      },
      { name: "notes", label: "Review notes", type: "textarea" },
    ],
  },
];

export default async function LeadAcquisitionPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return <AccessDenied area="lead acquisition" returnHref="/crm" />;
  }
  const context = crmContext(session);
  const [dashboard, readiness] = (await tenantTransaction(
    context.organizationId,
    async (client) =>
      Promise.all([
        getLeadAcquisitionDashboard(client, context),
        getCrmLeadAcquisitionReadiness(client, context),
      ]),
  )) as [Row, Row];
  const summary = (dashboard.summary || {}) as Row;
  const imports = (dashboard.imports || []) as Row[];
  const forms = (dashboard.forms || []) as Row[];
  const connections = (dashboard.connections || []) as Row[];
  const enrichment = (dashboard.enrichment || []) as Row[];

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/leads", label: "Leads" },
        { href: "/crm/marketing", label: "Marketing" },
      ]}
      description="Operate imports, form publishing, advertising and social adapters, chat capture and reviewable enrichment."
      eyebrow="Lead acquisition"
      metrics={[
        { label: "Imports", value: String(summary.imports ?? 0) },
        {
          label: "Published forms",
          value: String(summary.published_forms ?? 0),
        },
        {
          label: "Active connections",
          value: String(summary.active_connections ?? 0),
        },
        {
          label: "Pending enrichment",
          value: String(summary.pending_enrichment ?? 0),
          tone: Number(summary.pending_enrichment || 0) ? "warning" : "success",
        },
      ]}
      status={`${String(readiness.readiness || "blocked")} · ${String(readiness.score || 0)}%`}
      statusTone={readiness.readiness === "ready" ? "success" : "warning"}
      title="Forms, providers and enrichment"
    >
      <CrmActionWorkbench actions={actions} />
      <section className="panel crm-product-provider-note">
        <h2>External provider boundary</h2>
        <p>
          Advertising, social and enrichment capabilities remain
          production-blocked until real provider credentials, webhook signatures
          and staging receipts are recorded. Mock adapters are never treated as
          production acceptance.
        </p>
      </section>
      <div className="crm-product-data-grid">
        <section className="panel">
          <h2>Recent imports</h2>
          <div className="crm-stage-summary">
            {imports.length ? (
              imports.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.file_name)}</strong>
                    <small>
                      {String(row.valid_rows)} valid ·{" "}
                      {String(row.invalid_rows)} invalid
                    </small>
                  </span>
                  <b>{String(row.status)}</b>
                </div>
              ))
            ) : (
              <p>No import batch.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Capture forms</h2>
          <div className="crm-stage-summary">
            {forms.length ? (
              forms.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.name)}</strong>
                    <small>
                      Version {String(row.version)} ·{" "}
                      {String(row.public_key || "not published")}
                    </small>
                  </span>
                  <b>{String(row.status)}</b>
                </div>
              ))
            ) : (
              <p>No capture form.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Provider connections</h2>
          <div className="crm-stage-summary">
            {connections.length ? (
              connections.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.display_name)}</strong>
                    <small>
                      {String(row.provider)} · last event{" "}
                      {String(row.last_event_at || "never")}
                    </small>
                  </span>
                  <b>{String(row.status)}</b>
                </div>
              ))
            ) : (
              <p>No acquisition provider.</p>
            )}
          </div>
        </section>
        <section className="panel">
          <h2>Enrichment review</h2>
          <div className="crm-stage-summary">
            {enrichment.length ? (
              enrichment.slice(0, 8).map((row) => (
                <div key={String(row.id)}>
                  <span>
                    <strong>{String(row.provider)}</strong>
                    <small>
                      {String(row.entity_type)} · confidence{" "}
                      {String(row.confidence)}
                    </small>
                  </span>
                  <b>{String(row.status)}</b>
                </div>
              ))
            ) : (
              <p>No enrichment proposal.</p>
            )}
          </div>
        </section>
      </div>
    </CrmWorkspaceShell>
  );
}
