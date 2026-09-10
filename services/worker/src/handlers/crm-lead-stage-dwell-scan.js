import { z } from "zod";
import { scanLeadStageDwellBreaches } from "@vercentlabs/api";

export const JOB_TYPE = "crm.automation.detect_lead_dwell_breaches";

export const payloadSchema = z.object({}).strict();

// F007 dwell SLA: this is the scheduled equivalent of the Lead SLA scan
// (crm-lead-sla-scan.js) for stage-dwell breaches. System context is built
// the same way, for the same reason: reading/notifying across every Lead
// in the org is an org-wide governance action, not a single already-
// identified-row action, so it needs the elevated (but still tenant-
// scoped, still non-human) scope every other org-wide scheduled tick uses.
function dwellSweepContext(organizationId) {
  return Object.freeze({
    organizationId,
    userId: null,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    permissions: ["crm.leads.view_sensitive", "crm.records.view_all"],
    roleSlugs: ["system_worker"],
  });
}

// Idempotency: dwell_breach_notified_at is set in the SAME statement that
// detects the breach and is the exclusion predicate for the next scan, so
// a concurrently-running duplicate tick (or a retried job) cannot
// double-notify the same stage entry.
export async function detectLeadStageDwellBreachesHandler(client, systemContext, _payload) {
  const context = dwellSweepContext(systemContext.organizationId);
  return scanLeadStageDwellBreaches(client, context);
}
