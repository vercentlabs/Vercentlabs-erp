export function crmAuditSnapshot(
  resource: string,
  record: Record<string, unknown>,
  changedFields?: string[],
) {
  if (resource === "opportunities") {
    return {
      id: record.id,
      code: record.code,
      status: record.status,
      ownerUserId: record.ownerUserId,
      companyId: record.companyId,
      branchId: record.branchId,
      leadId: record.leadId,
      partyId: record.partyId,
      contactId: record.contactId,
      pipelineId: record.pipelineId,
      stageId: record.stageId,
      ...(changedFields ? { changedFields: [...new Set(changedFields)].sort() } : {}),
    };
  }
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
