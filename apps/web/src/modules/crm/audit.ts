export function crmAuditSnapshot(
  resource: string,
  record: Record<string, unknown>,
  changedFields?: string[],
) {
  if (resource !== "leads") return record;
  return {
    id: record.id,
    status: record.status,
    sourceId: record.sourceId,
    ownerUserId: record.ownerUserId,
    companyId: record.companyId,
    branchId: record.branchId,
    ...(changedFields ? { changedFields: [...new Set(changedFields)].sort() } : {}),
  };
}
