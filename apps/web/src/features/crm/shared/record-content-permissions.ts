// Mirrors assertCanWriteCrmRecordContent (services/api … crm-access-scope.js):
// adding or changing notes/files on a record needs permission to manage that
// kind of record, or crm.activities.manage — seeing the record is not enough.
// Display only; the server decides.
const CONTENT_WRITE_PERMISSION: Record<string, string> = {
  lead: "crm.leads.manage",
  opportunity: "crm.opportunities.manage",
  party: "crm.accounts.manage",
  contact: "crm.accounts.manage",
  campaign: "crm.campaigns.manage",
};

export function canWriteCrmRecordContent(workspace: { roleSlugs: string[]; permissions: string[] }, entityType: string): boolean {
  if (workspace.roleSlugs.includes("organization_owner")) return true;
  const key = CONTENT_WRITE_PERMISSION[entityType];
  return Boolean(key && workspace.permissions.includes(key)) || workspace.permissions.includes("crm.activities.manage");
}
