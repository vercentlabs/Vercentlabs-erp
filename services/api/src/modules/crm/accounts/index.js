// The Accounts domain. An account is a company the organization sells to or
// works with; it is the same business party Sales and Finance use as the
// Customer Master once it becomes a customer. Routes and other modules import
// from here; each operation is one function taking (client, context, …) and
// running inside the caller's transaction.
export * from "./constants.js";
export {
  accountCan, accountCapabilities, accountScopeSql, canViewAllAccounts, canViewSensitiveAccountContent, projectAccountForContext, requireAccountPermission,
} from "./access.js";
export {
  ACCOUNT_VIEWS, accountReferences, archiveAccount, bulkSetAccountStatus, createAccount, deactivateAccount, deleteUnusedAccount, getAccount,
  listAccounts, reactivateAccount, setAccountStatus, setAccountTags, updateAccount,
} from "./records.js";
export { applyAccountAssignment, assignAccount, bulkAssignAccounts } from "./assignment.js";
export { getAccountHierarchy, setAccountParent } from "./hierarchy.js";
export { addAccountAddress, listAccountAddresses, removeAccountAddress, updateAccountAddress } from "./addresses.js";
export {
  createAccountContact, linkContact, listAccountContacts, searchLinkableContacts, setPrimaryContact, unlinkContact, updateAccountContactRole,
} from "./contacts.js";
export { assertNoBlockingAccountDuplicate, findDuplicateAccounts } from "./duplicates.js";
export { MERGE_FIELDS, mergeAccounts, previewAccountMerge } from "./merge.js";
export { createCustomerFromAccount, customerReadiness, linkCustomer, searchLinkableCustomers } from "./customer.js";
export { ACCOUNT_RELATED_LISTS, getAccountSummary, listAccountRelated } from "./summary.js";
export { addAccountActivity, listAccountActivities, scheduleAccountFollowUp } from "./activities.js";
export { listAccountHistory, recordAccountHistory } from "./history.js";
export { ACCOUNT_IMPORT_FIELDS, analyzeAccountImport, buildAccountImportTemplate, exportAccounts, importAccounts } from "./import-export.js";
export { getAccountListSummary, getAccountReport } from "./reports.js";
export { getAccountOptions } from "./options.js";
