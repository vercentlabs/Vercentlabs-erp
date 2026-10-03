// F019 — Activity Timeline. The one canonical timeline projection all four
// record types (Lead, Account, Contact, Opportunity) use — never one
// hand-rolled implementation (and security model) per record type.
//
// Design notes:
//  - Sources merged: crm_activities (Calls/Meetings/Tasks/Follow-ups/Email/
//    WhatsApp/SMS — every activity_type, one row shape already), crm_
//    communications (its own party/opportunity/lead/contact FK columns,
//    not a generic entity_type/entity_id pair — branched per entityType
//    below), crm_notes (respecting the F017 private-visibility column),
//    public.attachments (the governed file upload record — 'crm.<entityType>'
//    is the entity_type convention the attachment service writes, so files
//    show up on every record type's Timeline).
//    Deliberately NOT merged: crm_outbox_events (internal/non-user-facing),
//    lifecycle/stage/score/assignment/consent/merge history (these remain
//    separate detail panels per record type — folding several more
//    differently-shaped history tables into one feed is out of proportion;
//    each has its own tested query elsewhere, shown as distinct panels
//    alongside the unified activity feed).
//  - Authorization is enforced at TWO levels, because parent-record access
//    alone cannot decide item visibility: (1) resolveCrmEntityAccess() (data-management/entity-access.js) gates the whole call on the
//    entity-type-appropriate sensitive-content permission (mirrors Lead's
//    canViewSensitiveLeadContent, Account's canViewSensitiveAccountContent,
//    Contact's canViewSensitiveContactContent, Opportunity's established
//    reuse of Lead's own permission — see opportunity-detail-data.ts's
//    `canSeeOpportunitySensitiveContent = canViewSensitiveLeadContent`);
//    (2) EACH source branch in the UNION carries its own additional
//    predicate where one exists — notes' `visibility<>'private' OR
//    created_by=$caller OR $canViewAll` is the one case where an item can
//    be excluded even for an otherwise-authorized caller, so a private
//    Note never crosses this query for anyone but its author or an
//    explicit view-all override.
//  - Pagination is real cursor-based (occurred_at, id) tuple comparison,
//    not OFFSET — the duplicate/skip risk under concurrent inserts (an OFFSET page shifts when a new row is inserted
//    ahead of it) cannot happen here: a cursor value that already has a
//    stable position never moves.
import { canOverridePrivateCrmContent } from "../../data-management/crm-access-scope.js";
import { resolveCrmEntityAccess } from "../../data-management/entity-access.js";
import { recordScope } from "../../data-management/record-policy.js";
import { resources } from "../../data-management/resource-registry.js";
import { CrmError } from "../../data-management/errors.js";
import { canViewSensitiveLeadContent } from "../../leads/access.js";
import { canViewSensitiveAccountContent } from "../../accounts/access.js";
import { canViewSensitiveContactContent } from "../../contacts/access.js";
import { communicationVisibilitySql, projectCrmCommunications } from "../../data-management/communication-access.js";

// Re-exported for existing importers; the implementation lives in the
// record kernel next to the other CRM access rules.
export { resolveCrmEntityAccess };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_KINDS = new Set(["activity", "communication", "note", "attachment", "stage", "history"]);
// Kinds getCrmTimelinePageBySource can serve as full-row single-kind lists;
// the audit-event kinds (stage, history) exist only in the merged feed's
// narrow envelope.
const SINGLE_SOURCE_KINDS = new Set(["activity", "communication", "note", "attachment"]);
const COMMUNICATION_COLUMN = { lead: "lead_id", opportunity: "opportunity_id", party: "party_id", contact: "contact_id", campaign: null };


function camelize(key) { return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()); }
function dto(row) { return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value])); }

function add(values, value) { values.push(value); return `$${values.length}`; }

// The record itself, plus — for an opportunity converted from a lead — that
// lead: its completed activities and files stay on the lead and are shown
// on the opportunity through the conversion link.
function entityMatchSql(entityType, entityIdParam, typeColumn, idColumn, { typePrefix = "", idCast = "" } = {}) {
  const own = `(${typeColumn}='${typePrefix}${entityType}' AND ${idColumn}=${entityIdParam}${idCast})`;
  if (entityType !== "opportunity") return own;
  return `(${own} OR (${typeColumn}='${typePrefix}lead' AND ${idColumn}=(SELECT source.lead_id FROM tenant.crm_opportunities source WHERE source.organization_id=$1 AND source.id=${entityIdParam}::uuid)${idCast}))`;
}

// The ONE place each source kind's visibility predicate is written — a
// private Note/communication is invisible to anyone but its author or an
// organization-wide view-all override. Both the merged-feed envelope
// builder (buildBranch, below) and the full-row single-kind builder
// (buildSourceQuery, used by getCrmTimelinePageBySource) call this same
// function, so there is exactly one authorization implementation per kind
// even though there are two different SELECT-list shapes (a narrow shared
// envelope for the heterogeneous merged feed vs. the natural full row for
// a single-kind list, which callers like Lead's dedicated Activities-only/
// Communications-only tabs still need every column of).
function visibilityPredicate(kind, context, values) {
  if (kind === "note") {
    const userIdParam = add(values, context.userId);
    const viewAllParam = add(values, canOverridePrivateCrmContent(context));
    // ::boolean is required, not cosmetic — see data-management/communication-access.js's
    // communicationVisibilitySql for the full explanation: without it,
    // Postgres cannot infer this bare `OR $N` placeholder's type and
    // rejects the whole UNION query with "could not determine data type
    // of parameter $N".
    return `(visibility<>'private' OR created_by=${userIdParam} OR ${viewAllParam}::boolean)`;
  }
  if (kind === "communication") {
    // Reuses the SAME canonical audience fragment (team/private/
    // participant) every other communication read path uses.
    return communicationVisibilitySql(context, values, "communication");
  }
  return null;
}

// Every UNION branch shares one envelope shape (id/kind/subtype/title/
// occurred_at/status/actor_user_id/created_by) and is built ONCE here —
// the cursor-paginated merged feed (getCrmTimelinePage) is the only
// consumer, since a heterogeneous UNION across 4 tables cannot expose each
// table's full, differently-shaped column set.
function buildBranch(kind, entityType, entityId, context, values) {
  if (kind === "activity") {
    const entityIdParam = add(values, entityId);
    // Access to the parent record is not access to every activity on it:
    // activities keep their own rule (assignee/team/unassigned)
    // exactly as in the Activities list — recordScope.
    return `SELECT activity.id,'activity'::text AS kind,activity.activity_type AS subtype,activity.subject AS title,COALESCE(activity.completed_at,activity.due_at,activity.created_at) AS occurred_at,activity.status,activity.assigned_to AS actor_user_id,activity.created_by
       FROM tenant.crm_activities activity WHERE activity.organization_id=$1 AND ${entityMatchSql(entityType, entityIdParam, "activity.entity_type", "activity.entity_id")}${recordScope(resources.activities, context, values, "activity")}`;
  }
  if (kind === "communication") {
    const communicationColumn = COMMUNICATION_COLUMN[entityType];
    if (!communicationColumn) return null;
    const entityIdParam = add(values, entityId);
    // A private communication (migration 104) must stay
    // invisible to anyone but its sender or an organization-wide view-all
    // override, even inside the unified feed.
    return `SELECT id,'communication'::text AS kind,channel AS subtype,subject AS title,occurred_at,status,NULL::uuid AS actor_user_id,created_by
         FROM tenant.crm_communications AS communication WHERE organization_id=$1 AND ${communicationColumn}=${entityIdParam}
           AND ${visibilityPredicate("communication", context, values)}`;
  }
  if (kind === "note") {
    const entityIdParam = add(values, entityId);
    return `SELECT id,'note'::text AS kind,CASE WHEN visibility='private' THEN 'private' END AS subtype,LEFT(body,160) AS title,created_at AS occurred_at,NULL::text AS status,NULL::uuid AS actor_user_id,created_by
       FROM tenant.crm_notes WHERE organization_id=$1 AND entity_type='${entityType}' AND entity_id=${entityIdParam}
         AND ${visibilityPredicate("note", context, values)}`;
  }
  if (kind === "stage") {
    if (entityType === "opportunity") {
      const entityIdParam = add(values, entityId);
      // F026 — the review context travels with the event: a close shows its
      // reason label (snapshotted at the time) and notes; a reopen (leaving a
      // won/lost stage) carries the "reopen" subtype with the reason the user gave.
      return `SELECT h.id,'stage'::text AS kind,CASE WHEN fs.is_won OR fs.is_lost THEN 'reopen' END AS subtype,
           COALESCE(fs.name,'Start') || ' → ' || COALESCE(ts.name,'Unknown') || COALESCE(' — ' || h.outcome_reason_label,'')
             || COALESCE(' — "' || COALESCE(h.outcome_notes, CASE WHEN fs.is_won OR fs.is_lost THEN h.note END) || '"','') AS title,
           h.changed_at AS occurred_at,h.status AS status,h.changed_by AS actor_user_id,h.changed_by AS created_by
         FROM tenant.crm_opportunity_stage_history h
         LEFT JOIN tenant.crm_pipeline_stages fs ON fs.organization_id=h.organization_id AND fs.id=h.from_stage_id
         LEFT JOIN tenant.crm_pipeline_stages ts ON ts.organization_id=h.organization_id AND ts.id=h.to_stage_id
         WHERE h.organization_id=$1 AND h.opportunity_id=${entityIdParam}`;
    }
    return null;
  }
  if (kind === "history") {
    const source = entityType === "lead" ? ["crm_lead_history", "lead_id"] : entityType === "party" ? ["crm_account_history", "party_id"]
      : entityType === "contact" ? ["crm_contact_history", "contact_id"] : null;
    if (!source) return null;
    const entityIdParam = add(values, entityId);
    return `SELECT history.id,'history'::text AS kind,history.event_type AS subtype,history.summary AS title,
         history.created_at AS occurred_at,NULL::text AS status,history.actor_user_id,history.actor_user_id AS created_by
       FROM tenant.${source[0]} history
       WHERE history.organization_id=$1 AND history.${source[1]}=${entityIdParam}`;
  }
  if (kind === "attachment") {
    const entityIdParam = add(values, entityId);
    return `SELECT id,'attachment'::text AS kind,mime_type AS subtype,file_name AS title,created_at AS occurred_at,lifecycle_status AS status,NULL::uuid AS actor_user_id,uploaded_by AS created_by
       FROM public.attachments WHERE organization_id=$1 AND ${entityMatchSql(entityType, entityIdParam, "entity_type", "entity_id", { typePrefix: "crm.", idCast: "::text" })}`;
  }
  return null;
}

function buildUnionParts(context, entityType, entityId, wantedKinds, values) {
  const unionParts = [];
  for (const kind of SOURCE_KINDS) {
    if (!wantedKinds.has(kind)) continue;
    const branch = buildBranch(kind, entityType, entityId, context, values);
    if (branch) unionParts.push(branch);
  }
  return unionParts;
}

// Full-row (SELECT *, every column) query for exactly ONE source kind —
// unlike buildBranch's narrow envelope, this is what a dedicated single-
// kind list (e.g. Lead's Activities-only or Communications-only tab)
// actually renders (assignee name, description, direction, provider,
// body, due date, etc.), so no column present before this migration is
// dropped. Reuses visibilityPredicate — the SAME authorization fragment
// buildBranch uses — rather than re-deriving an equivalent one.
function buildSourceQuery(kind, entityType, entityId, context, values) {
  if (kind === "activity") {
    const entityIdParam = add(values, entityId);
    return `SELECT a.*,u.full_name AS assigned_name, COALESCE(a.completed_at,a.due_at,a.created_at) AS occurred_at
       FROM tenant.crm_activities a LEFT JOIN public.users u ON u.id=a.assigned_to
       WHERE a.organization_id=$1 AND a.entity_type='${entityType}' AND a.entity_id=${entityIdParam}${recordScope(resources.activities, context, values, "a")}`;
  }
  if (kind === "communication") {
    const communicationColumn = COMMUNICATION_COLUMN[entityType];
    if (!communicationColumn) return null;
    const entityIdParam = add(values, entityId);
    return `SELECT communication.* FROM tenant.crm_communications AS communication
       WHERE organization_id=$1 AND ${communicationColumn}=${entityIdParam}
         AND ${visibilityPredicate("communication", context, values)}`;
  }
  if (kind === "note") {
    const entityIdParam = add(values, entityId);
    return `SELECT n.*,u.full_name AS author_name,n.created_at AS occurred_at FROM tenant.crm_notes n LEFT JOIN public.users u ON u.id=n.created_by
       WHERE n.organization_id=$1 AND n.entity_type='${entityType}' AND n.entity_id=${entityIdParam}
         AND ${visibilityPredicate("note", context, values)}`;
  }
  if (kind === "attachment") {
    const entityIdParam = add(values, entityId);
    return `SELECT id,file_name,mime_type,size_bytes,created_at,created_at AS occurred_at
       FROM public.attachments WHERE organization_id=$1 AND entity_type='crm.${entityType}' AND entity_id=${entityIdParam}`;
  }
  return null;
}

export async function getCrmTimelinePage(client, context, entityType, entityId, { cursor, limit = 30, kinds } = {}) {
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) return { rows: [], hasMore: false, nextCursor: null };

  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 30));
  const wantedKinds = Array.isArray(kinds) && kinds.length ? new Set(kinds.filter((kind) => SOURCE_KINDS.has(kind))) : SOURCE_KINDS;

  let cursorOccurredAt = null;
  let cursorId = null;
  if (cursor) {
    const [rawOccurredAt, rawId] = String(cursor).split("|");
    const parsed = Date.parse(rawOccurredAt);
    if (Number.isFinite(parsed) && UUID.test(String(rawId || ""))) {
      cursorOccurredAt = new Date(parsed).toISOString();
      cursorId = rawId;
    }
  }

  const values = [context.organizationId];
  const unionParts = buildUnionParts(context, entityType, entityId, wantedKinds, values);
  if (!unionParts.length) return { rows: [], hasMore: false, nextCursor: null };

  let cursorClause = "";
  if (cursorOccurredAt && cursorId) {
    const occurredParam = add(values, cursorOccurredAt);
    const idParam = add(values, cursorId);
    cursorClause = ` WHERE (combined.occurred_at,combined.id) < (${occurredParam}::timestamptz,${idParam}::uuid)`;
  }
  const limitParam = add(values, boundedLimit + 1);

  const sql = `WITH combined AS (${unionParts.join(" UNION ALL ")})
    SELECT combined.*,actor.full_name AS actor_name FROM combined
    LEFT JOIN public.users actor ON actor.id=COALESCE(combined.actor_user_id,combined.created_by)${cursorClause}
    ORDER BY combined.occurred_at DESC, combined.id DESC
    LIMIT ${limitParam}`;

  const result = await client.query(sql, values);
  const hasMore = result.rows.length > boundedLimit;
  const rows = (hasMore ? result.rows.slice(0, boundedLimit) : result.rows).map(dto);
  const last = rows[rows.length - 1];
  const nextCursor = hasMore && last ? `${new Date(last.occurredAt).toISOString()}|${last.id}` : null;
  return { rows, hasMore, nextCursor };
}

// Lead's dedicated Activities-only/Communications-only list tabs (distinct
// from the unified Timeline above): an OFFSET-paginated, single-kind
// contract (`{source, offset, limit} -> {rows, hasMore}` with full,
// un-narrowed rows), backed by the SAME resolveCrmEntityAccess gate and the SAME visibilityPredicate the unified
// Timeline's buildBranch uses — one authorization implementation per kind,
// reused by both pagination styles, even though the SELECT list differs.
export async function getCrmTimelinePageBySource(client, context, entityType, entityId, { source, offset = 0, limit = 50 } = {}) {
  if (!SINGLE_SOURCE_KINDS.has(source)) throw new CrmError(400, "Unsupported timeline source.", "CRM_TIMELINE_SOURCE_INVALID");
  const allowed = await resolveCrmEntityAccess(client, context, entityType, entityId);
  if (!allowed) return { rows: [], hasMore: false };

  const boundedLimit = Math.max(1, Math.min(100, Math.trunc(Number(limit)) || 50));
  const boundedOffset = Math.max(0, Math.trunc(Number(offset)) || 0);

  const values = [context.organizationId];
  const query = buildSourceQuery(source, entityType, entityId, context, values);
  if (!query) return { rows: [], hasMore: false };

  const limitParam = add(values, boundedLimit + 1);
  const offsetParam = add(values, boundedOffset);
  const sql = `WITH combined AS (${query})
    SELECT combined.* FROM combined
    ORDER BY combined.occurred_at DESC, combined.id DESC
    LIMIT ${limitParam} OFFSET ${offsetParam}`;

  const result = await client.query(sql, values);
  const hasMore = result.rows.length > boundedLimit;
  const rows = hasMore ? result.rows.slice(0, boundedLimit) : result.rows;
  return { rows, hasMore };
}
