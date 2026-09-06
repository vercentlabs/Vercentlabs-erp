import { z } from "zod";
import { scanExpiredQuotations } from "@vercentlabs/api";

export const JOB_TYPE = "sales.automation.detect_expired_quotations";

export const payloadSchema = z.object({}).strict();

// F038 gap: valid_until was stored and reportable, but nothing anywhere
// ever transitioned a quotation's lifecycle_status to 'expired' - no
// scheduled job existed at all, unlike CRM's Lead SLA timer (F005/F014)
// where the reassignment logic already existed and just lacked a trigger.
// Here scanExpiredQuotations (services/api/src/modules/sales/index.js) is
// new domain logic added specifically to close this gap. This tick is its
// scheduled trigger.
function expiryScanContext(organizationId) {
  return Object.freeze({
    organizationId,
    userId: null,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["sales.settings.manage"],
    roleSlugs: ["system_worker"],
  });
}

// Idempotency: scanExpiredQuotations only ever matches quotations still in
// ('approved','sent','viewed') with a past valid_until; the same UPDATE
// that marks a quotation 'expired' is what excludes it from a later scan,
// so a concurrently-running duplicate tick (or a retried job) cannot
// double-fire the same transition.
export async function detectExpiredQuotationsHandler(client, systemContext, _payload) {
  const context = expiryScanContext(systemContext.organizationId);
  return scanExpiredQuotations(client, context);
}
