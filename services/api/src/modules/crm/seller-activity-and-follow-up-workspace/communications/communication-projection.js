// Prompt 6 (CRM-CAP-004, F018 — Email), final closeout pass. This is the
// ONE canonical communication audience/content projector — the dossier's
// "participant/team visibility" (F018-CAP-002) plus "sensitive fields/
// content MUST support stricter field/content visibility than record
// visibility" (F018-SEC-002) are two SEPARATE authorization decisions:
//
//   AUDIENCE  — may this caller know the communication exists at all?
//               (parent-record scope + visibility tier: team/private/
//               participant)
//   CONTENT   — may this caller read subject/body/recipients/attachments,
//               or only a metadata stub ("Email sent, 10 Sep, 10:30")?
//               (the existing crm.leads.view_sensitive-style gate, OR
//               being the sender/a participant on THIS communication —
//               you can always read what you sent or personally received)
//
// Before this module, three call sites (index.js's recordScope,
// communications.js's getCommunicationTimeline, timeline.js's
// visibilityPredicate) each hand-rolled an equivalent but independently-
// written private/team predicate, and none supported a metadata-only
// projection at all — without crm.leads.view_sensitive the whole
// communication was invisible, never merely content-redacted. All three
// (plus the shared inbox and mobile) now call into this module.
import { canViewSensitiveLeadContent } from "../../lead-security.js";

// Local copy of the "organization_owner or crm.records.view_all" check —
// communications.js, timeline.js and index.js each already carry their own
// copy of this exact check by established convention in this codebase
// (see communications.js's own top-of-file comment); this module follows
// the same convention rather than introducing a fourth import path for it.
export function canViewAllCrmRecords(context) {
  return Boolean(context.roleSlugs?.includes("organization_owner")) || Boolean(context.permissions?.includes("crm.records.view_all"));
}

function addParam(values, value) {
  values.push(value);
  return `$${values.length}`;
}

// The ONE audience SQL fragment for the visibility tier (team/private/
// participant) — deliberately does NOT include the content-sensitivity
// gate (that is a projection-time decision now, not a row-visibility
// decision, so a caller without crm.leads.view_sensitive can still know a
// team-visible communication exists and see its metadata). Callers still
// own their own parent-record scope predicate (lead/opportunity/party/
// contact/standalone) — that part differs per call site and stays there.
export function communicationVisibilitySql(context, values, alias = "communication") {
  const userIdParam = addParam(values, context.userId);
  const viewAllParam = addParam(values, canViewAllCrmRecords(context));
  const orgIdParam = addParam(values, context.organizationId);
  return `(${alias}.visibility='team' OR ${alias}.created_by=${userIdParam} OR ${viewAllParam} OR (${alias}.visibility='participant' AND EXISTS(
    SELECT 1 FROM tenant.crm_communication_participants participant
     WHERE participant.organization_id=${orgIdParam} AND participant.communication_id=${alias}.id AND participant.user_id=${userIdParam}
  )))`;
}

// Bulk-resolves which of the given communication ids the caller
// participates in (sender/recipient/cc/bcc) — used by the content-
// visibility decision below (a participant can always read what they sent
// or personally received, regardless of the broader sensitive-content
// permission).
export async function resolveCallerParticipantCommunicationIds(client, context, communicationIds) {
  const ids = Array.from(new Set((communicationIds || []).filter(Boolean)));
  if (!ids.length) return new Set();
  const result = await client.query(
    `SELECT DISTINCT communication_id FROM tenant.crm_communication_participants
      WHERE organization_id=$1 AND user_id=$2 AND communication_id = ANY($3::uuid[])`,
    [context.organizationId, context.userId, ids],
  );
  return new Set(result.rows.map((row) => row.communication_id));
}

const METADATA_FIELDS = new Set(["id", "channel", "direction", "status", "occurredAt", "occurred_at", "createdAt", "created_at"]);

// Projects one already-audience-visible communication row into what this
// caller may actually read. `isParticipant` should come from
// resolveCallerParticipantCommunicationIds (or an inline per-row EXISTS
// check for single-row call sites) — NOT re-derived per surface.
export function projectCrmCommunication(row, context, { isParticipant = false } = {}) {
  if (!row) return null;
  const canSeeContent = canViewSensitiveLeadContent(context) || row.created_by === context.userId || row.createdBy === context.userId || isParticipant;
  if (canSeeContent) return { ...row, contentVisibility: "full" };
  const metadata = {};
  for (const [key, value] of Object.entries(row)) {
    if (METADATA_FIELDS.has(key)) metadata[key] = value;
  }
  return { ...metadata, contentVisibility: "metadata", redacted: true };
}

// Batch form — projects every row in one pass, resolving participant
// membership in a single query rather than one per row.
export async function projectCrmCommunications(client, context, rows) {
  if (!rows?.length) return [];
  if (canViewSensitiveLeadContent(context)) return rows.map((row) => ({ ...row, contentVisibility: "full" }));
  const ids = rows.map((row) => row.id);
  const participantIds = await resolveCallerParticipantCommunicationIds(client, context, ids);
  return rows.map((row) => projectCrmCommunication(row, context, { isParticipant: participantIds.has(row.id) }));
}

// Write-time participant resolution — called by both outbound send
// (queueOutboundEmail) and inbound ingestion (ingestMailboxDelta) right
// after the crm_communications row is inserted. Resolves each address
// against public.users (internal — the ONLY thing that can ever satisfy
// the participant-visibility check) and tenant.contacts (external CRM
// Contact — participant metadata only, never application access) by exact
// email match. An address matching neither is still recorded (role +
// email_address always present) so the full participant list stays
// complete for display even when resolution fails.
export async function resolveCommunicationParticipants(client, context, communicationId, participants) {
  const rows = (participants || []).filter((entry) => entry?.email);
  if (!rows.length) return;
  const addresses = Array.from(new Set(rows.map((entry) => String(entry.email).toLowerCase())));
  const [users, contacts] = await Promise.all([
    client.query(`SELECT id, lower(email) AS email FROM public.users WHERE lower(email) = ANY($1::text[])`, [addresses]),
    client.query(`SELECT id, lower(email) AS email FROM tenant.contacts WHERE organization_id=$1 AND lower(email) = ANY($2::text[])`, [context.organizationId, addresses]),
  ]);
  const userByEmail = new Map(users.rows.map((row) => [row.email, row.id]));
  const contactByEmail = new Map(contacts.rows.map((row) => [row.email, row.id]));
  for (const entry of rows) {
    const email = String(entry.email).toLowerCase();
    await client.query(
      `INSERT INTO tenant.crm_communication_participants(organization_id, communication_id, role, email_address, user_id, contact_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, communication_id, role, email_address) DO UPDATE SET user_id=EXCLUDED.user_id, contact_id=EXCLUDED.contact_id`,
      [context.organizationId, communicationId, entry.role, email, userByEmail.get(email) || null, contactByEmail.get(email) || null],
    );
  }
}
