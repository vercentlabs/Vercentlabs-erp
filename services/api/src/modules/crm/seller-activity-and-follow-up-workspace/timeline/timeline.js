// Prompt 6 (CRM-CAP-004, F019 — Activity Timeline). Re-audit found TWO
// divergent, hand-rolled timeline implementations (Lead's paginated
// getLeadTimelinePage, Opportunity's unpaginated 40-row page-component
// snapshot with an ungated activities query) and NONE at all for Account/
// Contact — exactly "four subtly different security implementations" the
// dossier warns against, except two of the four didn't even exist yet.
// This module is the one canonical projection all four record types use.
//
// Design notes:
//  - Sources merged: crm_activities (Calls/Meetings/Tasks/Follow-ups/Email/
//    WhatsApp/SMS — every activity_type, one row shape already), crm_
//    communications (its own party/opportunity/lead/contact FK columns,
//    not a generic entity_type/entity_id pair — branched per entityType
//    below), crm_notes (respecting the F017 private-visibility column),
//    public.attachments (the governed file upload record — 'crm.<entityType>'
//    is the same entity_type convention the Lead attachment route already
//    writes; this merge is what makes "files" show up on Lead/Opportunity's
//    migrated Timeline per the dossier's explicit requirement, and will
//    cover Account/Contact/Opportunity automatically once F017 extends
//    attachment upload to those record types too — no further Timeline
//    change needed then).
//    Deliberately NOT merged: crm_outbox_events (internal/non-user-facing),
//    lifecycle/stage/score/assignment/consent/merge history (these remain
//    separate detail panels per record type — folding several more
//    differently-shaped history tables into one feed was judged out of
//    proportion for this pass; each already has its own real, tested
//    query elsewhere, and the dossier's own worked example already
//    describes these as distinct panels alongside a unified activity feed,
//    not literally one merged row shape).
//  - Authorization is enforced at TWO levels, matching §65's explicit
//    requirement that parent-record access alone cannot decide item
//    visibility: (1) resolveCrmEntityAccess() below gates the whole call on the
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
//    not OFFSET — the previously-identified duplicate/skip risk under
//    concurrent inserts (an OFFSET page shifts when a new row is inserted
//    ahead of it) cannot happen here: a cursor value that already has a
//    stable position never moves.
import { canOverridePrivateCrmContent, crmAccountVisibleSql, crmContactVisibleSql, crmOwnerScopeSql } from "../../crm-data-operations-and-customization/crm-access-scope.js";
import { recordScope } from "../../crm-data-operations-and-customization/record-policy.js";
import { resources } from "../../crm-data-operations-and-customization/resource-registry.js";
import { CrmError } from "../../crm-data-operations-and-customization/errors.js";
import { canViewSensitiveLeadContent, leadScopeSql } from "../../lead-lifecycle-qualification-and-prioritization/lead-security.js";
import { canViewSensitiveAccountContent } from "../../prospect-and-relationship-master-data/account-security.js";
import { canViewSensitiveContactContent } from "../../prospect-and-relationship-master-data/contact-security.js";
import { communicationVisibilitySql, projectCrmCommunications } from "../communications/communication-projection.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_TYPES = new Set(["lead", "opportunity", "party", "contact", "campaign"]);
const SOURCE_KINDS = new Set(["activity", "communication", "note", "attachment", "stage", "assignment", "qualification"]);
// Kinds getCrmTimelinePageBySource can serve as full-row single-kind lists;
// the audit-event kinds (stage/assignment/qualification) exist only in the
// merged feed's narrow envelope.
const SINGLE_SOURCE_KINDS = new Set(["activity", "communication", "note", "attachment"]);
const COMMUNICATION_COLUMN = { lead: "lead_id", opportunity: "opportunity_id", party: "party_id", contact: "contact_id", campaign: null };


function camelize(key) { return key.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase()); }
function dto(row) { return Object.fromEntries(Object.entries(row || {}).map(([key, value]) => [camelize(key), value])); }

// Resolves whether the caller may see this record's related content at
// all — the same company/branch scope + entity-type-specific sensitive
// permission every existing detail-data function already enforces, not a
// re-derived equivalent. Returns null (no crash, no partial leak) for "no
// access," which callers must treat as an empty timeline, never an error
// that could distinguish "record doesn't exist" from "record exists but
// you can't see it."
// Exported so other CRM-CAP-004 domain modules that operate against the
// same 5 entity types (Notes, governed attachments) reuse this ONE
// authorization implementation rather than re-deriving an equivalent one —
// see notes.js's own import of this function.
export async function resolveCrmEntityAccess(client, context, entityType, entityId) {
  if (!ENTITY_TYPES.has(entityType)) throw new CrmError(400, "Unsupported timeline entity type.", "CRM_TIMELINE_ENTITY_INVALID");
  if (!UUID.test(String(entityId || ""))) throw new CrmError(400, "A valid record id is required.", "CRM_TIMELINE_ENTITY_INVALID");
  if (entityType === "lead") {
    if (!canViewSensitiveLeadContent(context)) return false;
    const values = [context.organizationId, entityId];
    const scope = leadScopeSql(context, values, "lead");
    const result = await client.query(
      `SELECT lead.id FROM tenant.crm_leads lead WHERE lead.organization_id=$1 AND lead.id=$2 AND lead.record_status <> 'archived'${scope} LIMIT 1`,
      values,
    );
    return Boolean(result.rows[0]);
  }
  if (entityType === "opportunity") {
    if (!canViewSensitiveLeadContent(context)) return false; // established reuse — see opportunity-detail-data.ts
    // F028 — owner scope, matching recordScope() for opportunity lists: a
    // caller without view-all reaches only their own or unowned deals, so a
    // deal id they cannot list cannot be read or written through here.
    const opportunityValues = [context.organizationId, entityId];
    const result = await client.query(
      `SELECT opportunity.id,opportunity.company_id,opportunity.branch_id FROM tenant.crm_opportunities opportunity
        WHERE opportunity.organization_id=$1 AND opportunity.id=$2 AND opportunity.status <> 'archived'
         ${crmOwnerScopeSql(context, (value) => { opportunityValues.push(value); return `$${opportunityValues.length}`; }, "opportunity.owner_user_id", "opportunity.organization_id", { resource: "opportunities", alias: "opportunity" })} LIMIT 1`,
      opportunityValues,
    );
    const row = result.rows[0];
    if (!row) return false;
    if (context.activeCompanyId && row.company_id && row.company_id !== context.activeCompanyId) return false;
    if (context.activeBranchId && row.branch_id && row.branch_id !== context.activeBranchId) return false;
    return true;
  }
  // Account/Contact: the same company boundary + ownership rule as their
  // own lists (crm-access-scope.js), not the company check alone.
  if (entityType === "party") {
    if (!canViewSensitiveAccountContent(context)) return false;
    const values = [context.organizationId, entityId];
    const result = await client.query(
      `SELECT account.id FROM tenant.business_parties account WHERE account.organization_id=$1 AND account.id=$2 AND account.status='active'${crmAccountVisibleSql(context, (value) => add(values, value), "account")} LIMIT 1`,
      values,
    );
    return Boolean(result.rows[0]);
  }
  if (entityType === "contact") {
    if (!canViewSensitiveContactContent(context)) return false;
    const values = [context.organizationId, entityId];
    const result = await client.query(
      `SELECT contact.id FROM tenant.contacts contact LEFT JOIN tenant.business_parties party ON party.organization_id=contact.organization_id AND party.id=contact.party_id WHERE contact.organization_id=$1 AND contact.id=$2 AND contact.status='active' AND (party.id IS NULL OR party.status='active')${crmContactVisibleSql(context, (value) => add(values, value), "contact", "party")} LIMIT 1`,
      values,
    );
    return Boolean(result.rows[0]);
  }
  // Campaigns carry no dedicated sensitive-content permission today (no
  // personal/contact data of their own) — ordinary crm.view plus company
  // scope is the same bar every other non-sensitive CRM resource uses.
  const result = await client.query(
    `SELECT id,company_id FROM tenant.crm_campaigns WHERE organization_id=$1 AND id=$2 AND status <> 'cancelled' LIMIT 1`,
    [context.organizationId, entityId],
  );
  const row = result.rows[0];
  if (!row) return false;
  if (context.activeCompanyId && row.company_id && row.company_id !== context.activeCompanyId) return false;
  return true;
}

function add(values, value) { values.push(value); return `$${values.length}`; }

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
    // ::boolean is required, not cosmetic — see communication-projection.js's
    // communicationVisibilitySql for the full explanation (found via
    // live-browser Prompt 3 QA against a real database): without it,
    // Postgres cannot infer this bare `OR $N` placeholder's type and
    // rejects the whole UNION query with "could not determine data type
    // of parameter $N".
    return `(visibility<>'private' OR created_by=${userIdParam} OR ${viewAllParam}::boolean)`;
  }
  if (kind === "communication") {
    // F018 final closeout — reuses the SAME canonical audience fragment
    // (team/private/participant) every other communication read path now
    // uses, rather than this module's own private-only equivalent.
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
    // activities keep their own rule (assignee/team/unassigned, company,
    // branch) exactly as in the Activities list — recordScope.
    return `SELECT activity.id,'activity'::text AS kind,activity.activity_type AS subtype,activity.subject AS title,COALESCE(activity.completed_at,activity.due_at,activity.created_at) AS occurred_at,activity.status,activity.assigned_to AS actor_user_id,activity.created_by
       FROM tenant.crm_activities activity WHERE activity.organization_id=$1 AND activity.entity_type='${entityType}' AND activity.entity_id=${entityIdParam}${recordScope(resources.activities, context, values, "activity")}`;
  }
  if (kind === "communication") {
    const communicationColumn = COMMUNICATION_COLUMN[entityType];
    if (!communicationColumn) return null;
    const entityIdParam = add(values, entityId);
    // F018 closeout — a private communication (migration 104) must stay
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
    if (entityType === "lead") {
      const entityIdParam = add(values, entityId);
      return `SELECT e.id,'stage'::text AS kind,CASE WHEN e.override_used THEN 'override' END AS subtype,
           COALESCE(fs.name,e.from_stage_code,'Start') || ' → ' || COALESCE(ts.name,e.to_stage_code,'Unknown') || COALESCE(' — ' || e.reason_label,'') AS title,
           e.created_at AS occurred_at,NULL::text AS status,e.changed_by_user_id AS actor_user_id,e.changed_by_user_id AS created_by
         FROM tenant.crm_lead_stage_events e
         LEFT JOIN tenant.crm_lead_stages fs ON fs.organization_id=e.organization_id AND fs.id=e.from_stage_id
         LEFT JOIN tenant.crm_lead_stages ts ON ts.organization_id=e.organization_id AND ts.id=e.to_stage_id
         WHERE e.organization_id=$1 AND e.lead_id=${entityIdParam}`;
    }
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
  if (kind === "assignment") {
    if (entityType !== "lead") return null;
    const entityIdParam = add(values, entityId);
    return `SELECT e.id,'assignment'::text AS kind,CASE WHEN e.is_override THEN 'override' END AS subtype,
         'Owner: ' || COALESCE(pu.full_name,'Unassigned') || ' → ' || COALESCE(nu.full_name,'Unassigned') AS title,
         e.created_at AS occurred_at,NULL::text AS status,e.created_by AS actor_user_id,e.created_by
       FROM tenant.crm_lead_assignment_events e
       LEFT JOIN public.users pu ON pu.id=e.previous_owner_user_id
       LEFT JOIN public.users nu ON nu.id=e.new_owner_user_id
       WHERE e.organization_id=$1 AND e.lead_id=${entityIdParam}`;
  }
  if (kind === "qualification") {
    if (entityType !== "lead") return null;
    const entityIdParam = add(values, entityId);
    return `SELECT e.id,'qualification'::text AS kind,CASE WHEN e.override_used THEN 'override' END AS subtype,
         COALESCE(e.previous_state,'new') || ' → ' || e.new_state || COALESCE(' — ' || e.reason_text,'') AS title,
         e.created_at AS occurred_at,e.new_state AS status,e.decided_by_user_id AS actor_user_id,e.decided_by_user_id AS created_by
       FROM tenant.crm_lead_qualification_events e
       WHERE e.organization_id=$1 AND e.lead_id=${entityIdParam}`;
  }
  if (kind === "attachment") {
    const entityIdParam = add(values, entityId);
    return `SELECT id,'attachment'::text AS kind,mime_type AS subtype,file_name AS title,created_at AS occurred_at,lifecycle_status AS status,NULL::uuid AS actor_user_id,uploaded_by AS created_by
       FROM public.attachments WHERE organization_id=$1 AND entity_type='crm.${entityType}' AND entity_id=${entityIdParam}`;
  }
  return null;
}

function buildBranches(context, entityType, entityId, wantedKinds, values) {
  const branches = [];
  for (const kind of SOURCE_KINDS) {
    if (!wantedKinds.has(kind)) continue;
    const branch = buildBranch(kind, entityType, entityId, context, values);
    if (branch) branches.push(branch);
  }
  return branches;
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
  const branches = buildBranches(context, entityType, entityId, wantedKinds, values);
  if (!branches.length) return { rows: [], hasMore: false, nextCursor: null };

  let cursorClause = "";
  if (cursorOccurredAt && cursorId) {
    const occurredParam = add(values, cursorOccurredAt);
    const idParam = add(values, cursorId);
    cursorClause = ` WHERE (combined.occurred_at,combined.id) < (${occurredParam}::timestamptz,${idParam}::uuid)`;
  }
  const limitParam = add(values, boundedLimit + 1);

  const sql = `WITH combined AS (${branches.join(" UNION ALL ")})
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

// F019 §16 closeout — Lead's own dedicated Activities-only/Communications-
// only list tabs (distinct from the unified Timeline above) previously ran
// through a separate hand-rolled implementation (lead-detail-data.ts's
// getLeadTimelinePage) with its own re-derived authorization/privacy
// predicate and OFFSET pagination. This is that same OFFSET-paginated,
// single-kind contract (unchanged from the caller's point of view — the
// route preserves its `{source, offset, limit} -> {rows, hasMore}` shape
// with full, un-narrowed rows, exactly as before, so neither dedicated
// tab's rendering needed to change), but now backed by the SAME
// resolveCrmEntityAccess gate and the SAME visibilityPredicate the unified
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
