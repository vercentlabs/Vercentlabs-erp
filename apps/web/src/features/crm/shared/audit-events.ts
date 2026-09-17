// Ported from docs/frontend-rebuild/recovered-platform-code/apps/web/src/
// modules/crm/crm-data-operations-and-customization/audit-events.ts
// (unchanged logic). These are pure formatting helpers — never write raw
// record free-text (subject/description) into the audit trail, only the
// stable structured fields a reviewer needs.
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

export function crmCallAuditSnapshot(record: Record<string, unknown>) {
  return {
    id: record.id,
    status: record.status,
    direction: record.direction,
    entityType: record.entityType,
    entityId: record.entityId,
    assignedTo: record.assignedTo,
    companyId: record.companyId,
    branchId: record.branchId,
    priority: record.priority,
    outcomeCode: record.outcomeCode,
    durationSeconds: record.durationSeconds,
  };
}

export function crmMeetingAuditSnapshot(record: Record<string, unknown>) {
  return {
    id: record.id,
    status: record.status,
    entityType: record.entityType,
    entityId: record.entityId,
    assignedTo: record.assignedTo,
    companyId: record.companyId,
    branchId: record.branchId,
    priority: record.priority,
    locationType: record.locationType,
    outcomeCode: record.outcomeCode,
    durationSeconds: record.durationSeconds,
    attendeeCount: record.attendeeCount,
    bookingId: record.bookingId,
  };
}

export function crmTaskAuditSnapshot(record: Record<string, unknown>) {
  return {
    id: record.id,
    status: record.status,
    entityType: record.entityType,
    entityId: record.entityId,
    assignedTo: record.assignedTo,
    teamId: record.teamId,
    companyId: record.companyId,
    branchId: record.branchId,
    priority: record.priority,
    dueAt: record.dueAt,
    taskSource: record.taskSource,
    recurrenceParentId: record.recurrenceParentId,
  };
}

export function crmFollowUpAuditSnapshot(record: Record<string, unknown>) {
  return {
    id: record.id,
    status: record.status,
    entityType: record.entityType,
    entityId: record.entityId,
    assignedTo: record.assignedTo,
    companyId: record.companyId,
    branchId: record.branchId,
    dueAt: record.dueAt,
    followUpReason: record.followUpReason,
    followUpChannel: record.followUpChannel,
    followUpSnoozeCount: record.followUpSnoozeCount,
    escalateAfterMinutes: record.escalateAfterMinutes,
  };
}
