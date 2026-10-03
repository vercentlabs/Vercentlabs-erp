// Compatibility boundary for the Contact merge and privacy services. This
// file holds no implementation: it re-exports the public names that used to
// be defined here, from the files that now own them, so @vercentlabs/api
// (services/api/src/index.js) and existing importers keep working unchanged.
// Account hierarchy, merge and Customer 360 live in modules/crm/accounts.

// Governed Contact merge (survivorship, repointing, aliases)
export {
  previewContactMerge,
  previewContactMergeForCaller,
  mergeContactsGoverned,
  resolveMergedEntity,
} from "./merge/record-merge.js";

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
