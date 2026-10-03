// F018 — Email. The ONE canonical communication audience/content
// projector. Participant/team visibility and stricter-than-record content
// visibility are two SEPARATE authorization decisions:
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
// Every read surface (recordScope, getCommunicationTimeline, the Timeline's
// visibilityPredicate, the shared inbox and mobile) calls into this module
// rather than hand-rolling its own private/team predicate.
//
// Lives in the record kernel because generic CRM record scope and projection
// (record-policy.js) apply it to the "communications" resource; the
// communication services in activities/ import it from here.
import { canOverridePrivateCrmContent } from "./crm-access-scope.js";
import { canViewSensitiveLeadContent } from "../leads/access.js";


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
  // ::boolean is required, not cosmetic: node-postgres's extended query
  // protocol sends parameter values before Postgres has parsed enough of
  // the query to infer this placeholder's type from a bare `OR $N OR`
  // position, producing a real, reproducible "could not determine data
  // type of parameter" 500 on every call (mocked client.query tests never
  // parse/type-check SQL, so only a real database catches this).
  // Private/participant communications: override is CRM administration.
  const viewAllParam = addParam(values, canOverridePrivateCrmContent(context));
  const orgIdParam = addParam(values, context.organizationId);
  return `(${alias}.visibility='team' OR ${alias}.created_by=${userIdParam} OR ${viewAllParam}::boolean OR (${alias}.visibility='participant' AND EXISTS(
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
