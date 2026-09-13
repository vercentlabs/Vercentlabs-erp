import { z } from "zod";
import { scanLeadSlaBreaches } from "@vercentlabs/api";

export const JOB_TYPE = "crm.automation.detect_lead_sla_breaches";

export const payloadSchema = z.object({}).strict();

// F005/F014 gap: crm_lead_sla_policies already supports
// escalation_after_minutes and reassign_on_breach, and
// scanLeadSlaBreaches (services/api/src/modules/crm/lead-lifecycle-qualification-and-prioritization/lead-intelligence.js)
// already correctly marks a case breached and reassigns the Lead to
// policy.escalation_user_id when configured - the whole "reassignment SLA
// timer" domain logic was real and tested. It was reachable only through
// a manual POST /api/crm/lead-intelligence/sla {action:"scan"} action
// (crm.records.view_all-gated) with no scheduled tick ever calling it, so
// a breach sat undetected until a human happened to click "Scan now".
// This tick is that missing automatic timer.
//
// scanLeadSlaBreaches is gated behind crm.leads.view_sensitive because an
// interactive caller reading/acting on Lead SLA cases org-wide is
// correctly treated as sensitive. This scheduled tick is the automated
// equivalent of that same manager action, so — unlike system-context.js's
// default least-privilege actor, deliberately built for handlers that act
// on one already-identified row — this handler builds its own elevated
// (but still tenant-scoped, still non-human) context rather than widening
// every other job's shared system context.
function slaSweepContext(organizationId) {
  return Object.freeze({
    organizationId,
    userId: null,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: true,
    // crm.leads.manage is required too: a breach with reassign_on_breach
    // configured calls assignLeadOwner(), which is gated behind
    // canAssignLeadOwners() (crm.records.view_all AND crm.leads.manage,
    // not just view_sensitive) — without it every reassignment-on-breach
    // would throw CRM_LEAD_ASSIGNMENT_FORBIDDEN and the scan would fail
    // outright instead of degrading to "detected but not reassigned".
    permissions: ["crm.leads.view_sensitive", "crm.records.view_all", "crm.leads.manage"],
    roleSlugs: ["system_worker"],
  });
}

// Idempotency: identical to detectOverdueActivitiesHandler's own
// reasoning — scanLeadSlaBreaches only ever matches cases still
// status='open'; the same UPDATE that marks a case 'breached' is what
// excludes it from every later scan, so a concurrently-running duplicate
// tick (or a retried job) cannot double-fire the same case's escalation.
export async function detectLeadSlaBreachesHandler(client, systemContext, _payload) {
  const context = slaSweepContext(systemContext.organizationId);
  return scanLeadSlaBreaches(client, context);
}
