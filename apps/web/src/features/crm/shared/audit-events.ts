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
