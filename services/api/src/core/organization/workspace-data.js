// Leaving Vercentlabs (Shared Platform plan 3):
//   requestWorkspaceExport / buildWorkspaceExport   one zip of everything the company has: a CSV per table (every row of every
//       company-owned table; secret and hash columns left out) and every current file, built in the background and kept 7 days;
//       the owner is told when it is ready.
//   requestWorkspaceClosure / cancelWorkspaceClosure / closeDueWorkspaces   closing the workspace: the owner confirms with the
//       password and the company's name; it closes after a 30-day waiting period (the owner may cancel until then); a closed
//       workspace cannot be signed in to. Its data is kept for the export and then erased on request by Vercentlabs operations
//       (DPDP erasure; docs/operations/DISASTER_RECOVERY_RUNBOOK.md, "Erase a closed company").
import { buildZip } from "../platform/data-exchange/zip.js";
import { readFileContent, storeFile } from "../platform/files/index.js";
import { createNotification } from "../platform/notifications/index.js";
import { createOpaqueToken } from "../auth/session.js";
import { CONFIRM_WITH_CODE, identityConfirmed } from "../auth/code-sign-in.js";
import { sendSecurityAlert } from "../auth/profile.js";
import { audit } from "../security/request-security.js";
import { organizationScopedTables } from "@vercentlabs/database";

export const WORKSPACE_EXPORT_JOB_TYPE = "platform.workspace.export";
export const CLOSURE_WAITING_DAYS = 30;
const EXPORT_KEEP_DAYS = 7;
const SECRET_COLUMN = /(secret|password|token|hash|encrypted|credential|signature_value|private_key|api_key)/i;
const MAX_EXPORT_BYTES = 900 * 1024 * 1024;

export class WorkspaceDataError extends Error {
  constructor(status, message, code = "WORKSPACE_DATA_ERROR") {
    super(message);
    this.name = "WorkspaceDataError";
    this.status = status;
    this.code = code;
  }
}

const isOwner = (session) => session.roleSlugs?.includes("organization_owner");

// ---------------------------------------------------------------- export

export async function requestWorkspaceExport(client, session) {
  if (!isOwner(session) && !session.roleSlugs?.includes("system_administrator")) {
    throw new WorkspaceDataError(403, "Only the owner or a system administrator can export the whole workspace.", "WORKSPACE_EXPORT_DENIED");
  }
  const running = (await client.query(
    `SELECT id FROM tenant.background_jobs WHERE organization_id = $1 AND job_type = $2 AND status IN ('pending', 'processing') LIMIT 1`, [session.organizationId, WORKSPACE_EXPORT_JOB_TYPE])).rows[0];
  if (running) return { jobId: running.id, alreadyRunning: true };
  const job = (await client.query(
    `INSERT INTO tenant.background_jobs (organization_id, job_type, payload, status, run_at, priority, max_attempts, requested_by, idempotency_key)
     VALUES ($1, $2, $3::jsonb, 'pending', now(), 200, 2, $4, $5) RETURNING id`,
    [session.organizationId, WORKSPACE_EXPORT_JOB_TYPE, JSON.stringify({ requestedBy: session.userId }), session.userId, `workspace-export:${createOpaqueToken().slice(0, 24)}`])).rows[0];
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.export.requested", entityType: "organization", entityId: session.organizationId });
  return { jobId: job.id, alreadyRunning: false };
}

function csvCell(value) {
  if (value === null || value === undefined) return "";
  const text = value instanceof Date ? value.toISOString() : typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\r\n]/.test(text) || /^[=+\-@]/.test(text) ? `"${(/^[=+\-@]/.test(text) ? `'${text}` : text).replace(/"/g, '""')}"` : text;
}

async function companyTables(client) {
  const tenantTables = (await client.query(
    `SELECT table_name FROM information_schema.columns WHERE table_schema = 'tenant' AND column_name = 'organization_id' ORDER BY table_name`)).rows.map((row) => `tenant.${row.table_name}`);
  return [...organizationScopedTables().map((name) => `public.${name}`), ...tenantTables];
}

// The worker's job (in the company's own transaction): every table as CSV, every current file, one zip, stored for 7 days.
export async function buildWorkspaceExport(client, { organizationId, requestedBy }, { storage, env = process.env } = {}) {
  const entries = [];
  let bytes = 0;
  const summary = [];
  for (const table of await companyTables(client)) {
    const [schema, name] = table.split(".");
    const columns = (await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 ORDER BY ordinal_position`, [schema, name])).rows
      .map((row) => row.column_name).filter((column) => !SECRET_COLUMN.test(column));
    if (!columns.length) continue;
    const { rows } = await client.query(`SELECT ${columns.map((column) => `"${column}"`).join(", ")} FROM ${schema}."${name}" WHERE organization_id = $1`, [organizationId]);
    if (!rows.length) continue;
    const csv = [columns.join(","), ...rows.map((row) => columns.map((column) => csvCell(row[column])).join(","))].join("\r\n");
    const data = Buffer.from(`﻿${csv}`, "utf8");
    bytes += data.length;
    entries.push({ path: `data/${schema}.${name}.csv`, data });
    summary.push({ table: `${schema}.${name}`, rows: rows.length });
  }
  const files = (await client.query(
    `SELECT id, entity_type, entity_id, file_name FROM public.attachments WHERE organization_id = $1 AND is_current AND content_removed_at IS NULL AND lifecycle_status <> 'archived'
       AND entity_type <> 'platform.workspace_export' ORDER BY created_at`, [organizationId])).rows;
  let filesIncluded = 0;
  for (const file of files) {
    if (bytes > MAX_EXPORT_BYTES) break;
    try {
      const content = await readFileContent(client, { organizationId, entityType: file.entity_type, entityId: file.entity_id, fileId: file.id }, { storage, env });
      bytes += content.body.length;
      entries.push({ path: `files/${file.entity_type}/${file.entity_id}/${file.id}-${String(file.file_name).replace(/[\\/:*?"<>|]/g, "_")}`, data: content.body });
      filesIncluded += 1;
    } catch {
      // A file whose content is gone or unreadable is listed in the summary, not fatal.
    }
  }
  const readme = [
    "Vercentlabs ERP — full workspace export",
    `Made: ${new Date().toISOString()}`,
    "",
    "data/   one CSV per table (UTF-8, first row = column names). Passwords, tokens and other secrets are never included.",
    "files/  every current file, by record type and record id.",
    "",
    ...summary.map((entry) => `${entry.table}: ${entry.rows} rows`),
    `files: ${filesIncluded} of ${files.length}${filesIncluded < files.length ? " (the rest were too large for one export or unreadable; ask support)" : ""}`,
  ].join("\r\n");
  entries.unshift({ path: "README.txt", data: Buffer.from(readme, "utf8") });
  const zip = buildZip(entries);
  const day = new Date().toISOString().slice(0, 10);
  const stored = await storeFile(client, {
    organizationId, entityType: "platform.workspace_export", entityId: organizationId, purpose: "export", uploadedBy: requestedBy ?? null,
    expiresAt: new Date(Date.now() + EXPORT_KEEP_DAYS * 86_400_000), classification: "confidential",
    prepared: { fileName: `workspace-export-${day}.zip`, mimeType: "application/zip", bytes: zip, sizeBytes: zip.length,
      contentSha256: (await import("node:crypto")).createHash("sha256").update(zip).digest("hex"), scanStatus: "not_applicable" },
  }, { storage, env });
  if (requestedBy) {
    await createNotification(client, { organizationId, userId: requestedBy, category: "workspace_export", title: "Your workspace export is ready",
      message: `Download it from Settings › Company › Your data within ${EXPORT_KEEP_DAYS} days.`, href: "/settings/organization", entityType: "platform.workspace_export", entityId: stored.id });
  }
  return { fileId: stored.id, tables: summary.length, files: filesIncluded, bytes: zip.length };
}

export async function listWorkspaceExports(client, organizationId) {
  return (await client.query(
    `SELECT id, file_name, size_bytes, created_at, expires_at FROM public.attachments
      WHERE organization_id = $1 AND entity_type = 'platform.workspace_export' AND content_removed_at IS NULL AND (expires_at IS NULL OR expires_at > now())
      ORDER BY created_at DESC LIMIT 5`, [organizationId])).rows
    .map((row) => ({ id: row.id, fileName: row.file_name, sizeBytes: Number(row.size_bytes), createdAt: row.created_at, expiresAt: row.expires_at }));
}

export async function readWorkspaceExport(client, session, fileId, options = {}) {
  if (!isOwner(session) && !session.roleSlugs?.includes("system_administrator")) throw new WorkspaceDataError(403, "Only the owner or a system administrator can download the export.", "WORKSPACE_EXPORT_DENIED");
  const content = await readFileContent(client, { organizationId: session.organizationId, entityType: "platform.workspace_export", entityId: session.organizationId, fileId }, options);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.export.downloaded", entityType: "attachment", entityId: fileId });
  return content;
}

// ---------------------------------------------------------------- closure

export async function getWorkspaceClosure(client, organizationId) {
  const row = (await client.query(`SELECT closure_requested_at, closure_scheduled_for, closed_at FROM public.organizations WHERE id = $1`, [organizationId])).rows[0] ?? {};
  return { requestedAt: row.closure_requested_at ?? null, closesOn: row.closure_scheduled_for ?? null, closedAt: row.closed_at ?? null, waitingDays: CLOSURE_WAITING_DAYS };
}

export async function requestWorkspaceClosure(client, session, { password, confirmName } = {}, env = process.env) {
  if (!isOwner(session)) throw new WorkspaceDataError(403, "Only the owner can close the workspace.", "WORKSPACE_CLOSE_DENIED");
  const organization = (await client.query(`SELECT name, closure_scheduled_for FROM public.organizations WHERE id = $1 FOR UPDATE`, [session.organizationId])).rows[0];
  if (organization.closure_scheduled_for) return getWorkspaceClosure(client, session.organizationId);
  if (String(confirmName ?? "").trim() !== organization.name) throw new WorkspaceDataError(422, `Type the company's name (${organization.name}) to confirm.`, "WORKSPACE_CLOSE_CONFIRM");
  const me = (await client.query(`SELECT email, full_name, password_hash FROM users WHERE id = $1`, [session.userId])).rows[0];
  const confirmed = await identityConfirmed(client, { userId: session.userId, sessionId: session.sessionId, password });
  if (!confirmed.ok) throw confirmed.needsCode ? new WorkspaceDataError(403, CONFIRM_WITH_CODE, "AUTH_REAUTH_REQUIRED") : new WorkspaceDataError(403, "The password is not right.", "WORKSPACE_CLOSE_PASSWORD");
  const paid = (await client.query(
    `SELECT 1 FROM public.organization_subscriptions WHERE organization_id = $1 AND provider_subscription_id IS NOT NULL AND status IN ('active', 'authenticated', 'past_due') AND NOT cancel_at_cycle_end`,
    [session.organizationId])).rows[0];
  if (paid) throw new WorkspaceDataError(409, "Cancel the paid subscription in Billing first, so you are not charged again.", "WORKSPACE_CLOSE_PAID");
  await client.query(
    `UPDATE public.organizations SET closure_requested_at = now(), closure_requested_by = $2, closure_scheduled_for = now() + make_interval(days => $3), updated_at = now() WHERE id = $1`,
    [session.organizationId, session.userId, CLOSURE_WAITING_DAYS]);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.closure.requested", entityType: "organization", entityId: session.organizationId });
  const closure = await getWorkspaceClosure(client, session.organizationId);
  await sendSecurityAlert(me, { subject: `${organization.name} will close in ${CLOSURE_WAITING_DAYS} days`, heading: "Workspace closing",
    message: `You asked to close ${organization.name} on Vercentlabs ERP. It closes on ${new Date(closure.closesOn).toLocaleDateString("en-IN")}; until then you can cancel from Settings › Company. Export your data before then.` }, env, client).catch(() => false);
  return closure;
}

export async function cancelWorkspaceClosure(client, session) {
  if (!isOwner(session)) throw new WorkspaceDataError(403, "Only the owner can cancel the closure.", "WORKSPACE_CLOSE_DENIED");
  await client.query(`UPDATE public.organizations SET closure_requested_at = NULL, closure_requested_by = NULL, closure_scheduled_for = NULL, updated_at = now() WHERE id = $1 AND closed_at IS NULL`, [session.organizationId]);
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "organization.closure.cancelled", entityType: "organization", entityId: session.organizationId });
  return getWorkspaceClosure(client, session.organizationId);
}

// Worker: workspaces whose waiting period ended are closed — nobody can sign in, every session ends. (Platform client; the
// organization directory and sessions are not tenant-scoped.)
// Run by the worker, whose role may not change the organization directory itself: an owner-run function (migration 0223) marks the
// workspaces closed and revokes their members' sessions.
export async function closeDueWorkspaces(client, { limit = 20 } = {}) {
  return Number((await client.query("SELECT public.close_due_workspaces($1) AS closed", [limit])).rows[0]?.closed ?? 0);
}
