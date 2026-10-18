export type CrmContext = {
  organizationId: string;
  userId: string;
  // canViewAllCrmRecords() (crm-access-scope.js) reads these
  // to decide record-ownership scope. Always populated — from the real
  // authenticated session for human requests (crmContext()), or from a
  // least-privilege system actor (services/worker's buildSystemContext()).
  // There is no anonymous/public CrmContext: public lead capture uses a
  // separate function (captureCrmLead) that never touches this type.
  permissions: readonly string[];
  roleSlugs: readonly string[];
};
