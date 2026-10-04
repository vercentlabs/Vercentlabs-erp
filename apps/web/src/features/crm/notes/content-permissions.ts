// Mirrors contentCan (services/api/src/modules/crm/notes/access.js) so the
// panels only offer actions the server would allow. Display only: every
// action is checked again on the server, with the parent record's access.
type Workspace = { roleSlugs: string[]; permissions: string[] };

const LEGACY = new Set(["crm.notes.view", "crm.notes.create", "crm.notes.edit_own", "crm.notes.delete_own", "crm.notes.pin", "crm.attachments.view", "crm.attachments.upload", "crm.attachments.download"]);
const READ = new Set(["crm.notes.view", "crm.attachments.view", "crm.attachments.download"]);

export function contentCan(workspace: Workspace, permission: string) {
  if (workspace.roleSlugs.includes("organization_owner") || workspace.permissions.includes(permission)) return true;
  if (READ.has(permission) && workspace.permissions.includes("crm.view")) return true;
  return LEGACY.has(permission) && workspace.permissions.includes("crm.activities.manage");
}
