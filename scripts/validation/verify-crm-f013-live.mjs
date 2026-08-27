import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { config as loadDotEnv } from "dotenv";
import pg from "pg";

import { createCrmRecord } from "../../services/api/src/modules/crm/index.js";
import {
  cancelCrmCall,
  completeCrmCall,
  createCrmCall,
  getCrmCall,
  listCrmCallEvents,
  startCrmCall,
  updateCrmCall,
} from "../../services/api/src/modules/crm/call-operations.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
for (const file of [path.join(root, "apps/web/.env.local"), path.join(root, "apps/web/.env"), path.join(root, ".env")]) {
  if (fs.existsSync(file)) loadDotEnv({ path: file, override: false });
}
const connectionString = String(process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL || "").trim();
if (!connectionString) throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL is required for F013 live verification. The verifier loads apps/web/.env.local, apps/web/.env and .env automatically.");

const client = new pg.Client({ connectionString, application_name: "vercentlabs-f013-live-verifier" });
const result = {
  callColumnsPresent: false,
  historyTablePresent: false,
  historyRlsForced: false,
  scheduledCallCreated: false,
  relatedPhoneResolved: false,
  doNotContactBlocked: false,
  doNotContactMutationFree: false,
  genericCreateBlocked: false,
  updateApplied: false,
  updateReplayMutationFree: false,
  staleUpdateBlocked: false,
  staleUpdateMutationFree: false,
  startApplied: false,
  startReplayMutationFree: false,
  completionApplied: false,
  completionReplayMutationFree: false,
  parentTouchedOnCompletion: false,
  cancelApplied: false,
  cancelReplayMutationFree: false,
  historyWritten: false,
  outboxWritten: false,
  piiExcludedFromOutbox: false,
  rolledBack: false,
};

let transactionOpen = false;
let organizationId = null;
let leadId = null;
let callId = null;

await client.connect();
try {
  await client.query("BEGIN"); transactionOpen = true;

  const columns = await client.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='tenant' AND table_name='crm_activities' AND column_name IN ('call_direction','call_phone','call_outcome_code','call_started_at','call_ended_at','call_duration_seconds')`);
  result.callColumnsPresent = columns.rowCount === 6;
  result.historyTablePresent = Boolean((await client.query(`SELECT to_regclass('tenant.crm_call_events') AS table_name`)).rows[0]?.table_name);
  const rel = (await client.query(`SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid='tenant.crm_call_events'::regclass`)).rows[0];
  result.historyRlsForced = Boolean(rel?.relrowsecurity && rel?.relforcerowsecurity);

  const base = (await client.query(`SELECT organization.id AS organization_id,company.id AS company_id
      FROM public.organizations organization
      JOIN public.companies company ON company.organization_id=organization.id AND company.status='active'
     WHERE organization.status='active'
     ORDER BY company.is_primary DESC,organization.created_at,company.created_at LIMIT 1`)).rows[0];
  if (!base) throw new Error("F013 live verification requires an active organization/company.");
  organizationId = base.organization_id;
  await client.query("SELECT set_config('app.current_organization_id',$1,true)", [organizationId]);

  const seller = (await client.query(`SELECT membership.user_id
      FROM public.organization_memberships membership
      JOIN public.users user_account ON user_account.id=membership.user_id AND user_account.status='active'
     WHERE membership.organization_id=$1 AND membership.status='active'
       AND EXISTS (
         SELECT 1 FROM public.user_role_assignments assignment
         JOIN public.roles role ON role.organization_id=assignment.organization_id AND role.id=assignment.role_id AND role.status='active'
         LEFT JOIN public.role_permissions permission ON permission.role_id=role.id AND permission.permission_key='crm.view'
        WHERE assignment.organization_id=membership.organization_id AND assignment.user_id=membership.user_id
          AND assignment.status='active' AND assignment.starts_at<=now() AND (assignment.expires_at IS NULL OR assignment.expires_at>now())
          AND (role.slug='organization_owner' OR permission.permission_key IS NOT NULL)
       )
     ORDER BY membership.created_at,membership.user_id LIMIT 1`, [organizationId])).rows[0];
  if (!seller) throw new Error("F013 verification organization has no active CRM-eligible member.");
  const initialStage = (await client.query(`SELECT code FROM tenant.crm_lead_stages WHERE organization_id=$1 AND status='active' ORDER BY is_initial DESC,sort_order,id LIMIT 1`, [organizationId])).rows[0];
  if (!initialStage) throw new Error("F013 verification organization has no active Lead lifecycle stage.");

  const context = { organizationId, userId: seller.user_id, activeCompanyId: base.company_id, activeBranchId: null, allowAllCompanies: true, roleSlugs: ["organization_owner"], permissions: ["crm.view", "crm.activities.manage", "crm.records.view_all"] };
  const suffix = `${Date.now()}-${randomUUID().slice(0, 8)}`;
  leadId = randomUUID();
  await client.query(`INSERT INTO tenant.crm_leads(id,organization_id,company_id,branch_id,code,first_name,phone,status,record_status,owner_user_id,do_not_contact,created_by,updated_by)
    VALUES($1,$2,$3,NULL,$4,$5,$6,$7,'active',$8,false,$8,$8)`, [leadId, organizationId, base.company_id, `F013-${suffix}`, `F013 Verify ${suffix}`, "+91 9876543210", initialStage.code, seller.user_id]);

  const beforeCreateEvents = Number((await client.query(`SELECT count(*)::int AS count FROM tenant.crm_call_events WHERE organization_id=$1`, [organizationId])).rows[0]?.count || 0);
  const beforeCreateOutbox = Number((await client.query(`SELECT count(*)::int AS count FROM tenant.crm_outbox_events WHERE organization_id=$1 AND event_type LIKE 'crm.call.%'`, [organizationId])).rows[0]?.count || 0);
  const scheduled = await createCrmCall(client, context, { mode: "schedule", entityType: "lead", entityId: leadId, subject: `F013 scheduled ${suffix}`, direction: "outbound", dueAt: new Date(Date.now()+3600_000).toISOString() });
  callId = scheduled.id;
  result.scheduledCallCreated = scheduled.status === "planned" && scheduled.activityType === "call";
  result.relatedPhoneResolved = String(scheduled.phoneNumber || "").replace(/\D/g, "") === "919876543210";

  await client.query(`UPDATE tenant.crm_leads SET do_not_contact=true WHERE organization_id=$1 AND id=$2`, [organizationId, leadId]);
  const dncCountsBefore = (await client.query(`SELECT
      (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id=$1 AND activity_type='call') AS calls,
      (SELECT count(*)::int FROM tenant.crm_call_events WHERE organization_id=$1) AS events,
      (SELECT count(*)::int FROM tenant.crm_outbox_events WHERE organization_id=$1 AND event_type LIKE 'crm.call.%') AS outbox`, [organizationId])).rows[0];
  try { await createCrmCall(client, context, { mode: "schedule", entityType: "lead", entityId: leadId, subject: "Blocked DNC", direction: "outbound", dueAt: new Date(Date.now()+7200_000).toISOString() }); }
  catch (error) { result.doNotContactBlocked = error?.code === "CRM_CALL_DO_NOT_CONTACT"; }
  const dncCountsAfter = (await client.query(`SELECT
      (SELECT count(*)::int FROM tenant.crm_activities WHERE organization_id=$1 AND activity_type='call') AS calls,
      (SELECT count(*)::int FROM tenant.crm_call_events WHERE organization_id=$1) AS events,
      (SELECT count(*)::int FROM tenant.crm_outbox_events WHERE organization_id=$1 AND event_type LIKE 'crm.call.%') AS outbox`, [organizationId])).rows[0];
  result.doNotContactMutationFree = ["calls","events","outbox"].every((key) => Number(dncCountsAfter[key]) === Number(dncCountsBefore[key]));
  await client.query(`UPDATE tenant.crm_leads SET do_not_contact=false WHERE organization_id=$1 AND id=$2`, [organizationId, leadId]);

  try { await createCrmRecord(client, context, "activities", { activityType: "call", subject: "Bypass", direction: "outbound" }); }
  catch (error) { result.genericCreateBlocked = error?.code === "CRM_CALL_API_MOVED"; }

  const current = await getCrmCall(client, context, callId);
  const updated = await updateCrmCall(client, context, callId, { subject: `${current.subject} updated`, expectedUpdatedAt: new Date(current.updatedAt).toISOString(), expectedStatus: current.status });
  result.updateApplied = updated.subject.endsWith(" updated");
  const updateCountsBefore = (await client.query(`SELECT
      (SELECT count(*)::int FROM tenant.crm_call_events WHERE organization_id=$1 AND activity_id=$2) AS events,
      (SELECT count(*)::int FROM tenant.crm_outbox_events WHERE organization_id=$1 AND entity_type='call' AND entity_id=$2) AS outbox`, [organizationId, callId])).rows[0];
  const updateReplay = await updateCrmCall(client, context, callId, { subject: updated.subject, expectedUpdatedAt: "2000-01-01T00:00:00.000Z", expectedStatus: "planned" });
  const updateCountsAfter = (await client.query(`SELECT
      (SELECT count(*)::int FROM tenant.crm_call_events WHERE organization_id=$1 AND activity_id=$2) AS events,
      (SELECT count(*)::int FROM tenant.crm_outbox_events WHERE organization_id=$1 AND entity_type='call' AND entity_id=$2) AS outbox`, [organizationId, callId])).rows[0];
  result.updateReplayMutationFree = updateReplay.replayed === true && Number(updateCountsAfter.events)===Number(updateCountsBefore.events) && Number(updateCountsAfter.outbox)===Number(updateCountsBefore.outbox);

  const beforeStale = await getCrmCall(client, context, callId);
  try { await updateCrmCall(client, context, callId, { subject: "stale change", expectedUpdatedAt: "2000-01-01T00:00:00.000Z", expectedStatus: beforeStale.status }); }
  catch (error) { result.staleUpdateBlocked = error?.code === "CRM_CALL_STALE_WRITE"; }
  const afterStale = await getCrmCall(client, context, callId);
  result.staleUpdateMutationFree = afterStale.subject === beforeStale.subject && new Date(afterStale.updatedAt).toISOString() === new Date(beforeStale.updatedAt).toISOString();

  const startCountsBefore = (await client.query(`SELECT count(*)::int AS count FROM tenant.crm_call_events WHERE organization_id=$1 AND activity_id=$2`, [organizationId, callId])).rows[0];
  const started = await startCrmCall(client, context, callId, { expectedUpdatedAt: new Date(afterStale.updatedAt).toISOString(), expectedStatus: afterStale.status });
  result.startApplied = started.status === "in_progress" && Boolean(started.actualStartedAt);
  const startReplay = await startCrmCall(client, context, callId, { expectedUpdatedAt: "2000-01-01T00:00:00.000Z", expectedStatus: "planned" });
  const startCountsAfter = (await client.query(`SELECT count(*)::int AS count FROM tenant.crm_call_events WHERE organization_id=$1 AND activity_id=$2`, [organizationId, callId])).rows[0];
  result.startReplayMutationFree = startReplay.replayed === true && Number(startCountsAfter.count) === Number(startCountsBefore.count)+1;

  const completeCountsBefore = (await client.query(`SELECT
      (SELECT count(*)::int FROM tenant.crm_call_events WHERE organization_id=$1 AND activity_id=$2) AS events,
      (SELECT count(*)::int FROM tenant.crm_outbox_events WHERE organization_id=$1 AND entity_type='call' AND entity_id=$2) AS outbox`, [organizationId, callId])).rows[0];
  const completed = await completeCrmCall(client, context, callId, { outcomeCode: "connected", outcome: "private verifier note", expectedUpdatedAt: new Date(started.updatedAt).toISOString(), expectedStatus: "in_progress" });
  result.completionApplied = completed.status === "completed" && completed.outcomeCode === "connected" && Number(completed.durationSeconds) >= 0;
  const completeReplay = await completeCrmCall(client, context, callId, { outcomeCode: "connected", outcome: "private verifier note", expectedUpdatedAt: "2000-01-01T00:00:00.000Z", expectedStatus: "planned" });
  const completeCountsAfter = (await client.query(`SELECT
      (SELECT count(*)::int FROM tenant.crm_call_events WHERE organization_id=$1 AND activity_id=$2) AS events,
      (SELECT count(*)::int FROM tenant.crm_outbox_events WHERE organization_id=$1 AND entity_type='call' AND entity_id=$2) AS outbox`, [organizationId, callId])).rows[0];
  result.completionReplayMutationFree = completeReplay.replayed === true && Number(completeCountsAfter.events) === Number(completeCountsBefore.events)+1 && Number(completeCountsAfter.outbox) === Number(completeCountsBefore.outbox)+1;
  const leadAfter = (await client.query(`SELECT last_contacted_at,first_responded_at FROM tenant.crm_leads WHERE organization_id=$1 AND id=$2`, [organizationId, leadId])).rows[0];
  result.parentTouchedOnCompletion = Boolean(leadAfter?.last_contacted_at && leadAfter?.first_responded_at);

  const cancellable = await createCrmCall(client, context, { mode: "schedule", entityType: "lead", entityId: leadId, subject: `F013 cancel ${suffix}`, direction: "inbound", dueAt: new Date(Date.now()+10800_000).toISOString() });
  const cancelCountsBefore = Number((await client.query(`SELECT count(*)::int AS count FROM tenant.crm_call_events WHERE organization_id=$1 AND activity_id=$2`, [organizationId, cancellable.id])).rows[0]?.count || 0);
  const cancelled = await cancelCrmCall(client, context, cancellable.id, { expectedUpdatedAt: new Date(cancellable.updatedAt).toISOString(), expectedStatus: "planned" });
  result.cancelApplied = cancelled.status === "cancelled";
  const cancelReplay = await cancelCrmCall(client, context, cancellable.id, { expectedUpdatedAt: "2000-01-01T00:00:00.000Z", expectedStatus: "planned" });
  const cancelCountsAfter = Number((await client.query(`SELECT count(*)::int AS count FROM tenant.crm_call_events WHERE organization_id=$1 AND activity_id=$2`, [organizationId, cancellable.id])).rows[0]?.count || 0);
  result.cancelReplayMutationFree = cancelReplay.replayed === true && cancelCountsAfter === cancelCountsBefore+1;

  const history = await listCrmCallEvents(client, context, callId, 50);
  result.historyWritten = history.some((event) => event.eventType === "scheduled") && history.some((event) => event.eventType === "started") && history.some((event) => event.eventType === "completed");
  const finalEvents = Number((await client.query(`SELECT count(*)::int AS count FROM tenant.crm_call_events WHERE organization_id=$1`, [organizationId])).rows[0]?.count || 0);
  const finalOutbox = Number((await client.query(`SELECT count(*)::int AS count FROM tenant.crm_outbox_events WHERE organization_id=$1 AND event_type LIKE 'crm.call.%'`, [organizationId])).rows[0]?.count || 0);
  result.historyWritten = result.historyWritten && finalEvents >= beforeCreateEvents + 6;
  result.outboxWritten = finalOutbox >= beforeCreateOutbox + 6;
  const leaked = Number((await client.query(`SELECT count(*)::int AS count FROM tenant.crm_outbox_events WHERE organization_id=$1 AND entity_type='call' AND (payload::text LIKE '%9876543210%' OR payload::text LIKE '%private verifier note%')`, [organizationId])).rows[0]?.count || 0);
  result.piiExcludedFromOutbox = leaked === 0;

  await client.query("ROLLBACK"); transactionOpen = false;
  await client.query("SELECT set_config('app.current_organization_id',$1,false)", [organizationId]);
  const afterRollback = await client.query(`SELECT count(*)::int AS count FROM tenant.crm_activities WHERE organization_id=$1 AND id=$2`, [organizationId, callId]);
  result.rolledBack = Number(afterRollback.rows[0]?.count || 0) === 0;

  if (Object.values(result).some((value) => value !== true)) throw new Error(`F013 live verification failed: ${JSON.stringify(result)}`);
  console.log(JSON.stringify(result));
} catch (error) {
  if (transactionOpen) await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  await client.end().catch(() => undefined);
}
