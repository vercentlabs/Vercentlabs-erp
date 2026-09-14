"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ConfigurationRow = { id: string; namespace: string; config_key: string; version: number; effective_from: string; effective_to: string | null; status: string };
type FeatureFlagRow = { id: string; flag_key: string; enabled: boolean; version: number; effective_from: string; effective_to: string | null };
type RetentionRow = { id: string; data_class: string; retention_days: number; legal_basis: string; version: number; effective_from: string; effective_to: string | null };
type PrivacyRow = { id: string; request_type: string; subject_reference: string; status: string; requested_at: string; completed_at: string | null };
type ReportDefinition = { id: string; name: string; dataset_key: string; status: string; updated_at: string };
type ReportRun = { id: string; dataset_key: string; status: string; output_reference: string | null; requested_at: string };
type ReportDataset = { key: string; label: string; route: string };
type AiPolicy = { id: string; policy_key: string; enabled: boolean; allow_read: boolean; allow_propose: boolean; allow_execute: boolean; requires_approval: boolean; version: number };
type TagDefinition = { id: string; entity_type: string; name: string; color: string | null; status: string };

type Capabilities = {
  configuration: boolean;
  extensibility: boolean;
  privacy: boolean;
  reports: boolean;
  ai: boolean;
};

function messageOf(payload: unknown, fallback: string) {
  if (payload && typeof payload === "object" && "message" in payload) {
    const message = String((payload as { message?: unknown }).message || "").trim();
    if (message) return message;
  }
  return fallback;
}

export function PlatformGovernanceConsole(props: {
  capabilities: Capabilities;
  configurations: ConfigurationRow[];
  featureFlags: FeatureFlagRow[];
  retentionPolicies: RetentionRow[];
  privacyRequests: PrivacyRow[];
  reportDefinitions: ReportDefinition[];
  reportRuns: ReportRun[];
  reportDatasets: ReportDataset[];
  aiPolicies: AiPolicy[];
  tags: TagDefinition[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ kind: "success" | "error"; text: string } | null>(null);

  async function mutate(key: string, url: string, body: Record<string, unknown>, method = "POST") {
    setBusy(key);
    setMessage(null);
    try {
      const response = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(messageOf(payload, "Platform control update failed."));
      setMessage({ kind: "success", text: messageOf(payload, "Platform control updated.") });
      router.refresh();
      return payload as Record<string, unknown>;
    } catch (cause) {
      setMessage({ kind: "error", text: cause instanceof Error ? cause.message : "Platform control update failed." });
      return null;
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="stack-list">
      {message ? <div className={`alert ${message.kind}`} role={message.kind === "error" ? "alert" : "status"}>{message.text}</div> : null}

      {props.capabilities.configuration ? (
        <section className="dashboard-section" id="configuration" aria-labelledby="platform-configuration-title">
          <div className="section-title-row"><div><p className="eyebrow">SP026</p><h2 id="platform-configuration-title">Effective-dated configuration &amp; feature flags</h2><p>Versioned values are serialized per key and overlapping effective windows are rejected.</p></div></div>
          <div className="form-grid two-column">
            <form action={(form) => void mutate("configuration", "/api/platform/configuration", { action: "configuration", namespace: form.get("namespace"), key: form.get("key"), value: { value: form.get("value") }, effectiveFrom: form.get("effectiveFrom") || undefined })} className="panel form-grid">
              <label>Namespace<input name="namespace" required placeholder="operations" /></label>
              <label>Key<input name="key" required placeholder="default_queue" /></label>
              <label>Value<input name="value" required placeholder="standard" /></label>
              <label>Effective from<input name="effectiveFrom" type="datetime-local" /></label>
              <button disabled={busy === "configuration"} type="submit">{busy === "configuration" ? "Saving…" : "Add configuration version"}</button>
            </form>
            <form action={(form) => void mutate("feature-flag", "/api/platform/configuration", { action: "feature_flag", key: form.get("key"), enabled: form.get("enabled") === "on", effectiveFrom: form.get("effectiveFrom") || undefined })} className="panel form-grid">
              <label>Feature flag<input name="key" required placeholder="new_workspace" /></label>
              <label><input name="enabled" type="checkbox" /> Enabled</label>
              <label>Effective from<input name="effectiveFrom" type="datetime-local" /></label>
              <button disabled={busy === "feature-flag"} type="submit">{busy === "feature-flag" ? "Saving…" : "Add flag version"}</button>
            </form>
          </div>
          <div className="table-panel"><table><thead><tr><th>Configuration</th><th>Version</th><th>Status</th><th>Effective</th></tr></thead><tbody>{props.configurations.slice(0, 12).map((row) => <tr key={row.id}><td>{row.namespace}.{row.config_key}</td><td>{row.version}</td><td>{row.status}</td><td>{new Date(row.effective_from).toLocaleString()}</td></tr>)}{!props.configurations.length ? <tr><td colSpan={4}>No configuration versions recorded.</td></tr> : null}</tbody></table></div>
          <div className="table-panel"><table><thead><tr><th>Feature flag</th><th>Version</th><th>State</th><th>Effective</th></tr></thead><tbody>{props.featureFlags.slice(0, 12).map((row) => <tr key={row.id}><td>{row.flag_key}</td><td>{row.version}</td><td>{row.enabled ? "Enabled" : "Disabled"}</td><td>{new Date(row.effective_from).toLocaleString()}</td></tr>)}{!props.featureFlags.length ? <tr><td colSpan={4}>No feature flags recorded.</td></tr> : null}</tbody></table></div>
        </section>
      ) : null}

      {props.capabilities.extensibility ? (
        <section className="dashboard-section" id="extensibility" aria-labelledby="platform-extensibility-title">
          <div className="section-title-row"><div><p className="eyebrow">SP021</p><h2 id="platform-extensibility-title">Controlled extensibility</h2><p>Shared tags are typed by entity family; custom fields remain governed by the existing typed custom-field platform.</p></div></div>
          <form action={(form) => void mutate("tag", "/api/platform/tags", { action: "definition", entityType: form.get("entityType"), name: form.get("name"), color: form.get("color") || undefined })} className="form-grid">
            <label>Entity type<input name="entityType" required placeholder="crm.lead" /></label>
            <label>Tag name<input name="name" required placeholder="Strategic" /></label>
            <label>Colour<input name="color" type="color" defaultValue="#64748b" /></label>
            <button disabled={busy === "tag"} type="submit">{busy === "tag" ? "Saving…" : "Create tag"}</button>
          </form>
          <div className="table-panel"><table><thead><tr><th>Entity type</th><th>Tag</th><th>Colour</th><th>Status</th></tr></thead><tbody>{props.tags.map((row) => <tr key={row.id}><td>{row.entity_type}</td><td>{row.name}</td><td>{row.color || "—"}</td><td>{row.status}</td></tr>)}{!props.tags.length ? <tr><td colSpan={4}>No shared tags defined.</td></tr> : null}</tbody></table></div>
        </section>
      ) : null}

      {props.capabilities.privacy ? (
        <section className="dashboard-section" id="privacy" aria-labelledby="platform-privacy-title">
          <div className="section-title-row"><div><p className="eyebrow">SP028</p><h2 id="platform-privacy-title">Privacy, retention &amp; data-subject controls</h2><p>Retention policy is effective-dated; requests use a governed lifecycle rather than destructive direct deletion.</p></div></div>
          <div className="form-grid two-column">
            <form action={(form) => void mutate("retention", "/api/platform/privacy", { action: "retention_policy", dataClass: form.get("dataClass"), retentionDays: Number(form.get("retentionDays")), legalBasis: form.get("legalBasis") })} className="panel form-grid">
              <label>Data class<input name="dataClass" required placeholder="customer_contact" /></label>
              <label>Retention days<input name="retentionDays" required type="number" min={1} max={36500} defaultValue={3650} /></label>
              <label>Legal basis<input name="legalBasis" required placeholder="Contract / statutory requirement" /></label>
              <button disabled={busy === "retention"} type="submit">{busy === "retention" ? "Saving…" : "Add retention version"}</button>
            </form>
            <form action={(form) => void mutate("privacy-request", "/api/platform/privacy", { action: "request", requestType: form.get("requestType"), subjectReference: form.get("subjectReference") })} className="panel form-grid">
              <label>Request type<select name="requestType" defaultValue="access"><option value="access">Access</option><option value="export">Export</option><option value="correction">Correction</option><option value="restriction">Restriction</option><option value="erasure">Erasure</option><option value="consent_withdrawal">Consent withdrawal</option></select></label>
              <label>Subject reference<input name="subjectReference" required placeholder="contact:… / verified email hash" /></label>
              <button disabled={busy === "privacy-request"} type="submit">{busy === "privacy-request" ? "Creating…" : "Create privacy request"}</button>
            </form>
          </div>
          <div className="table-panel"><table><thead><tr><th>Request</th><th>Subject</th><th>Status</th><th>Requested</th></tr></thead><tbody>{props.privacyRequests.slice(0, 20).map((row) => <tr key={row.id}><td>{row.request_type}</td><td>{row.subject_reference}</td><td>{row.status}</td><td>{new Date(row.requested_at).toLocaleString()}</td></tr>)}{!props.privacyRequests.length ? <tr><td colSpan={4}>No privacy requests recorded.</td></tr> : null}</tbody></table></div>
          <p className="billing-commercial-note">{props.retentionPolicies.length} retention policy version{props.retentionPolicies.length === 1 ? "" : "s"} recorded.</p>
        </section>
      ) : null}

      {props.capabilities.reports ? (
        <section className="dashboard-section" id="reports" aria-labelledby="platform-reports-title">
          <div className="section-title-row"><div><p className="eyebrow">SP031</p><h2 id="platform-reports-title">Governed shared report definitions</h2><p>Definitions launch only real module reports and re-check the underlying module report permission. T01 does not pretend to provide a scheduler or arbitrary SQL builder.</p></div></div>
          <form action={(form) => void mutate("report-definition", "/api/platform/reports", { action: "definition", name: form.get("name"), datasetKey: form.get("datasetKey"), columns: [] })} className="form-grid">
            <label>Name<input name="name" required placeholder="Weekly sales review" /></label>
            <label>Report family<select name="datasetKey" required>{props.reportDatasets.map((dataset) => <option value={dataset.key} key={dataset.key}>{dataset.label}</option>)}</select></label>
            <button disabled={busy === "report-definition" || !props.reportDatasets.length} type="submit">{busy === "report-definition" ? "Saving…" : "Save report definition"}</button>
          </form>
          <div className="table-panel"><table><thead><tr><th>Definition</th><th>Dataset</th><th>Status</th><th>Open</th></tr></thead><tbody>{props.reportDefinitions.map((row) => <tr key={row.id}><td>{row.name}</td><td>{row.dataset_key}</td><td>{row.status}</td><td><button type="button" disabled={busy === `report:${row.id}`} onClick={async () => { const payload = await mutate(`report:${row.id}`, "/api/platform/reports", { action: "run", reportDefinitionId: row.id }); const target = payload?.output_reference; if (typeof target === "string" && target.startsWith("/")) window.location.assign(target); }}>Open governed report</button></td></tr>)}{!props.reportDefinitions.length ? <tr><td colSpan={4}>No shared report definitions saved.</td></tr> : null}</tbody></table></div>
          <p className="billing-commercial-note">{props.reportRuns.length} governed report launch{props.reportRuns.length === 1 ? "" : "es"} recorded.</p>
        </section>
      ) : null}

      {props.capabilities.ai ? (
        <section className="dashboard-section" id="ai" aria-labelledby="platform-ai-title">
          <div className="section-title-row"><div><p className="eyebrow">SP036</p><h2 id="platform-ai-title">AI governance policy</h2><p>AI is denied until policy exists; execute capability is off by default and normal approval/public-command authority remains mandatory.</p></div></div>
          <form action={(form) => void mutate("ai-policy", "/api/platform/ai", { action: "policy", policyKey: form.get("policyKey"), enabled: form.get("enabled") === "on", allowRead: form.get("allowRead") === "on", allowPropose: form.get("allowPropose") === "on", allowExecute: false, requiresApproval: true, allowedTools: String(form.get("allowedTools") || "").split(/[\s,]+/).filter(Boolean) })} className="form-grid">
            <label>Policy key<input name="policyKey" required placeholder="erp.copilot.default" /></label>
            <label><input name="enabled" type="checkbox" defaultChecked /> Enabled</label>
            <label><input name="allowRead" type="checkbox" defaultChecked /> Allow governed reads</label>
            <label><input name="allowPropose" type="checkbox" defaultChecked /> Allow proposals</label>
            <label>Allowed tool/action keys<input name="allowedTools" placeholder="crm.lead.summarize" /></label>
            <button disabled={busy === "ai-policy"} type="submit">{busy === "ai-policy" ? "Saving…" : "Save AI policy version"}</button>
          </form>
          <div className="table-panel"><table><thead><tr><th>Policy</th><th>Version</th><th>Read</th><th>Propose</th><th>Execute</th><th>Approval</th></tr></thead><tbody>{props.aiPolicies.map((row) => <tr key={row.id}><td>{row.policy_key}</td><td>{row.version}</td><td>{row.allow_read ? "Yes" : "No"}</td><td>{row.allow_propose ? "Yes" : "No"}</td><td>{row.allow_execute ? "Yes" : "No"}</td><td>{row.requires_approval ? "Required" : "No"}</td></tr>)}{!props.aiPolicies.length ? <tr><td colSpan={6}>No AI policy exists. AI remains fail-closed.</td></tr> : null}</tbody></table></div>
        </section>
      ) : null}
    </div>
  );
}
