// The Customer Master. A customer is the party Sales quotes, sells and
// delivers to and Finance invoices; it is the same business party as its CRM
// account, so the two never drift apart. Routes import from here; each
// operation is one function taking (client, context, …) and running inside
// the caller's transaction.
export * from "./constants.js";
export { canViewAllCustomers, canViewCustomerFinancials, customerCan, customerCapabilities, customerScopeSql, requireCustomerPermission } from "./access.js";
export { createCustomer, customerTransactions, deleteCustomer, getCustomer, listCustomers, searchCustomers, updateCustomer } from "./records.js";
export { activateCustomer, blockCustomer, deactivateCustomer, unblockCustomer } from "./lifecycle.js";
export {
  addCustomerAddress, deactivateCustomerAddress, findDuplicateCustomerAddress, listCustomerAddresses, setCustomerAddressActive, setDefaultBillingAddress,
  setDefaultShippingAddress, updateCustomerAddress,
} from "./addresses.js";
export {
  addCustomerContact, deactivateCustomerContact, findExistingContact, linkCustomerContact, listCustomerContacts, searchLinkableCustomerContacts,
  setBillingCustomerContact, setPrimaryCustomerContact, setShippingCustomerContact, updateCustomerContact,
} from "./contacts.js";
export { canOverrideCustomerDuplicate, findDuplicateCustomers } from "./duplicates.js";
export { createCustomerFromAccount, getCustomerPrefillFromAccount, linkCustomerToAccount, searchAccountsForCustomer } from "./account-link.js";
export { CUSTOMER_RELATED_LISTS, getCustomerOverview, listCustomerHistory, listCustomerRelated } from "./summary.js";
export {
  CUSTOMER_IMPORT_FIELDS, analyzeCustomerImport, buildCustomerImportErrorFile, buildCustomerImportTemplate, exportCustomers, importCustomers,
} from "./import-export.js";
export { analyzeCustomerRelatedImport, buildCustomerRelatedImportTemplate, exportCustomerRelated, importCustomerRelated } from "./related-import-export.js";
export { COUNTRIES, getCustomerOptions } from "./options.js";
