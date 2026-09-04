import "server-only";

import {
  findCrmDuplicates,
  getCrmOptions,
  getCrmRecord,
  getLeadQualification,
  listLeadStageHistory,
} from "@vercentlabs/api";
import { enrichLeadOwnerIdentity } from "./lead-owner-data";

type CrmClient = Parameters<typeof getCrmRecord>[0];
type CrmContext = Parameters<typeof getCrmRecord>[1];


function canViewSensitiveLeadContent(context: CrmContext) {
  return (
    context.roleSlugs?.includes("organization_owner") ||
    context.permissions?.includes("crm.leads.view_sensitive")
  );
}

function canViewAllCrmRecords(context: CrmContext) {
  return (
    context.roleSlugs?.includes("organization_owner") ||
    context.permissions?.includes("crm.records.view_all")
  );
}

function opportunityScope(context: CrmContext, values: unknown[]) {
  let sql = "";
  if (context.activeCompanyId) {
    values.push(context.activeCompanyId);
    sql += ` AND (company_id IS NULL OR company_id=$${values.length})`;
  } else if (!context.allowAllCompanies) return " AND false";
  if (context.activeBranchId) {
    values.push(context.activeBranchId);
    sql += ` AND (branch_id IS NULL OR branch_id=$${values.length})`;
  } else if (!context.allowAllCompanies) return sql + " AND false";
  if (!canViewAllCrmRecords(context)) {
    values.push(context.userId);
    sql += ` AND (owner_user_id IS NULL OR owner_user_id=$${values.length})`;
  }
  return sql;
}

function redactedQualification(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return value;
  const row = { ...(value as Record<string, unknown>) };
  delete row.reasonText;
  delete row.reason_text;
  delete row.note;
  delete row.qualificationNote;
  delete row.qualification_note;
  row.sensitiveDataRestricted = true;
  return row;
}

function serializedClient(client: CrmClient): CrmClient {
  let queue: Promise<unknown> = Promise.resolve();
  return {
    query(...args: Parameters<CrmClient["query"]>) {
      const operation = queue.then(() => client.query(...args));
      queue = operation.then(
        () => undefined,
        () => undefined,
      );
      return operation;
    },
  } as CrmClient;
}

export async function getLeadDetailData(
  client: CrmClient,
  context: CrmContext,
  id: string,
) {
  const db = serializedClient(client);
  const leadRecord = await getCrmRecord(db, context, "leads", id);
  const [lead] = await enrichLeadOwnerIdentity(db, context.organizationId, [
    leadRecord,
  ]);
  const canSeeSensitive = canViewSensitiveLeadContent(context);
  const opportunityValues: unknown[] = [context.organizationId, id];
  const opportunityWhere = opportunityScope(context, opportunityValues);
  const emptyRows: ReturnType<CrmClient["query"]> = Promise.resolve({
    rows: [],
    rowCount: 0,
  });
  const [
    activities,
    communications,
    notes,
    scoreHistory,
    opportunities,
    duplicates,
    options,
    attachments,
    selectedTags,
    assignmentHistory,
    qualification,
    lifecycleHistory,
  ] = await Promise.all([
    canSeeSensitive
      ? db.query(
          `SELECT a.*,u.full_name AS assigned_name FROM tenant.crm_activities a LEFT JOIN public.users u ON u.id=a.assigned_to WHERE a.organization_id=$1 AND a.entity_type='lead' AND a.entity_id=$2 ORDER BY COALESCE(a.completed_at,a.due_at,a.created_at) DESC LIMIT 200`,
          [context.organizationId, id],
        )
      : emptyRows,
    canSeeSensitive
      ? db.query(
          `SELECT * FROM tenant.crm_communications WHERE organization_id=$1 AND lead_id=$2 ORDER BY occurred_at DESC LIMIT 200`,
          [context.organizationId, id],
        )
      : emptyRows,
    canSeeSensitive
      ? db.query(
          `SELECT n.*,u.full_name AS author_name FROM tenant.crm_notes n LEFT JOIN public.users u ON u.id=n.created_by WHERE n.organization_id=$1 AND n.entity_type='lead' AND n.entity_id=$2 ORDER BY is_pinned DESC,created_at DESC LIMIT 200`,
          [context.organizationId, id],
        )
      : emptyRows,
    canSeeSensitive
      ? db.query(
          `SELECT * FROM tenant.crm_lead_score_history WHERE organization_id=$1 AND lead_id=$2 ORDER BY created_at DESC LIMIT 200`,
          [context.organizationId, id],
        )
      : emptyRows,
    db.query(
      `SELECT * FROM tenant.crm_opportunities WHERE organization_id=$1 AND lead_id=$2${opportunityWhere} ORDER BY created_at DESC LIMIT 100`,
      opportunityValues,
    ),
    canSeeSensitive ? findCrmDuplicates(db, context, lead, id) : Promise.resolve([]),
    getCrmOptions(db, context),
    canSeeSensitive
      ? db.query(
          `SELECT id,file_name,mime_type,size_bytes,created_at FROM public.attachments WHERE organization_id=$1 AND entity_type='crm.lead' AND entity_id=$2 ORDER BY created_at DESC LIMIT 100`,
          [context.organizationId, id],
        )
      : emptyRows,
    db.query(
      `SELECT t.id,t.name,t.color FROM tenant.crm_lead_tags lt JOIN tenant.crm_tags t ON t.organization_id=lt.organization_id AND t.id=lt.tag_id WHERE lt.organization_id=$1 AND lt.lead_id=$2 ORDER BY t.name`,
      [context.organizationId, id],
    ),
    db.query(
      `SELECT event.id,event.previous_owner_user_id,event.new_owner_user_id,event.reason,event.created_at,
              previous_owner.full_name AS previous_owner_name,new_owner.full_name AS new_owner_name,
              policy.name AS policy_name,
              actor.full_name AS actor_name
         FROM tenant.crm_lead_assignment_events event
         LEFT JOIN public.users previous_owner ON previous_owner.id=event.previous_owner_user_id
         LEFT JOIN public.users new_owner ON new_owner.id=event.new_owner_user_id
         LEFT JOIN tenant.crm_lead_assignment_policies policy
           ON policy.organization_id=event.organization_id AND policy.id=event.policy_id
         LEFT JOIN public.users actor ON actor.id=event.created_by
        WHERE event.organization_id=$1 AND event.lead_id=$2
        ORDER BY event.created_at DESC,event.id DESC LIMIT 25`,
      [context.organizationId, id],
    ),
    getLeadQualification(db, context, id).then((value) =>
      canSeeSensitive ? value : redactedQualification(value),
    ),
    listLeadStageHistory(db, context, id),
  ]);

  return {
    lead,
    activities: activities.rows,
    communications: communications.rows,
    notes: notes.rows,
    scoreHistory: scoreHistory.rows,
    opportunities: opportunities.rows,
    duplicates,
    options,
    attachments: attachments.rows,
    selectedTags: selectedTags.rows,
    assignmentHistory: canSeeSensitive
      ? assignmentHistory.rows
      : assignmentHistory.rows.map((row: Record<string, unknown>) => ({ ...row, reason: null })),
    qualification,
    lifecycleHistory: canSeeSensitive
      ? lifecycleHistory
      : lifecycleHistory.map((row: Record<string, unknown>) => ({ ...row, note: null })),
  };
}

export type LeadDetailData = Awaited<ReturnType<typeof getLeadDetailData>>;
