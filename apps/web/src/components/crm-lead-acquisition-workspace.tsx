"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import * as XLSX from "xlsx";

import AppIcon from "@/components/app-icon";
import { requestJson } from "@/lib/client-request";

type Row = Record<string, unknown>;
type Option = { id: string; name: string };
type Permissions = {
  canImport: boolean;
  canCapture: boolean;
  canIntegrate: boolean;
  canEnrich: boolean;
};

type ImportState = {
  fileName: string;
  sourceFormat: string;
  headers: string[];
  rows: Record<string, unknown>[];
  mapping: Record<string, string>;
  batchId: string;
  preview?: Row;
};

function nice(value: unknown) {
  return String(value ?? "—")
    .replaceAll("_", " ")
    .replace(/^./, (c) => c.toUpperCase());
}
function guessMapping(headers: string[]) {
  const normalized = new Map(
    headers.map((header) => [
      header.toLowerCase().replace(/[^a-z0-9]/g, ""),
      header,
    ]),
  );
  const choose = (...aliases: string[]) =>
    aliases
      .map((alias) => normalized.get(alias.replace(/[^a-z0-9]/g, "")))
      .find(Boolean) || "";
  return {
    firstName: choose("first_name", "firstname", "given_name", "name"),
    lastName: choose("last_name", "lastname", "surname", "family_name"),
    email: choose("email", "email_address", "work_email"),
    phone: choose("phone", "telephone"),
    mobile: choose("mobile", "mobile_number", "phone_number"),
    companyName: choose(
      "company",
      "company_name",
      "organisation",
      "organization",
    ),
    jobTitle: choose("job_title", "title", "designation"),
    website: choose("website", "url"),
    industry: choose("industry"),
    city: choose("city"),
    state: choose("state", "region"),
    countryCode: choose("country_code", "countrycode"),
    productInterest: choose("product_interest", "interest", "requirement"),
    estimatedValue: choose("estimated_value", "value", "deal_value"),
    currencyCode: choose("currency", "currency_code"),
    consentEmail: choose("consent_email"),
    consentSms: choose("consent_sms"),
    consentWhatsapp: choose("consent_whatsapp"),
  };
}

async function workbookRows(file: File) {
  const extension = file.name.split(".").pop()?.toLowerCase() || "csv";
  const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: false });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName)
    return {
      headers: [] as string[],
      rows: [] as Record<string, unknown>[],
      sourceFormat: extension,
    };
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  const headers = rows.length ? Object.keys(rows[0]) : [];
  return {
    headers,
    rows,
    sourceFormat:
      extension === "xls" ? "xls" : extension === "xlsx" ? "xlsx" : "csv",
  };
}

export default function CrmLeadAcquisitionWorkspace({
  dashboard,
  readiness,
  options,
  permissions,
}: {
  dashboard: Row;
  readiness: Row;
  options: Record<string, Option[]>;
  permissions: Permissions;
}) {
  const router = useRouter();
  const summary = (dashboard.summary || {}) as Row;
  const imports = (dashboard.imports || []) as Row[];
  const forms = (dashboard.forms || []) as Row[];
  const connections = (dashboard.connections || []) as Row[];
  const events = (dashboard.events || []) as Row[];
  const enrichment = (dashboard.enrichment || []) as Row[];
  const [tab, setTab] = useState("intake");
  const [message, setMessage] = useState("");
  const [pending, setPending] = useState(false);
  const [newConnection, setNewConnection] = useState<Row | null>(null);
  const [duplicateStrategy, setDuplicateStrategy] = useState("skip");
  const [importState, setImportState] = useState<ImportState>({
    fileName: "",
    sourceFormat: "csv",
    headers: [],
    rows: [],
    mapping: {},
    batchId: "",
  });
  const tabs = [
    "intake",
    "imports",
    "forms",
    "channels",
    "events",
    "enrichment",
  ];

  async function api(path: string, body: Record<string, unknown>) {
    setPending(true);
    setMessage("");
    try {
      const result = await requestJson<Row>(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!result.ok) throw new Error(result.message || "Request failed.");
      setMessage(result.message || "Saved.");
      router.refresh();
      return result;
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Request failed.");
      return null;
    } finally {
      setPending(false);
    }
  }

  async function selectWorkbook(file: File) {
    if (!/\.(csv|xlsx|xls)$/i.test(file.name)) {
      setMessage("Choose a CSV, XLSX or XLS workbook.");
      return;
    }
    try {
      const parsed = await workbookRows(file);
      if (!parsed.rows.length) {
        setMessage("The workbook does not contain data rows.");
        return;
      }
      if (parsed.rows.length > 5_000) {
        setMessage("Lead imports are limited to 5,000 rows per batch.");
        return;
      }
      setImportState({
        fileName: file.name,
        sourceFormat: parsed.sourceFormat,
        headers: parsed.headers,
        rows: parsed.rows,
        mapping: guessMapping(parsed.headers),
        batchId: "",
      });
      setTab("imports");
      setMessage("");
    } catch (error) {
      setMessage(
        error instanceof Error ? error.message : "Workbook could not be read.",
      );
    }
  }
  async function previewImport() {
    if (!importState.rows.length) return;
    const response = await api("/api/crm/lead-acquisition/imports", {
      action: "preview",
      fileName: importState.fileName,
      sourceFormat: importState.sourceFormat,
      duplicateStrategy,
      fieldMapping: importState.mapping,
      rows: importState.rows,
    });
    const result = response?.result as Row | undefined;
    const batch = (result?.batch || {}) as Row;
    if (result)
      setImportState((current) => ({
        ...current,
        batchId: String(batch.id || ""),
        preview: result,
      }));
  }
  async function commitImport() {
    if (importState.batchId)
      await api("/api/crm/lead-acquisition/imports", {
        action: "commit",
        batchId: importState.batchId,
      });
  }
  async function rollbackImport(batchId: string) {
    if (confirm("Rollback untouched leads created by this import batch?"))
      await api("/api/crm/lead-acquisition/imports", {
        action: "rollback",
        batchId,
      });
  }

  async function createForm(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const selected = [
      "firstName",
      "lastName",
      "email",
      "mobile",
      "companyName",
      "jobTitle",
      "productInterest",
    ].filter((name) => form.get(name) === "on");
    if (!selected.includes("firstName")) {
      setMessage("A capture form must include required First name.");
      return;
    }
    const fields = selected.map((name) => ({
      name,
      label: nice(name.replace(/([A-Z])/g, " $1")),
      type:
        name === "email"
          ? "email"
          : name === "productInterest"
            ? "textarea"
            : name === "mobile"
              ? "phone"
              : "text",
      required: name === "firstName" || name === "email",
    }));
    await api("/api/crm/lead-acquisition/forms", {
      name: String(form.get("name") || ""),
      sourceId: String(form.get("sourceId") || "") || null,
      campaignId: String(form.get("campaignId") || "") || null,
      ownerUserId: String(form.get("ownerUserId") || "") || null,
      allowedOrigins: String(form.get("origins") || "")
        .split(/[,\n]/)
        .map((value) => value.trim())
        .filter(Boolean),
      definition: { fields },
      consentText: String(form.get("consentText") || ""),
      duplicateStrategy: String(form.get("duplicateStrategy") || "warn"),
      captchaMode: "honeypot",
    });
  }
  async function createConnection(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const response = await api("/api/crm/lead-acquisition/connections", {
      provider: String(form.get("provider") || "custom"),
      displayName: String(form.get("displayName") || ""),
      credentialReference: String(form.get("credentialReference") || ""),
      webhookSecretReference: String(form.get("webhookSecretReference") || ""),
      status: String(form.get("status") || "sandbox"),
      configuration: {
        sourceId: String(form.get("sourceId") || "") || null,
        campaignId: String(form.get("campaignId") || "") || null,
      },
      metadata: { createdFrom: "lead-acquisition-workspace" },
    });
    if (response?.connection) setNewConnection(response.connection as Row);
  }
  async function requestEnrichment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    await api("/api/crm/lead-acquisition/enrichment", {
      entityType: "lead",
      entityId: String(form.get("entityId") || ""),
      provider: String(form.get("provider") || "custom"),
      requestedFields: [
        "companyName",
        "jobTitle",
        "website",
        "industry",
        "city",
        "state",
        "countryCode",
      ],
      proposedChanges: {},
      confidence: 0,
      provenance: { requestedFrom: "lead-acquisition-workspace" },
    });
  }

  const intake = [
    [
      "Manual capture",
      "Seller-entered lead with duplicate checking.",
      "create",
    ],
    [
      "Website forms",
      "Governed public forms with origin, consent and duplicate controls.",
      "forms",
    ],
    [
      "API capture",
      "Published capture keys for server-to-server intake.",
      "forms",
    ],
    [
      "Inbound email",
      "Convert normalized inbound mail into a lead and communication record.",
      "channels",
    ],
    [
      "Advertising & social",
      "Google Ads, Meta, LinkedIn and social acquisition adapters.",
      "channels",
    ],
    [
      "CSV / Excel import",
      "Preview, validate, commit and roll back up to 5,000 rows.",
      "imports",
    ],
  ];

  return (
    <div className="crm-suite-page crm-acq-page">
      <header className="crm-suite-command">
        <div>
          <p className="eyebrow">CRM · Lead acquisition</p>
          <h1>Acquisition control centre</h1>
          <p>
            Turn manual entry, forms, APIs, inbound email, advertising, social,
            chat and spreadsheets into governed CRM leads with provenance and
            duplicate control.
          </p>
        </div>
        <div className="crm-suite-command-actions">
          <Link className="secondary-button" href="/crm/leads">
            Lead queue
          </Link>
          <Link className="secondary-button" href="/crm/lead-intelligence">
            Intelligence
          </Link>
        </div>
      </header>
      <section className="crm-suite-metrics">
        {[
          ["Imports", summary.imports],
          ["Published forms", summary.published_forms],
          ["Active channels", summary.active_connections],
          ["Processed events", summary.processed_events],
          ["Open chats", summary.open_chats],
          ["Pending enrichment", summary.pending_enrichment],
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
            Acquisition readiness: {nice(readiness.readiness || "blocked")}
          </strong>
          <small>
            {String(readiness.score || 0)}% acceptance evidence. Real
            third-party providers still require their own credentials, webhook
            configuration and staging receipts.
          </small>
        </div>
      </section>
      <nav className="crm-suite-tabs" aria-label="Lead acquisition sections">
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

      {tab === "intake" ? (
        <div className="crm-acq-intake-grid">
          {intake.map(([title, description, destination], index) => (
            <article key={title}>
              <span className="crm-suite-number">
                {String(index + 1).padStart(2, "0")}
              </span>
              <h2>{title}</h2>
              <p>{description}</p>
              {destination === "create" ? (
                <Link href="/crm/leads?create=1">Open workflow →</Link>
              ) : (
                <button
                  className="link-button"
                  type="button"
                  onClick={() => setTab(destination)}
                >
                  {destination === "imports" ? "Import data" : "Configure"} →
                </button>
              )}
            </article>
          ))}
        </div>
      ) : null}

      {tab === "imports" ? (
        <div className="crm-suite-two-column">
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Batch import</p>
                <h2>CSV, XLSX and XLS with preview-first validation</h2>
              </div>
            </div>
            {permissions.canImport ? (
              <>
                <label className="crm-acq-file-drop">
                  <input
                    type="file"
                    accept=".csv,.xlsx,.xls,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    onChange={(event) => {
                      const file = event.currentTarget.files?.[0];
                      if (file) void selectWorkbook(file);
                    }}
                  />
                  <AppIcon name="import" size={22} />
                  <strong>Choose spreadsheet</strong>
                  <span>CSV, XLSX or XLS · maximum 5,000 rows</span>
                </label>
                {importState.rows.length ? (
                  <div className="crm-acq-import-preview">
                    <div>
                      <strong>{importState.fileName}</strong>
                      <span>
                        {importState.rows.length} rows ·{" "}
                        {importState.headers.length} columns
                      </span>
                    </div>
                    <label>
                      Duplicate handling
                      <select
                        value={duplicateStrategy}
                        onChange={(event) =>
                          setDuplicateStrategy(event.currentTarget.value)
                        }
                      >
                        <option value="skip">Skip matching leads</option>
                        <option value="warn">Warn / keep existing</option>
                        <option value="update">Update matching identity</option>
                        <option value="block">
                          Block batch row on duplicate
                        </option>
                      </select>
                    </label>
                    <div className="crm-acq-mapping">
                      {Object.entries(importState.mapping).map(
                        ([field, source]) =>
                          source ? (
                            <span key={field}>
                              <b>{nice(field.replace(/([A-Z])/g, " $1"))}</b> ←{" "}
                              {source}
                            </span>
                          ) : null,
                      )}
                    </div>
                    <div className="crm-suite-actions">
                      <button
                        className="secondary-button"
                        type="button"
                        disabled={pending}
                        onClick={() => void previewImport()}
                      >
                        Preview validation
                      </button>
                      {importState.batchId ? (
                        <button
                          className="primary-button"
                          type="button"
                          disabled={pending}
                          onClick={() => void commitImport()}
                        >
                          Commit valid rows
                        </button>
                      ) : null}
                    </div>
                    {importState.preview ? (
                      <div className="crm-acq-preview-result">
                        <strong>Preview ready</strong>
                        <span>
                          {String(
                            ((importState.preview.batch || {}) as Row)
                              .valid_rows || 0,
                          )}{" "}
                          valid ·{" "}
                          {String(
                            ((importState.preview.batch || {}) as Row)
                              .invalid_rows || 0,
                          )}{" "}
                          invalid
                        </span>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </>
            ) : (
              <p>You need CRM import permission to run spreadsheet imports.</p>
            )}
          </section>
          <section className="crm-suite-surface">
            <h2>Recent import batches</h2>
            <div className="crm-suite-list">
              {imports.slice(0, 12).map((row) => (
                <article key={String(row.id)}>
                  <div>
                    <strong>{String(row.file_name || "Import")}</strong>
                    <small>
                      {String(row.valid_rows || 0)} valid ·{" "}
                      {String(row.invalid_rows || 0)} invalid ·{" "}
                      {String(row.created_rows || 0)} created
                    </small>
                  </div>
                  <span>{nice(row.status)}</span>
                  {permissions.canImport &&
                  String(row.status) === "committed" ? (
                    <button
                      className="link-button danger"
                      type="button"
                      onClick={() => void rollbackImport(String(row.id))}
                    >
                      Rollback untouched
                    </button>
                  ) : null}
                </article>
              ))}
              {!imports.length ? <p>No import batches yet.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "forms" ? (
        <div className="crm-suite-two-column">
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Capture form builder</p>
                <h2>Publish only the information the workflow needs</h2>
              </div>
            </div>
            {permissions.canCapture ? (
              <form className="crm-suite-form" onSubmit={createForm}>
                <label>
                  Form name
                  <input
                    name="name"
                    required
                    placeholder="Website demo request"
                  />
                </label>
                <label>
                  Lead source
                  <select name="sourceId">
                    <option value="">None</option>
                    {options.sources?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Campaign
                  <select name="campaignId">
                    <option value="">None</option>
                    {options.campaigns?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Default owner
                  <select name="ownerUserId">
                    <option value="">Assignment policy / creator</option>
                    {options.users?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Allowed origins
                  <textarea
                    name="origins"
                    rows={3}
                    placeholder="https://vercentlabs.com"
                  />
                </label>
                <fieldset>
                  <legend>Lead fields</legend>
                  <div className="crm-suite-check-grid">
                    {[
                      "firstName",
                      "lastName",
                      "email",
                      "mobile",
                      "companyName",
                      "jobTitle",
                      "productInterest",
                    ].map((field) => (
                      <label key={field}>
                        <input
                          type="checkbox"
                          name={field}
                          defaultChecked={[
                            "firstName",
                            "email",
                            "mobile",
                            "companyName",
                          ].includes(field)}
                        />
                        <span>{nice(field.replace(/([A-Z])/g, " $1"))}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>
                <label>
                  Consent text
                  <textarea
                    name="consentText"
                    rows={3}
                    placeholder="I agree to be contacted about this enquiry."
                  />
                </label>
                <label>
                  Duplicate strategy
                  <select name="duplicateStrategy" defaultValue="warn">
                    <option value="warn">Warn / reuse existing</option>
                    <option value="skip">Skip duplicate</option>
                    <option value="update">Update duplicate identity</option>
                  </select>
                </label>
                <button className="primary-button" disabled={pending}>
                  Create draft form
                </button>
              </form>
            ) : (
              <p>You need capture-management permission to build forms.</p>
            )}
          </section>
          <section className="crm-suite-surface">
            <h2>Capture forms</h2>
            <div className="crm-suite-list">
              {forms.slice(0, 16).map((row) => (
                <article key={String(row.id)}>
                  <div>
                    <strong>{String(row.name)}</strong>
                    <small>
                      Version {String(row.version || 1)} · key{" "}
                      {String(row.public_key || "not published")}
                    </small>
                  </div>
                  <span>{nice(row.status)}</span>
                  {permissions.canCapture && String(row.status) !== "active" ? (
                    <button
                      className="link-button"
                      type="button"
                      onClick={() =>
                        void api("/api/crm/lead-acquisition/forms", {
                          action: "publish",
                          formId: row.id,
                        })
                      }
                    >
                      Publish
                    </button>
                  ) : null}
                </article>
              ))}
              {!forms.length ? <p>No capture forms yet.</p> : null}
            </div>
          </section>
        </div>
      ) : null}

      {tab === "channels" ? (
        <div className="crm-suite-two-column">
          <section className="crm-suite-surface">
            <div className="crm-suite-section-heading">
              <div>
                <p className="eyebrow">Acquisition adapter</p>
                <h2>Register a real intake channel</h2>
              </div>
            </div>
            {permissions.canIntegrate ? (
              <form className="crm-suite-form" onSubmit={createConnection}>
                <label>
                  Provider
                  <select name="provider" defaultValue="inbound_email">
                    <option value="inbound_email">Inbound email</option>
                    <option value="google_ads">Google Ads</option>
                    <option value="meta">Meta</option>
                    <option value="linkedin">LinkedIn</option>
                    <option value="instagram">Instagram</option>
                    <option value="facebook">Facebook</option>
                    <option value="whatsapp">WhatsApp lead event</option>
                    <option value="website_chat">Website chat</option>
                    <option value="custom">Custom webhook</option>
                  </select>
                </label>
                <label>
                  Connection name
                  <input
                    name="displayName"
                    required
                    placeholder="Sales inbox"
                  />
                </label>
                <label>
                  Lead source
                  <select name="sourceId">
                    <option value="">Not fixed</option>
                    {options.sources?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Campaign
                  <select name="campaignId">
                    <option value="">Not fixed</option>
                    {options.campaigns?.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Credential reference
                  <input
                    name="credentialReference"
                    placeholder="env:CRM_PROVIDER_CREDENTIAL"
                  />
                </label>
                <label>
                  Webhook secret reference
                  <input
                    name="webhookSecretReference"
                    placeholder="env:CRM_PROVIDER_WEBHOOK_SECRET"
                  />
                </label>
                <label>
                  Status
                  <select name="status" defaultValue="sandbox">
                    <option value="sandbox">Sandbox</option>
                    <option value="connected">Connected</option>
                    <option value="paused">Paused</option>
                  </select>
                </label>
                <button className="primary-button" disabled={pending}>
                  Create connection
                </button>
              </form>
            ) : (
              <p>
                You need integrations-management permission to connect
                providers.
              </p>
            )}
            {newConnection &&
            String(newConnection.provider) === "inbound_email" ? (
              <div className="crm-acq-endpoint">
                <strong>Inbound email endpoint created</strong>
                <code>{`/api/crm/lead-acquisition/public/email/${String(newConnection.webhook_key || "")}`}</code>
                <p>
                  Configure Gmail, Microsoft 365, SendGrid, Mailgun or another
                  inbound-mail service to POST normalized JSON containing
                  messageId, from, subject and body. Provider-side credentials
                  are external to the ERP.
                </p>
              </div>
            ) : null}
          </section>
          <section className="crm-suite-surface">
            <h2>Provider connections</h2>
            <div className="crm-suite-list">
              {connections.slice(0, 16).map((row) => (
                <article key={String(row.id)}>
                  <div>
                    <strong>{String(row.display_name || row.provider)}</strong>
                    <small>
                      {nice(row.provider)} · last event{" "}
                      {String(row.last_event_at || "never")}
                      {row.last_error ? ` · ${String(row.last_error)}` : ""}
                    </small>
                  </div>
                  <span>{nice(row.status)}</span>
                </article>
              ))}
              {!connections.length ? <p>No provider connections yet.</p> : null}
            </div>
            <div className="crm-suite-boundary">
              <strong>Provider boundary</strong>
              <p>
                Vercentlabs now owns ingestion, deduplication, assignment and
                provenance. External advertising, social and mail providers
                still require real credentials and provider-side webhook
                forwarding.
              </p>
            </div>
          </section>
        </div>
      ) : null}

      {tab === "events" ? (
        <section className="crm-suite-surface">
          <div className="crm-suite-section-heading">
            <div>
              <p className="eyebrow">Acquisition event stream</p>
              <h2>What entered the Lead pipeline</h2>
            </div>
          </div>
          <div className="crm-suite-table-scroll">
            <table className="crm-suite-table">
              <thead>
                <tr>
                  <th>Provider</th>
                  <th>Event</th>
                  <th>Channel</th>
                  <th>Status</th>
                  <th>Lead</th>
                  <th>Received</th>
                </tr>
              </thead>
              <tbody>
                {events.slice(0, 50).map((row) => (
                  <tr key={String(row.id)}>
                    <td>{nice(row.provider)}</td>
                    <td>{String(row.event_type || "lead.created")}</td>
                    <td>{nice(row.source_channel)}</td>
                    <td>{nice(row.status)}</td>
                    <td>
                      {row.lead_id ? (
                        <Link href={`/crm/leads/${String(row.lead_id)}`}>
                          Open lead
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td>{String(row.received_at || "—")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!events.length ? (
            <div className="crm-suite-empty">
              <strong>No acquisition events yet.</strong>
            </div>
          ) : null}
        </section>
      ) : null}

      {tab === "enrichment" ? (
        <div className="crm-suite-two-column">
          <section className="crm-suite-surface">
            <h2>Queue enrichment review</h2>
            {permissions.canEnrich ? (
              <form className="crm-suite-form" onSubmit={requestEnrichment}>
                <label>
                  Lead
                  <select name="entityId" required defaultValue="">
                    <option value="">Select lead</option>
                    {options.leads?.map((lead) => (
                      <option key={lead.id} value={lead.id}>
                        {lead.name}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  Provider
                  <input name="provider" defaultValue="custom" />
                </label>
                <p className="field-help">
                  Provider-supplied changes remain review-required and are never
                  silently written to the Lead.
                </p>
                <button className="primary-button" disabled={pending}>
                  Queue review
                </button>
              </form>
            ) : (
              <p>You need CRM data-quality permission to request enrichment.</p>
            )}
          </section>
          <section className="crm-suite-surface">
            <h2>Enrichment review queue</h2>
            <div className="crm-suite-list">
              {enrichment.slice(0, 20).map((row) => (
                <article key={String(row.id)}>
                  <div>
                    <strong>
                      {String(row.entity_type)} · {String(row.entity_id)}
                    </strong>
                    <small>
                      {String(row.provider)} · confidence{" "}
                      {String(row.confidence ?? "—")}
                    </small>
                  </div>
                  <span>{nice(row.status)}</span>
                  {permissions.canEnrich && String(row.status) === "pending" ? (
                    <div className="crm-suite-actions">
                      <button
                        className="link-button"
                        type="button"
                        onClick={() =>
                          void api("/api/crm/lead-acquisition/enrichment", {
                            action: "review",
                            reviewId: row.id,
                            decision: "approved",
                            acceptedKeys: [
                              "companyName",
                              "jobTitle",
                              "website",
                              "industry",
                              "city",
                              "state",
                              "countryCode",
                            ],
                          })
                        }
                      >
                        Approve
                      </button>
                      <button
                        className="link-button danger"
                        type="button"
                        onClick={() =>
                          void api("/api/crm/lead-acquisition/enrichment", {
                            action: "review",
                            reviewId: row.id,
                            decision: "rejected",
                            notes: "Rejected from Lead Acquisition",
                          })
                        }
                      >
                        Reject
                      </button>
                    </div>
                  ) : null}
                </article>
              ))}
              {!enrichment.length ? <p>No enrichment reviews.</p> : null}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
