// On-demand synchronisation of one connected provider account: lock the
// account, fetch a mailbox or calendar delta, ingest it, and record the job.

import { ingestCalendarDelta } from "../meetings/meeting-calendar.js";
import { CrmCommunicationsError } from "./communications-error.js";
import { ingestMailboxDelta } from "./email-service.js";
import { fetchProviderCalendarDelta, fetchProviderMailboxDelta, loadSyncAccount } from "./provider-integrations.js";

export async function synchronizeProviderAccount(
  client,
  context,
  syncAccountId,
  input = {},
) {
  const account = await loadSyncAccount(client, context, syncAccountId);
  const lock = await client.query(
    `UPDATE tenant.crm_sync_accounts
     SET status='syncing',sync_lock_until=now()+interval '10 minutes',last_error=NULL,updated_at=now()
     WHERE organization_id=$1 AND id=$2 AND (sync_lock_until IS NULL OR sync_lock_until<now())
     RETURNING *`,
    [context.organizationId, account.id],
  );
  if (!lock.rows[0]) {
    throw new CrmCommunicationsError(
      409,
      "A provider synchronization is already running.",
      "CRM_PROVIDER_SYNC_LOCKED",
    );
  }
  const syncType = input.syncType === "calendar" ? "calendar" : "mailbox";
  const job = await client.query(
    `INSERT INTO tenant.crm_provider_sync_jobs(organization_id,sync_account_id,sync_type,cursor_before,status,attempted_count,started_at,metadata)
     VALUES($1,$2,$3,$4,'processing',1,now(),$5) RETURNING *`,
    [
      context.organizationId,
      account.id,
      syncType,
      syncType === "calendar" ? account.calendar_cursor : account.sync_cursor,
      JSON.stringify({ requestedBy: context.userId }),
    ],
  );
  try {
    const page =
      syncType === "calendar"
        ? await fetchProviderCalendarDelta(account, input)
        : await fetchProviderMailboxDelta(account, input);
    const result =
      syncType === "calendar"
        ? await ingestCalendarDelta(client, context, account.id, page)
        : await ingestMailboxDelta(client, context, account.id, page);
    await client.query(
      `UPDATE tenant.crm_provider_sync_jobs SET cursor_after=$3,status='completed',processed_count=$4,completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [
        context.organizationId,
        job.rows[0].id,
        page.nextCursor || null,
        Number(result.processed || result.inserted || 0),
      ],
    );
    return { jobId: job.rows[0].id, ...result };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Provider sync failed.";
    await client.query(
      `UPDATE tenant.crm_provider_sync_jobs SET status='failed',failure_count=1,last_error=$3,next_attempt_at=now()+interval '5 minutes',completed_at=now(),updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, job.rows[0].id, message],
    );
    await client.query(
      `UPDATE tenant.crm_sync_accounts SET status='error',last_error=$3,sync_lock_until=NULL,updated_at=now() WHERE organization_id=$1 AND id=$2`,
      [context.organizationId, account.id, message],
    );
    // Returned, not thrown: the failure rows above must commit with the
    // caller's transaction (a throw rolled them back, losing the evidence and
    // leaving the account locked as 'syncing').
    return { jobId: job.rows[0].id, failed: true, code: error?.code || "CRM_PROVIDER_SYNC_FAILED", retryable: Number(error?.status) >= 500, error: message.slice(0, 500) };
  }
}
