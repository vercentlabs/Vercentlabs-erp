import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import { omitFields, omitFieldsFromRows } from "../../core/field-visibility.js";
import { requireCompanyRecord } from "../../core/references.js";

// Personal/financial PII on tenant.hr_employees gated behind
// hr_payroll.sensitive.view (see docs/implementation/
// ERP_SECURITY_HARDENING_003.md, Part 1). Read-only enforcement: the
// permission is named "sensitiveView" and no separate write/manage
// counterpart exists for it, so mutation authority remains governed by the
// pre-existing hr_payroll.employee.manage permission, unchanged.
const EMPLOYEE_SENSITIVE_FIELDS = Object.freeze([
  "personal_email",
  "personal_phone",
  "date_of_birth",
  "gender",
  "marital_status",
  "nationality",
  "address",
  "bank_details",
  "tax_identifiers",
  "statutory_identifiers",
  "emergency_contacts",
]);

function canViewSensitiveEmployeeFields(context) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    Boolean(context.permissions?.includes("hr_payroll.sensitive.view"))
  );
}

const TABLES = Object.freeze({
  employees: "hr_employees",
  departments: "hr_departments",
  designations: "hr_designations",
  shifts: "hr_shifts",
  attendance: "hr_attendance",
  "leave-types": "hr_leave_types",
  "leave-requests": "hr_leave_requests",
  expenses: "hr_employee_expenses",
  "salary-structures": "hr_salary_structures",
  "payroll-runs": "hr_payroll_runs",
  payslips: "hr_payslips",
  "statutory-components": "hr_statutory_components",
});

function requirePermission(context, permission) {
  if (
    !context.roleSlugs?.includes("organization_owner") &&
    !context.permissions?.includes(permission)
  ) {
    const error = new Error(`Missing permission: ${permission}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

function hasAnyPermission(context, permissions) {
  return (
    Boolean(context.roleSlugs?.includes("organization_owner")) ||
    permissions.some((permission) => context.permissions?.includes(permission))
  );
}

function requireAnyPermission(context, permissions) {
  if (!hasAnyPermission(context, permissions)) {
    const error = new Error(`Missing required HR & Payroll permission: ${permissions.join(" or ")}`);
    error.code = "FORBIDDEN";
    throw error;
  }
}

const RESOURCE_READ_PERMISSIONS = Object.freeze({
  hr_employees: ["hr_payroll.employee.view", "hr_payroll.employee.manage"],
  hr_departments: ["hr_payroll.view"],
  hr_designations: ["hr_payroll.view"],
  hr_shifts: ["hr_payroll.view", "hr_payroll.shift.manage"],
  hr_attendance: ["hr_payroll.view", "hr_payroll.attendance.manage"],
  hr_leave_types: ["hr_payroll.view", "hr_payroll.leave.manage", "hr_payroll.leave.approve"],
  hr_leave_requests: ["hr_payroll.view", "hr_payroll.leave.manage", "hr_payroll.leave.approve"],
  hr_employee_expenses: ["hr_payroll.view", "hr_payroll.expense.manage", "hr_payroll.expense.approve"],
  hr_salary_structures: ["hr_payroll.sensitive.view", "hr_payroll.compensation.manage"],
  hr_payroll_runs: [
    "hr_payroll.sensitive.view",
    "hr_payroll.payroll.prepare",
    "hr_payroll.payroll.approve",
    "hr_payroll.payroll.post",
  ],
  hr_payslips: ["hr_payroll.payslip.view"],
  hr_statutory_components: ["hr_payroll.sensitive.view", "hr_payroll.statutory.manage"],
});

function table(resource) {
  const value = TABLES[resource];
  if (!value) throw new Error("Unsupported HR & Payroll resource.");
  return value;
}

async function event(
  client,
  context,
  aggregateType,
  aggregateId,
  eventType,
  payload = {},
) {
  await client.query(
    `INSERT INTO tenant.hr_payroll_events
      (organization_id,company_id,aggregate_type,aggregate_id,event_type,payload,actor_user_id)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)`,
    [
      context.organizationId,
      context.companyId,
      aggregateType,
      aggregateId,
      eventType,
      JSON.stringify(payload),
      context.userId,
    ],
  );
}

export async function getHrPayrollDashboard(client, context) {
  requirePermission(context, "hr_payroll.view");
  const employees = await client.query(
    `SELECT
       count(*) FILTER (WHERE status='active')::int AS active_employees,
       count(*) FILTER (WHERE status='on_leave')::int AS employees_on_leave,
       count(*) FILTER (WHERE joining_date BETWEEN current_date-30 AND current_date)::int AS new_joiners,
       count(*) FILTER (WHERE separation_date BETWEEN current_date AND current_date+30)::int AS upcoming_separations
     FROM tenant.hr_employees
     WHERE organization_id=$1 AND company_id=$2`,
    [context.organizationId, context.companyId],
  );
  const canViewPayroll = hasAnyPermission(context, RESOURCE_READ_PERMISSIONS.hr_payroll_runs);
  if (!canViewPayroll) {
    return {
      ...employees.rows[0],
      payroll_access: false,
      open_payroll_runs: null,
      latest_net_pay: null,
    };
  }
  const payroll = await client.query(
    `SELECT
       count(*) FILTER (WHERE status IN ('draft','calculated','pending_approval'))::int AS open_payroll_runs,
       coalesce(sum(net_pay) FILTER (WHERE status IN ('approved','posted')),0)::text AS latest_net_pay
     FROM tenant.hr_payroll_runs
     WHERE organization_id=$1 AND company_id=$2
       AND period_end >= date_trunc('month',current_date)::date`,
    [context.organizationId, context.companyId],
  );
  return { ...employees.rows[0], payroll_access: true, ...payroll.rows[0] };
}

export async function listHrPayrollResource(
  client,
  context,
  resource,
  { limit = 100, offset = 0, employeeId = null } = {},
) {
  requirePermission(context, "hr_payroll.view");
  const target = table(resource);
  requireAnyPermission(context, RESOURCE_READ_PERMISSIONS[target] || ["hr_payroll.view"]);
  const values = [context.organizationId, context.companyId];
  let filter = "";
  if (
    employeeId &&
    [
      "hr_attendance",
      "hr_leave_requests",
      "hr_employee_expenses",
      "hr_payslips",
    ].includes(target)
  ) {
    values.push(employeeId);
    filter = ` AND record.employee_id=$${values.length}`;
  }
  values.push(Math.min(Number(limit) || 100, 200), Number(offset) || 0);
  const result = await client.query(
    `SELECT record.* FROM tenant.${target} record
     WHERE record.organization_id=$1 AND record.company_id=$2${filter}
     ORDER BY record.created_at DESC NULLS LAST,record.id DESC
     LIMIT $${values.length - 1} OFFSET $${values.length}`,
    values,
  );
  if (target === "hr_employees" && !canViewSensitiveEmployeeFields(context)) {
    return omitFieldsFromRows(result.rows, EMPLOYEE_SENSITIVE_FIELDS);
  }
  return result.rows;
}

export async function createEmployee(client, context, input) {
  requirePermission(context, "hr_payroll.employee.manage");
  if (input.branchId) {
    await requireCompanyRecord(client, context, "branch", input.branchId);
  }
  const employeeNumber = input.employeeNumber || await nextDocumentNumber(client, context, {
    documentType: "hr_employee",
    prefix: "EMP",
  });
  const result = await client.query(
    `INSERT INTO tenant.hr_employees
      (organization_id,company_id,branch_id,employee_number,user_id,first_name,
       middle_name,last_name,preferred_name,work_email,personal_email,work_phone,
       personal_phone,date_of_birth,gender,marital_status,nationality,address,
       department_id,designation_id,manager_employee_id,employment_type,
       joining_date,probation_end_date,confirmation_date,status,bank_details,
       tax_identifiers,statutory_identifiers,emergency_contacts,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
       $18::jsonb,$19,$20,$21,$22,$23,$24,$25,'active',$26::jsonb,$27::jsonb,
       $28::jsonb,$29::jsonb,$30)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.branchId || null,
      employeeNumber,
      input.userId || null,
      input.firstName,
      input.middleName || null,
      input.lastName,
      input.preferredName || null,
      input.workEmail || null,
      input.personalEmail || null,
      input.workPhone || null,
      input.personalPhone || null,
      input.dateOfBirth || null,
      input.gender || null,
      input.maritalStatus || null,
      input.nationality || null,
      JSON.stringify(input.address || {}),
      input.departmentId || null,
      input.designationId || null,
      input.managerEmployeeId || null,
      input.employmentType,
      input.joiningDate,
      input.probationEndDate || null,
      input.confirmationDate || null,
      JSON.stringify(input.bankDetails || {}),
      JSON.stringify(input.taxIdentifiers || {}),
      JSON.stringify(input.statutoryIdentifiers || {}),
      JSON.stringify(input.emergencyContacts || []),
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "employee",
    result.rows[0].id,
    "hr.employee.created",
  );
  return canViewSensitiveEmployeeFields(context)
    ? result.rows[0]
    : omitFields(result.rows[0], EMPLOYEE_SENSITIVE_FIELDS);
}

export async function createLeaveRequest(client, context, input) {
  requirePermission(context, "hr_payroll.leave.manage");
  await requireCompanyRecord(client, context, "employee", input.employeeId);
  const result = await client.query(
    `INSERT INTO tenant.hr_leave_requests
      (organization_id,company_id,employee_id,leave_type_id,start_date,end_date,
       days,reason,attachment_reference,status,submitted_at,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'submitted',now(),$10)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.employeeId,
      input.leaveTypeId,
      input.startDate,
      input.endDate,
      String(input.days),
      input.reason || null,
      input.attachmentReference || null,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "leave_request",
    result.rows[0].id,
    "hr.leave.submitted",
  );
  return result.rows[0];
}

export async function reviewLeaveRequest(
  client,
  context,
  leaveRequestId,
  input,
) {
  requirePermission(context, "hr_payroll.leave.approve");
  const current = await client.query(
    `SELECT * FROM tenant.hr_leave_requests
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, leaveRequestId],
  );
  const row = current.rows[0];
  if (!row || row.status !== "submitted") {
    throw new Error("Only submitted leave requests can be reviewed.");
  }
  if (row.created_by === context.userId) {
    const error = new Error("A user cannot approve their own leave request.");
    error.code = "SELF_APPROVAL_BLOCKED";
    throw error;
  }

  const approved = input.action === "approve";
  const updated = await client.query(
    `UPDATE tenant.hr_leave_requests
     SET status=$4,approved_by=$5,
       approved_at=CASE WHEN $4='approved' THEN now() ELSE NULL END,
       rejection_reason=$6,updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      leaveRequestId,
      approved ? "approved" : "rejected",
      context.userId,
      approved ? null : input.reason || "Rejected",
    ],
  );

  if (approved) {
    await client.query(
      `UPDATE tenant.hr_leave_balances
       SET used=used+$4,closing_balance=opening_balance+accrued+adjusted-(used+$4),
         updated_at=now()
       WHERE organization_id=$1 AND company_id=$2
         AND employee_id=$3 AND leave_type_id=$5
         AND leave_year=extract(year from $6::date)::int`,
      [
        context.organizationId,
        context.companyId,
        row.employee_id,
        row.days,
        row.leave_type_id,
        row.start_date,
      ],
    );
  }

  await event(
    client,
    context,
    "leave_request",
    leaveRequestId,
    approved ? "hr.leave.approved" : "hr.leave.rejected",
  );
  return updated.rows[0];
}

export async function createPayrollRun(client, context, input) {
  requirePermission(context, "hr_payroll.payroll.prepare");
  if (input.branchId) {
    await requireCompanyRecord(client, context, "branch", input.branchId);
  }
  const payrollNumber = input.payrollNumber || await nextDocumentNumber(client, context, {
    documentType: "hr_payroll_run",
    prefix: "PAY",
  });
  const result = await client.query(
    `INSERT INTO tenant.hr_payroll_runs
      (organization_id,company_id,branch_id,payroll_number,period_start,
       period_end,payment_date,status,created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'draft',$8)
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      input.branchId || null,
      payrollNumber,
      input.periodStart,
      input.periodEnd,
      input.paymentDate,
      context.userId,
    ],
  );
  await event(
    client,
    context,
    "payroll_run",
    result.rows[0].id,
    "payroll.run.created",
  );
  return result.rows[0];
}

export async function calculatePayrollRun(client, context, payrollRunId) {
  requirePermission(context, "hr_payroll.payroll.prepare");
  const runResult = await client.query(
    `SELECT * FROM tenant.hr_payroll_runs
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
       AND status='draft' FOR UPDATE`,
    [context.organizationId, context.companyId, payrollRunId],
  );
  const run = runResult.rows[0];
  if (!run) throw new Error("Draft payroll run not found.");

  const employees = await client.query(
    `SELECT employee.*,compensation.monthly_gross
     FROM tenant.hr_employees employee
     LEFT JOIN LATERAL (
       SELECT monthly_gross
       FROM tenant.hr_employee_compensation compensation
       WHERE compensation.organization_id=employee.organization_id
         AND compensation.employee_id=employee.id
         AND compensation.effective_from <= $3
         AND (compensation.effective_to IS NULL OR compensation.effective_to >= $2)
       ORDER BY compensation.effective_from DESC
       LIMIT 1
     ) compensation ON true
     WHERE employee.organization_id=$1 AND employee.company_id=$4
       AND employee.status IN ('active','on_leave')
       AND employee.joining_date <= $3
       AND (employee.separation_date IS NULL OR employee.separation_date >= $2)`,
    [
      context.organizationId,
      run.period_start,
      run.period_end,
      context.companyId,
    ],
  );

  let grossPay = 0;
  let totalDeductions = 0;
  let employerContributions = 0;
  let netPay = 0;

  for (const employee of employees.rows) {
    const gross = Number(employee.monthly_gross || 0);
    const attendance = await client.query(
      `SELECT
         count(*) FILTER (WHERE status IN ('present','remote','holiday','weekly_off','leave'))::numeric AS paid_days,
         count(*) FILTER (WHERE status='absent')::numeric AS absent_days,
         coalesce(sum(overtime_minutes),0)::int AS overtime_minutes
       FROM tenant.hr_attendance
       WHERE organization_id=$1 AND company_id=$2 AND employee_id=$3
         AND attendance_date BETWEEN $4 AND $5`,
      [
        context.organizationId,
        context.companyId,
        employee.id,
        run.period_start,
        run.period_end,
      ],
    );

    const daysInPeriod =
      (new Date(run.period_end).getTime() -
        new Date(run.period_start).getTime()) /
        86400000 +
      1;
    const absentDays = Number(attendance.rows[0].absent_days || 0);
    const payableRatio = Math.max(
      0,
      (daysInPeriod - absentDays) / daysInPeriod,
    );
    const adjustedGross = gross * payableRatio;
    const deductions = 0;
    const employer = 0;
    const net = adjustedGross - deductions;

    const payslip = await client.query(
      `INSERT INTO tenant.hr_payslips
        (organization_id,company_id,payroll_run_id,employee_id,payslip_number,
         working_days,paid_days,leave_days,absent_days,overtime_minutes,
         gross_pay,total_deductions,employer_contributions,net_pay,status,generated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,0,$8,$9,$10,$11,$12,$13,'calculated',now())
       RETURNING *`,
      [
        context.organizationId,
        context.companyId,
        payrollRunId,
        employee.id,
        `PS-${run.payroll_number}-${employee.employee_number}`,
        String(daysInPeriod),
        String(daysInPeriod - absentDays),
        String(absentDays),
        Number(attendance.rows[0].overtime_minutes || 0),
        String(adjustedGross),
        String(deductions),
        String(employer),
        String(net),
      ],
    );

    await client.query(
      `INSERT INTO tenant.hr_payslip_lines
        (organization_id,payslip_id,component_code,component_name,
         component_type,amount,taxable_amount,employer_amount)
       VALUES ($1,$2,'BASIC_GROSS','Gross Earnings','earning',$3,$3,0)`,
      [context.organizationId, payslip.rows[0].id, String(adjustedGross)],
    );

    grossPay += adjustedGross;
    totalDeductions += deductions;
    employerContributions += employer;
    netPay += net;
  }

  const updated = await client.query(
    `UPDATE tenant.hr_payroll_runs
     SET status='calculated',employee_count=$4,gross_pay=$5,total_deductions=$6,
       employer_contributions=$7,net_pay=$8,calculated_by=$9,
       calculated_at=now()
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      payrollRunId,
      employees.rows.length,
      String(grossPay),
      String(totalDeductions),
      String(employerContributions),
      String(netPay),
      context.userId,
    ],
  );

  await event(
    client,
    context,
    "payroll_run",
    payrollRunId,
    "payroll.run.calculated",
    {
      employeeCount: employees.rows.length,
      netPay,
    },
  );
  return updated.rows[0];
}

export async function transitionPayrollRun(
  client,
  context,
  payrollRunId,
  input,
) {
  const action = input.action;
  const transitions = {
    submit: ["calculated", "pending_approval"],
    approve: ["pending_approval", "approved"],
    post: ["approved", "posted"],
    cancel: ["draft", "cancelled"],
  };
  const transition = transitions[action];
  if (!transition) throw new Error("Unsupported payroll action.");

  requirePermission(
    context,
    action === "approve"
      ? "hr_payroll.payroll.approve"
      : action === "post"
        ? "hr_payroll.payroll.post"
        : "hr_payroll.payroll.prepare",
  );

  const current = await client.query(
    `SELECT * FROM tenant.hr_payroll_runs
     WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`,
    [context.organizationId, context.companyId, payrollRunId],
  );
  const row = current.rows[0];
  if (!row || row.status !== transition[0]) {
    throw new Error("Payroll run is not in the required state.");
  }
  if (action === "approve" && row.created_by === context.userId) {
    const error = new Error(
      "The payroll creator cannot approve the same payroll run.",
    );
    error.code = "SELF_APPROVAL_BLOCKED";
    throw error;
  }

  const updated = await client.query(
    `UPDATE tenant.hr_payroll_runs
     SET status=$4,
       approved_by=CASE WHEN $4='approved' THEN $5 ELSE approved_by END,
       approved_at=CASE WHEN $4='approved' THEN now() ELSE approved_at END,
       accounting_batch_id=CASE WHEN $4='posted' THEN $6 ELSE accounting_batch_id END,
       posted_by=CASE WHEN $4='posted' THEN $5 ELSE posted_by END,
       posted_at=CASE WHEN $4='posted' THEN now() ELSE posted_at END
     WHERE organization_id=$1 AND company_id=$2 AND id=$3
     RETURNING *`,
    [
      context.organizationId,
      context.companyId,
      payrollRunId,
      transition[1],
      context.userId,
      input.accountingBatchId || null,
    ],
  );

  await client.query(
    `UPDATE tenant.hr_payslips
     SET status=$4
     WHERE organization_id=$1 AND company_id=$2 AND payroll_run_id=$3`,
    [
      context.organizationId,
      context.companyId,
      payrollRunId,
      transition[1] === "posted"
        ? "posted"
        : transition[1] === "approved"
          ? "approved"
          : "calculated",
    ],
  );

  await event(
    client,
    context,
    "payroll_run",
    payrollRunId,
    `payroll.run.${action}`,
    { accountingBatchId: input.accountingBatchId || null },
  );
  return updated.rows[0];
}
