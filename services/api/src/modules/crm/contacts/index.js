// The Contacts domain. A contact is a person; their links to companies are
// relationships with their own job title, role and active state. Sales
// quotations and orders, support tickets and opportunities point at the same
// contact rows — there is no separate copy per module. Routes and other
// modules import from here; each operation is one function taking
// (client, context, …) and running inside the caller's transaction.
export * from "./constants.js";
export {
  canViewAllContacts, canViewSensitiveContactContent, contactCan, contactCapabilities, contactScopeSql, contactScopeValues, projectContactForContext,
  requireContactPermission,
} from "./access.js";
export {
  CONTACT_VIEWS, archiveContact, bulkSetContactStatus, contactReferences, createContact, deactivateContact, deleteUnusedContact, getContact, listContacts,
  reactivateContact, setContactStatus, setContactTags, updateContact,
} from "./records.js";
export { applyContactAssignment, assignContact, bulkAssignContacts, reassignContact } from "./assignment.js";
export {
  linkContactToAccount, listContactAccounts, setPrimaryAccount, unlinkContactFromAccount, updateContactRelationship,
} from "./relationships.js";
export { assertNoBlockingContactDuplicate, findDuplicateContacts } from "./duplicates.js";
export { CONTACT_MERGE_FIELDS, mergeContacts, previewContactMerge } from "./merge.js";
export { addContactActivity, listContactActivities, scheduleContactFollowUp } from "./activities.js";
export { CONTACT_RELATED_LISTS, getContactSummary, listContactRelated } from "./summary.js";
export { listContactHistory, recordContactHistory } from "./history.js";
export { CONTACT_IMPORT_FIELDS, analyzeContactImport, buildContactImportTemplate, exportContacts, importContacts } from "./import-export.js";
export { getContactOptions } from "./options.js";
