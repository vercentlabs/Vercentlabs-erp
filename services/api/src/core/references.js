export class ReferenceIntegrityError extends Error {
  constructor(status, message, code = "REFERENCE_INTEGRITY_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const ORGANIZATION_RECORDS = Object.freeze({
  project: `SELECT record.* FROM tenant.projects record WHERE record.organization_id=$1 AND record.id=$2 AND record.deleted_at IS NULL`,
  warehouse: `SELECT record.* FROM tenant.warehouses record WHERE record.organization_id=$1 AND record.id=$2`,
  employee: `SELECT record.* FROM tenant.hr_employees record WHERE record.organization_id=$1 AND record.id=$2`,
  pos_store: `SELECT record.* FROM tenant.pos_stores record WHERE record.organization_id=$1 AND record.id=$2`,
  pos_terminal: `SELECT record.* FROM tenant.pos_terminals record WHERE record.organization_id=$1 AND record.id=$2`,
  pos_shift: `SELECT record.* FROM tenant.pos_shifts record WHERE record.organization_id=$1 AND record.id=$2`,
});

export async function requireOrganizationRecord(client, context, kind, id, { forUpdate = false } = {}) {
  const sql = ORGANIZATION_RECORDS[kind];
  if (!sql) throw new ReferenceIntegrityError(500, `Unsupported reference kind: ${kind}`, "REFERENCE_KIND_INVALID");
  if (!id) throw new ReferenceIntegrityError(400, `${kind} reference is required.`, "REFERENCE_REQUIRED");
  const result = await client.query(`${sql}${forUpdate ? " FOR UPDATE" : ""}`, [context.organizationId, id]);
  if (!result.rows[0]) {
    throw new ReferenceIntegrityError(404, `${kind} was not found in this organization.`, "REFERENCE_NOT_FOUND");
  }
  return result.rows[0];
}

// Former name, kept while callers move to requireOrganizationRecord.
export const requireCompanyRecord = requireOrganizationRecord;
