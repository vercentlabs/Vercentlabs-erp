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

// Prompt 6 (CRM-CAP-004): F015 Tasks (team/queue closeout) — excludes
// subject/description free text, matching the same "no free-text payload
// in audit" convention crmCallAuditSnapshot/crmMeetingAuditSnapshot/
// crmFollowUpAuditSnapshot already use.
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

// Prompt 6 (CRM-CAP-004): F016 Follow-ups and reminders.
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
