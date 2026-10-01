import { z } from "zod";
import {
  claimCalendarSyncAccounts,
  completeCalendarSync,
  failCalendarSync,
  fetchProviderCalendarDelta,
} from "@vercentlabs/api/crm";
import { createLogger } from "@vercentlabs/observability";

export const JOB_TYPE = "crm.calendar.sync";

export const payloadSchema = z.object({}).strict();

const logger = createLogger("worker-crm-calendar-sync");

function systemContext(organizationId) {
  return Object.freeze({
    organizationId,
    userId: null,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: [],
    roleSlugs: ["system_worker"],
  });
}

// F014 inbound calendar sync: busy time from a host's connected Google or
// Microsoft calendar reaches CRM availability. Claim (short transaction,
// SKIP LOCKED + lease) -> provider call outside any transaction -> ingest or
// record the failure (second short transaction), per account. One account's
// provider failure is recorded on that account and never fails the others.
// Duplicate provider events collapse on UNIQUE(organization, provider,
// external_event_id); cancelled/deleted events close the existing row.
export async function syncCalendarAccountsHandler(_client, _systemContext, _payload, runtime) {
  const context = systemContext(runtime.organizationId);
  const fetchImpl = runtime.fetchImpl ?? globalThis.fetch;
  const accounts = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => claimCalendarSyncAccounts(client, context));
  const outcome = { accounts: accounts.length, synced: 0, failed: 0, events: 0, cancelled: 0 };
  for (const account of accounts) {
    const started = Date.now();
    let page;
    try {
      page = await fetchProviderCalendarDelta(account, { fetchImpl, environment: runtime.environment ?? process.env });
    } catch (error) {
      await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => failCalendarSync(client, context, account, error));
      outcome.failed += 1;
      logger.event("crm.meeting_sync", { organizationId: runtime.organizationId, provider: account.provider, outcome: "failed", errorCode: error?.code || "CRM_PROVIDER_SYNC_FAILED", durationMs: Date.now() - started }, "warn");
      continue;
    }
    const result = await runtime.withTenantClient(runtime.pool, runtime.organizationId, (client) => completeCalendarSync(client, context, account, page));
    outcome.synced += 1;
    outcome.events += result.processed;
    outcome.cancelled += result.cancelled;
    logger.event("crm.meeting_sync", { organizationId: runtime.organizationId, provider: account.provider, outcome: "synced", recordCount: result.processed, cancelled: result.cancelled, skipped: result.skipped, durationMs: Date.now() - started });
  }
  return outcome;
}
