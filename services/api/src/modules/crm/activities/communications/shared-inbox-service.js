// F018 shared inbox: inbox and membership setup, and the thread operations
// (claim, read, status) that require inbox membership. assertSharedInboxMember
// is the one membership gate; every thread operation here calls it.

import { canOverridePrivateCrmContent } from "../../data-management/crm-access-scope.js";
import { canViewSensitiveLeadContent } from "../../lead-management/lead-security.js";
import { communicationVisibilitySql, resolveCallerParticipantCommunicationIds } from "./communication-projection.js";
import { CrmCommunicationsError, assertId } from "./communications-error.js";
import { optionalEmail } from "./email-address.js";

const text = (value) => String(value ?? "").trim();
const object = (value) =>
  value && typeof value === "object" && !Array.isArray(value) ? value : {};
const integer = (value, fallback = 0) =>
  Number.isInteger(Number(value)) ? Number(value) : fallback;

// F018 §9 closeout — claim/messages/status previously had NO inbox-
// membership check at all: any caller holding the ordinary
// crm.communications.manage permission could claim, read or change the
// status of ANY shared inbox's thread by id, regardless of
// crm_shared_inbox_members — "a user must not access another team's
// inbox merely by guessing a thread ID" was not actually enforced. This
// is the ONE membership gate all three call.
export async function assertSharedInboxMember(client, context, inboxId) {
  if (!inboxId || canOverridePrivateCrmContent(context)) return;
  const result = await client.query(
    `SELECT 1 FROM tenant.crm_shared_inbox_members WHERE organization_id=$1 AND inbox_id=$2 AND user_id=$3 LIMIT 1`,
    [context.organizationId, inboxId, context.userId],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(403, "You are not a member of this shared inbox.", "CRM_INBOX_SCOPE_FORBIDDEN");
}

export async function createSharedInbox(client, context, input = {}) {
  const result = await client.query(
    `INSERT INTO tenant.crm_shared_inboxes(organization_id,company_id,sync_account_id,name,channel,address,sla_minutes,collision_timeout_minutes,business_hours,status,created_by,updated_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10,$10) RETURNING *`,
    [
      context.organizationId,
      input.companyId || context.activeCompanyId || null,
      input.syncAccountId
        ? assertId(input.syncAccountId, "Sync account")
        : null,
      text(input.name),
      text(input.channel) || "email",
      optionalEmail(input.address),
      Math.max(1, integer(input.slaMinutes, 240)),
      Math.max(1, integer(input.collisionTimeoutMinutes, 15)),
      JSON.stringify(object(input.businessHours)),
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function upsertSharedInboxMember(
  client,
  context,
  inboxId,
  input = {},
) {
  const id = assertId(inboxId, "Inbox");
  const userId = assertId(input.userId || context.userId, "Inbox member");
  const role = ["manager", "agent", "observer"].includes(text(input.memberRole))
    ? text(input.memberRole)
    : "agent";
  const result = await client.query(
    `INSERT INTO tenant.crm_shared_inbox_members(
       organization_id,inbox_id,user_id,member_role,routing_weight,is_available,created_by
     ) VALUES($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (organization_id,inbox_id,user_id) DO UPDATE SET
       member_role=EXCLUDED.member_role,routing_weight=EXCLUDED.routing_weight,
       is_available=EXCLUDED.is_available
     RETURNING *`,
    [
      context.organizationId,
      id,
      userId,
      role,
      Math.max(1, integer(input.routingWeight, 100)),
      input.isAvailable !== false,
      context.userId,
    ],
  );
  return result.rows[0];
}

export async function claimSharedInboxThread(
  client,
  context,
  threadId,
  input = {},
) {
  const id = assertId(threadId, "Thread");
  const existing = await client.query(
    `SELECT inbox_id FROM tenant.crm_email_threads WHERE organization_id=$1 AND id=$2 LIMIT 1`,
    [context.organizationId, id],
  );
  if (!existing.rows[0])
    throw new CrmCommunicationsError(404, "Thread not found.", "CRM_INBOX_THREAD_NOT_FOUND");
  await assertSharedInboxMember(client, context, existing.rows[0].inbox_id);
  const result = await client.query(
    `UPDATE tenant.crm_email_threads thread SET assigned_user_id=$3,claimed_at=now(),claim_expires_at=now()+COALESCE((SELECT collision_timeout_minutes FROM tenant.crm_shared_inboxes inbox WHERE inbox.organization_id=thread.organization_id AND inbox.id=thread.inbox_id),15)*interval '1 minute',updated_by=$3,updated_at=now()
     WHERE thread.organization_id=$1 AND thread.id=$2 AND (thread.assigned_user_id IS NULL OR thread.assigned_user_id=$3 OR thread.claim_expires_at<now()) RETURNING *`,
    [context.organizationId, id, input.userId || context.userId],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(
      409,
      "Another agent currently owns this conversation.",
      "CRM_INBOX_COLLISION",
    );
  return result.rows[0];
}

// F018 closeout (§33 shared-inbox reachability, §8-9 thread/inbox
// authorization): the messages within one thread — the piece a real reply
// UI needs that getCommunicationsDashboard (list-of-threads only) never
// provided. A thread must not become an authorization bypass: (1) the
// caller must be a member of the thread's own shared inbox (§9,
// assertSharedInboxMember — previously unchecked entirely), (2) each
// message's audience is resolved from its OWN linked communication's
// visibility tier (team/private/participant, the SAME canonical fragment
// every other surface uses — mixed threads with some team-visible and
// some private/participant-only messages are supported per-row, not
// all-or-nothing at the thread level), and (3) content is then projected
// per message (full vs metadata-only) via the same canonical projector —
// a caller with thread access but not content permission sees which
// messages exist, not their bodies.
export async function listThreadMessages(client, context, threadId) {
  const id = assertId(threadId, "Thread");
  const thread = await client.query(
    `SELECT * FROM tenant.crm_email_threads WHERE organization_id=$1 AND id=$2 LIMIT 1`,
    [context.organizationId, id],
  );
  if (!thread.rows[0])
    throw new CrmCommunicationsError(404, "Thread not found.", "CRM_INBOX_THREAD_NOT_FOUND");
  await assertSharedInboxMember(client, context, thread.rows[0].inbox_id);
  const parameters = [context.organizationId, id];
  const audienceSql = communicationVisibilitySql(context, parameters, "communication");
  const messages = await client.query(
    `SELECT message.*, communication.id AS communication_id_resolved, communication.visibility AS communication_visibility, communication.created_by AS communication_created_by
       FROM tenant.crm_email_messages message
       LEFT JOIN tenant.crm_communications communication ON communication.organization_id=message.organization_id AND communication.id=message.communication_id
      WHERE message.organization_id=$1 AND message.thread_id=$2
        AND (communication.id IS NULL OR ${audienceSql})
      ORDER BY COALESCE(message.sent_at, message.received_at, message.created_at) ASC, message.created_at ASC`,
    parameters,
  );
  const communicationIds = messages.rows.map((row) => row.communication_id_resolved).filter(Boolean);
  const participantIds = await resolveCallerParticipantCommunicationIds(client, context, communicationIds);
  const canSeeContent = canViewSensitiveLeadContent(context);
  const projectedMessages = messages.rows.map((row) => {
    if (!row.communication_id_resolved) return row; // no linked communication (e.g. draft) — nothing to project
    const hasContentAccess = canSeeContent || row.communication_created_by === context.userId || participantIds.has(row.communication_id_resolved);
    if (hasContentAccess) return row;
    return {
      id: row.id,
      thread_id: row.thread_id,
      communication_id: row.communication_id,
      direction: row.direction,
      status: row.status,
      sent_at: row.sent_at,
      received_at: row.received_at,
      created_at: row.created_at,
      redacted: true,
    };
  });
  return { thread: thread.rows[0], messages: projectedMessages };
}

// F018 closeout (§33 status): open -> pending/closed, mirroring the enum
// migration 031 already declares. A closed/spam/archived thread can be
// reopened by setting it back to 'open' — no separate "reopen" verb, this
// is a plain governed status field, not a ticketing state machine.
const THREAD_STATUSES = new Set(["open", "pending", "closed", "spam", "archived"]);
export async function updateSharedInboxThreadStatus(client, context, threadId, status) {
  const id = assertId(threadId, "Thread");
  const value = text(status);
  if (!THREAD_STATUSES.has(value))
    throw new CrmCommunicationsError(400, "Unsupported thread status.", "CRM_INBOX_THREAD_STATUS_INVALID");
  const existing = await client.query(
    `SELECT inbox_id FROM tenant.crm_email_threads WHERE organization_id=$1 AND id=$2 LIMIT 1`,
    [context.organizationId, id],
  );
  if (!existing.rows[0])
    throw new CrmCommunicationsError(404, "Thread not found.", "CRM_INBOX_THREAD_NOT_FOUND");
  await assertSharedInboxMember(client, context, existing.rows[0].inbox_id);
  const result = await client.query(
    `UPDATE tenant.crm_email_threads SET status=$3,updated_by=$4,updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`,
    [context.organizationId, id, value, context.userId],
  );
  if (!result.rows[0])
    throw new CrmCommunicationsError(404, "Thread not found.", "CRM_INBOX_THREAD_NOT_FOUND");
  return result.rows[0];
}
