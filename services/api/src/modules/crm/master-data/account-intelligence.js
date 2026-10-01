// Compatibility boundary for the Account/Contact hierarchy, merge, Customer
// 360 and privacy services. This file holds no implementation: it re-exports
// the public names that used to be defined here, from the files that now own
// them, so @vercentlabs/api (services/api/src/index.js) and existing importers
// keep working unchanged. Add new behaviour to the owning file, not here; CRM
// implementation code imports the owning file directly.

// F002 Account hierarchy
export {
  getAccountHierarchy,
  setAccountParent,
} from "./accounts/account-hierarchy.js";

// Governed Account and Contact merge (survivorship, repointing, aliases)
export {
  previewAccountMerge,
  previewAccountMergeForCaller,
  previewContactMerge,
  previewContactMergeForCaller,
  mergeAccountsGoverned,
  mergeContactsGoverned,
  resolveMergedEntity,
} from "./merge/record-merge.js";

// Customer 360 read model and customer-service events
export {
  recordCustomerServiceEvent,
  getCustomer360,
  getCustomer360ForCaller,
} from "./accounts/customer-360.js";

// Privacy (data-subject) requests: preview and governed execution
export {
  previewPrivacyRequest,
  executePrivacyRequest,
} from "./privacy/privacy-requests.js";

// Privacy retention policies and runs
export {
  getPrivacyRetentionDashboard,
  updatePrivacyRetentionPolicy,
  runPrivacyRetention,
} from "./privacy/privacy-retention.js";

// Stable evidence hash
export {
  crmAccountIntelligenceHash,
} from "./account-intelligence-hash.js";

// Error type
export {
  CrmAccountIntelligenceError,
} from "./account-intelligence-error.js";

// Dormant acceptance evidence (kept for the export contract)
export {
  CRM_ACCOUNT_INTELLIGENCE_CAPABILITY_IDS,
  recordCrmAccountIntelligenceAcceptance,
  getCrmAccountIntelligenceReadiness,
} from "./account-intelligence-acceptance.js";
