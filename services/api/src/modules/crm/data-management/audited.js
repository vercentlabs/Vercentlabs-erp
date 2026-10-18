// CRM actions in the central audit log (CRM plan 5.7): every export, merge and bulk change made through CRM's entry point is also written
// to the organization's audit events (Settings › Audit), with who did it, what it touched and how it went — beside CRM's own record
// histories, which stay as they are. The CRM index exports these wrapped operations in place of the plain ones.
import { audit } from "../../../core/security/request-security.js";
import { exportAccounts as plainExportAccounts } from "../accounts/import-export.js";
import { mergeAccounts as plainMergeAccounts } from "../accounts/merge.js";
import { bulkAssignAccounts as plainBulkAssignAccounts } from "../accounts/assignment.js";
import { bulkSetAccountStatus as plainBulkSetAccountStatus } from "../accounts/records.js";
import { exportContacts as plainExportContacts } from "../contacts/import-export.js";
import { mergeContacts as plainMergeContacts } from "../contacts/merge.js";
import { bulkAssignContacts as plainBulkAssignContacts } from "../contacts/assignment.js";
import { bulkSetContactStatus as plainBulkSetContactStatus } from "../contacts/records.js";
import { bulkConvertLeads as plainBulkConvertLeads } from "../conversion/bulk.js";
import { exportFollowUps as plainExportFollowUps } from "../follow-ups/export.js";
import { bulkUpdateFollowUps as plainBulkUpdateFollowUps } from "../follow-ups/lifecycle.js";
import { bulkAssignLeads as plainBulkAssignLeads } from "../leads/assignment.js";
import { exportLeads as plainExportLeads } from "../leads/import-export.js";
import { mergeLeads as plainMergeLeads } from "../leads/merge.js";
import { bulkDisqualifyLeads as plainBulkDisqualifyLeads } from "../leads/qualification.js";
import { bulkChangeLeadStage as plainBulkChangeLeadStage } from "../leads/records.js";
import { bulkAssignOpportunities as plainBulkAssignOpportunities } from "../opportunities/assignment.js";
import { exportOpportunities as plainExportOpportunities } from "../opportunities/dashboard.js";
import { mergeOpportunities as plainMergeOpportunities } from "../opportunities/merge.js";
import { bulkChangeOpportunityStage as plainBulkChangeOpportunityStage } from "../opportunities/stages.js";
import { exportTasks as plainExportTasks } from "../tasks/export.js";
import { bulkUpdateTasks as plainBulkUpdateTasks } from "../tasks/lifecycle.js";

const rowsOf = (result) => result?.rowCount ?? result?.rows?.length ?? result?.count ?? null;
const bulkFacts = (result, input) => ({
  selected: Array.isArray(input?.leadIds ?? input?.opportunityIds ?? input?.accountIds ?? input?.contactIds ?? input?.ids ?? input?.taskIds ?? input?.followUpIds)
    ? (input.leadIds ?? input.opportunityIds ?? input.accountIds ?? input.contactIds ?? input.ids ?? input.taskIds ?? input.followUpIds).length : null,
  succeeded: result?.succeeded ?? null, failed: result?.failed ?? null,
});

function audited(plain, eventType, entityType, facts) {
  return async (client, context, ...args) => {
    const result = await plain(client, context, ...args);
    await audit(client, {
      organizationId: context.organizationId, actorUserId: context.userId ?? null, eventType, entityType, entityId: facts.entityId?.(result, ...args) ?? null,
      metadata: { module: "crm", ...(facts.metadata?.(result, ...args) ?? {}) },
    });
    return result;
  };
}

const exportFacts = { metadata: (result, filters) => ({ rows: rowsOf(result), filters: Object.fromEntries(Object.entries(filters ?? {}).filter(([, value]) => value !== undefined && value !== null && value !== "")) }) };
const bulk = () => ({ metadata: (result, input) => ({ ...bulkFacts(result, input), action: input?.action ?? undefined }) });

export const exportLeads = audited(plainExportLeads, "crm.leads.exported", "crm_lead", exportFacts);
export const exportAccounts = audited(plainExportAccounts, "crm.accounts.exported", "crm_account", exportFacts);
export const exportContacts = audited(plainExportContacts, "crm.contacts.exported", "crm_contact", exportFacts);
export const exportOpportunities = audited(plainExportOpportunities, "crm.opportunities.exported", "crm_opportunity", exportFacts);
export const exportFollowUps = audited(plainExportFollowUps, "crm.follow_ups.exported", "crm_follow_up", exportFacts);
export const exportTasks = audited(plainExportTasks, "crm.tasks.exported", "crm_task", exportFacts);

export const mergeLeads = audited(plainMergeLeads, "crm.leads.merged", "crm_lead", {
  entityId: (result) => result?.keptLeadId, metadata: (result) => ({ kept: result?.keptLeadId, merged: result?.mergedLeadId }),
});
export const mergeAccounts = audited(plainMergeAccounts, "crm.accounts.merged", "crm_account", {
  entityId: (result, input) => result?.survivorId ?? result?.keptAccountId ?? input?.survivorId ?? input?.keepId ?? null, metadata: (_result, input) => ({ input: { ...input, choices: undefined } }),
});
export const mergeContacts = audited(plainMergeContacts, "crm.contacts.merged", "crm_contact", {
  entityId: (result, input) => result?.survivorId ?? result?.keptContactId ?? input?.survivorId ?? input?.keepId ?? null, metadata: (_result, input) => ({ input: { ...input, choices: undefined } }),
});
export const mergeOpportunities = audited(plainMergeOpportunities, "crm.opportunities.merged", "crm_opportunity", {
  entityId: (result) => result?.keptOpportunityId, metadata: (result) => ({ kept: result?.keptOpportunityId, merged: result?.mergedOpportunityId, filled: result?.filledFields }),
});

export const bulkAssignLeads = audited(plainBulkAssignLeads, "crm.leads.bulk_assigned", "crm_lead", bulk());
export const bulkChangeLeadStage = audited(plainBulkChangeLeadStage, "crm.leads.bulk_stage_changed", "crm_lead", bulk());
export const bulkDisqualifyLeads = audited(plainBulkDisqualifyLeads, "crm.leads.bulk_disqualified", "crm_lead", bulk());
export const bulkConvertLeads = audited(plainBulkConvertLeads, "crm.leads.bulk_converted", "crm_lead", bulk());
export const bulkAssignAccounts = audited(plainBulkAssignAccounts, "crm.accounts.bulk_assigned", "crm_account", bulk());
export const bulkSetAccountStatus = audited(plainBulkSetAccountStatus, "crm.accounts.bulk_status_changed", "crm_account", bulk());
export const bulkAssignContacts = audited(plainBulkAssignContacts, "crm.contacts.bulk_assigned", "crm_contact", bulk());
export const bulkSetContactStatus = audited(plainBulkSetContactStatus, "crm.contacts.bulk_status_changed", "crm_contact", bulk());
export const bulkAssignOpportunities = audited(plainBulkAssignOpportunities, "crm.opportunities.bulk_assigned", "crm_opportunity", bulk());
export const bulkChangeOpportunityStage = audited(plainBulkChangeOpportunityStage, "crm.opportunities.bulk_stage_changed", "crm_opportunity", bulk());
export const bulkUpdateFollowUps = audited(plainBulkUpdateFollowUps, "crm.follow_ups.bulk_updated", "crm_follow_up", bulk());
export const bulkUpdateTasks = audited(plainBulkUpdateTasks, "crm.tasks.bulk_updated", "crm_task", bulk());
