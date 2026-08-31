export class ReferenceIntegrityError extends Error {
  constructor(status, message, code = "REFERENCE_INTEGRITY_ERROR") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const COMPANY_RECORDS = Object.freeze({
  project: `SELECT record.* FROM tenant.projects record WHERE record.organization_id=$1 AND record.company_id=$2 AND record.id=$3`,
  warehouse: `SELECT record.* FROM tenant.warehouses record WHERE record.organization_id=$1 AND record.company_id=$2 AND record.id=$3`,
  branch: `SELECT record.* FROM public.branches record WHERE record.organization_id=$1 AND record.company_id=$2 AND record.id=$3`,
  employee: `SELECT record.* FROM tenant.hr_employees record WHERE record.organization_id=$1 AND record.company_id=$2 AND record.id=$3`,
  pos_store: `SELECT record.* FROM tenant.pos_stores record WHERE record.organization_id=$1 AND record.company_id=$2 AND record.id=$3`,
  pos_terminal: `SELECT record.* FROM tenant.pos_terminals record WHERE record.organization_id=$1 AND record.company_id=$2 AND record.id=$3`,
  pos_shift: `SELECT record.* FROM tenant.pos_shifts record WHERE record.organization_id=$1 AND record.company_id=$2 AND record.id=$3`,
});

export async function requireCompanyRecord(client, context, kind, id, { forUpdate = false } = {}) {
  const sql = COMPANY_RECORDS[kind];
  if (!sql) throw new ReferenceIntegrityError(500, `Unsupported reference kind: ${kind}`, "REFERENCE_KIND_INVALID");
  if (!id) throw new ReferenceIntegrityError(400, `${kind} reference is required.`, "REFERENCE_REQUIRED");
  const result = await client.query(`${sql}${forUpdate ? " FOR UPDATE" : ""}`, [context.organizationId, context.companyId, id]);
  if (!result.rows[0]) {
    throw new ReferenceIntegrityError(404, `${kind} was not found for the active company.`, "REFERENCE_COMPANY_MISMATCH");
  }
  return result.rows[0];
}

export async function requireProjectChild(client, context, kind, id, projectId) {
  if (!id) return null;
  const config = {
    milestone: ["project_milestones", "milestone"],
    task: ["project_tasks", "task"],
  }[kind];
  if (!config) throw new ReferenceIntegrityError(500, `Unsupported project child kind: ${kind}`, "REFERENCE_KIND_INVALID");
  const [table, label] = config;
  const result = await client.query(
    `SELECT child.*
     FROM tenant.${table} child
     JOIN tenant.projects project ON project.id=child.project_id AND project.organization_id=child.organization_id
     WHERE child.organization_id=$1 AND project.company_id=$2 AND child.id=$3 AND child.project_id=$4`,
    [context.organizationId, context.companyId, id, projectId],
  );
  if (!result.rows[0]) {
    throw new ReferenceIntegrityError(404, `Project ${label} was not found in the selected project/company.`, "PROJECT_REFERENCE_MISMATCH");
  }
  return result.rows[0];
}
