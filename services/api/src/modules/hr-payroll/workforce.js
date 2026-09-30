// F381-F396: employee master and number, departments, designations, reporting line, branch and
// location, employment type, joining (with its onboarding checklist) and employee self-service.
import { nextDocumentNumber } from "../../core/platform/numbering/index.js";
import {
  HrError, canSeeSensitive, cleanBank, cleanStatutory, cleanTax, dateOrNull, dateRequired, hasAny, need, needAny, oneOf, ownEmployee, recordEvent, requireOwnEmployee, stripSensitive, text, textOrNull, uuid, uuidOrNull, nonNegative, qx, seq,
} from "./common.js";

const EMPLOYMENT_TYPES = ["permanent", "contract", "intern", "consultant", "part_time", "temporary"];
const LIVE = ["active", "on_leave", "suspended", "on_notice"];
const DEFAULT_ONBOARDING = [
  { title: "Issue employee ID and email account", owner: "HR" },
  { title: "Collect signed offer and joining forms", owner: "HR" },
  { title: "Assign laptop and workstation", owner: "IT" },
  { title: "Induction with reporting manager", owner: "Manager" },
];
const NAMES = `trim(e.first_name || ' ' || coalesce(e.middle_name || ' ', '') || e.last_name)`;

export async function getHrSettings(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.settings.manage"]);
  return loadSettings(client, c);
}
async function loadSettings(client, c) {
  await qx(client, `INSERT INTO tenant.hr_payroll_settings(organization_id,company_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`, [c.organizationId, c.companyId]);
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_payroll_settings WHERE organization_id=$1 AND company_id=$2`, [c.organizationId, c.companyId]);
  return rows[0];
}

const checklist = (value, label) => {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new HrError(400, `${label} must be a list.`, "HR_CHECKLIST_INVALID");
  return value.map((item) => {
    const title = text(typeof item === "string" ? item : item?.title, 200);
    if (!title) throw new HrError(400, `${label} items need a title.`, "HR_CHECKLIST_INVALID");
    return { title, owner: text(typeof item === "string" ? "" : item?.owner, 60), mandatory: typeof item === "object" ? item?.mandatory !== false : true };
  });
};

export async function saveHrSettings(client, c, input) {
  need(c, "hr_payroll.settings.manage");
  const cur = await loadSettings(client, c);
  const prefix = input.employeeNumberPrefix === undefined ? cur.employee_number_prefix : text(input.employeeNumberPrefix, 12).toUpperCase();
  if (!/^[A-Z0-9]{1,12}$/.test(prefix)) throw new HrError(400, "The employee number prefix must be 1 to 12 letters or digits.", "HR_SETTINGS_INVALID");
  const num = (v, cur2, min, max, label) => {
    if (v === undefined) return cur2;
    const n = Number(v);
    if (!Number.isInteger(n) || n < min || n > max) throw new HrError(400, `${label} must be a whole number from ${min} to ${max}.`, "HR_SETTINGS_INVALID");
    return n;
  };
  const on = checklist(input.onboardingChecklist, "The onboarding checklist");
  const { rows } = await qx(client, 
    `UPDATE tenant.hr_payroll_settings SET employee_number_prefix=$3, employee_number_padding=$4, default_probation_months=$5, default_notice_days=$6,
       require_documents_for_joining=$7, onboarding_checklist=$8::jsonb, offboarding_checklist=$9::jsonb,
       prohibit_self_approval=$10, attendance_grace_minutes=$11, updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 RETURNING *`,
    [
      c.organizationId, c.companyId, prefix, num(input.employeeNumberPadding, cur.employee_number_padding, 3, 10, "Number padding"),
      num(input.defaultProbationMonths, cur.default_probation_months, 0, 24, "Default probation"), num(input.defaultNoticeDays, cur.default_notice_days, 0, 365, "Default notice period"),
      cur.require_documents_for_joining,
      JSON.stringify(on ?? cur.onboarding_checklist), JSON.stringify(cur.offboarding_checklist),
      // self approval can only be tightened, never switched off: the segregation rule is not optional.
      true, num(input.attendanceGraceMinutes, cur.attendance_grace_minutes, 0, 240, "Attendance grace"),
    ],
  );
  // time, leave and payroll rules: each key is validated against its own bounds
  const RULES = {
    overtimeThresholdMinutes: ["overtime_threshold_minutes", "int", 0, 600],
    halfDayPercent: ["half_day_percent", "int", 1, 99],
    fullDayPercent: ["full_day_percent", "int", 1, 100],
    lateMarksPerDeduction: ["late_marks_per_deduction", "int", 0, 31],
    regularizationLimitPerMonth: ["regularization_limit_per_month", "int", 0, 31],
    sandwichRule: ["sandwich_rule", "bool"],
    leaveYearStartMonth: ["leave_year_start_month", "int", 1, 12],
    overtimeMultiplier: ["overtime_multiplier", "num", 1, 5],
    overtimeBasisDays: ["overtime_basis_days", "int", 20, 31],
    overtimeHoursPerDay: ["overtime_hours_per_day", "num", 1, 24],
    maxDeductionPercent: ["max_deduction_percent", "num", 1, 100],
    payrollDaysBasis: ["payroll_days_basis", "enum", ["calendar", "fixed_30"]],
    payslipRelease: ["payslip_release", "enum", ["approval", "payment"]],
    payrollFrequency: ["payroll_frequency", "enum", ["weekly", "biweekly", "monthly"]],
  };
  const set = [];
  const vals = [c.organizationId, c.companyId];
  for (const [key, [column, kind, a, b]] of Object.entries(RULES)) {
    if (input[key] === undefined) continue;
    let v = input[key];
    if (kind === "bool") v = v === true;
    else if (kind === "enum") { if (!a.includes(String(v))) throw new HrError(400, `${key} must be one of: ${a.join(", ")}.`, "HR_SETTINGS_INVALID"); v = String(v); }
    else {
      v = Number(v);
      if (!Number.isFinite(v) || v < a || v > b || (kind === "int" && !Number.isInteger(v))) throw new HrError(400, `${key} must be ${kind === "int" ? "a whole number" : "a number"} from ${a} to ${b}.`, "HR_SETTINGS_INVALID");
    }
    vals.push(v);
    set.push(`${column}=$${vals.length}`);
  }
  if (set.length) {
    const guard = (input.halfDayPercent ?? cur.half_day_percent) >= (input.fullDayPercent ?? cur.full_day_percent);
    if (guard) throw new HrError(400, "The half-day threshold must be below the full-day threshold.", "HR_SETTINGS_INVALID");
    const upd = await client.query(`UPDATE tenant.hr_payroll_settings SET ${set.join(", ")}, updated_at=now() WHERE organization_id=$1 AND company_id=$2 RETURNING *`, vals);
    rows[0] = upd.rows[0];
  }
  await recordEvent(client, c, "settings", c.companyId, "hr.settings.saved", { keys: Object.keys(input) });
  return rows[0];
}

// ---------------------------------------------------------------- departments and designations
export async function listDepartments(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const { rows } = await qx(client, 
    `SELECT d.*, p.name AS parent_name, ${NAMES.replace(/e\./g, "m.")} AS manager_name,
       (SELECT count(*) FROM tenant.hr_employees e WHERE e.organization_id=d.organization_id AND e.department_id=d.id AND e.status = ANY($3::text[]))::int AS headcount
     FROM tenant.hr_departments d
     LEFT JOIN tenant.hr_departments p ON p.id=d.parent_department_id
     LEFT JOIN tenant.hr_employees m ON m.id=d.manager_employee_id
     WHERE d.organization_id=$1 AND d.company_id=$2 ORDER BY d.code`,
    [c.organizationId, c.companyId, LIVE],
  );
  return rows;
}

export async function saveDepartment(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{1,30}$/.test(code)) throw new HrError(400, "Department code must be letters, digits, - or _.", "HR_DEPARTMENT_INVALID");
  if (!name) throw new HrError(400, "Department name is required.", "HR_DEPARTMENT_INVALID");
  const parentId = uuidOrNull(input.parentDepartmentId, "Parent department");
  const managerId = uuidOrNull(input.managerEmployeeId, "Department head");
  if (managerId) {
    const m = await qx(client, `SELECT status FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, managerId]);
    if (!m.rows[0] || !LIVE.includes(m.rows[0].status)) throw new HrError(400, "The department head must be a current employee.", "HR_DEPARTMENT_INVALID");
  }
  if (parentId) {
    const p = await qx(client, `SELECT id FROM tenant.hr_departments WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, parentId]);
    if (!p.rows[0]) throw new HrError(400, "Parent department was not found.", "HR_DEPARTMENT_INVALID");
    if (input.id) {
      // walk up from the proposed parent: reaching this department means a loop
      let cursor = parentId;
      for (let i = 0; i < 50 && cursor; i += 1) {
        if (cursor === input.id) throw new HrError(400, "A department cannot sit under itself or one of its own sub-departments.", "HR_DEPARTMENT_CYCLE");
        const up = await qx(client, `SELECT parent_department_id FROM tenant.hr_departments WHERE organization_id=$1 AND id=$2`, [c.organizationId, cursor]);
        cursor = up.rows[0]?.parent_department_id ?? null;
      }
    }
  }
  const active = input.active !== false;
  if (input.id) {
    if (!active) {
      const used = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_employees WHERE organization_id=$1 AND department_id=$2 AND status = ANY($3::text[])`, [c.organizationId, uuid(input.id, "Department"), LIVE]);
      if (used.rows[0].n > 0) throw new HrError(409, `${used.rows[0].n} current employee(s) are in this department. Move them before deactivating it.`, "HR_DEPARTMENT_IN_USE");
    }
    const { rows } = await qx(client, 
      `UPDATE tenant.hr_departments SET name=$4, parent_department_id=$5, manager_employee_id=$6, active=$7, updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Department"), name, parentId, managerId, active],
    );
    if (!rows[0]) throw new HrError(404, "Department was not found.", "HR_DEPARTMENT_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, 
      `INSERT INTO tenant.hr_departments(organization_id,company_id,code,name,parent_department_id,manager_employee_id,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [c.organizationId, c.companyId, code, name, parentId, managerId, active, c.userId],
    );
    await recordEvent(client, c, "department", rows[0].id, "hr.department.created", { code });
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, `Department ${code} already exists.`, "HR_DEPARTMENT_DUPLICATE");
    throw e;
  }
}

export async function listDesignations(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const { rows } = await qx(client, 
    `SELECT d.*, (SELECT count(*) FROM tenant.hr_employees e WHERE e.organization_id=d.organization_id AND e.designation_id=d.id AND e.status = ANY($3::text[]))::int AS headcount
     FROM tenant.hr_designations d WHERE d.organization_id=$1 AND d.company_id=$2 ORDER BY d.grade NULLS LAST, d.code`,
    [c.organizationId, c.companyId, LIVE],
  );
  return rows;
}
export async function saveDesignation(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const code = text(input.code, 30).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{1,30}$/.test(code)) throw new HrError(400, "Designation code must be letters, digits, - or _.", "HR_DESIGNATION_INVALID");
  if (!name) throw new HrError(400, "Designation name is required.", "HR_DESIGNATION_INVALID");
  const active = input.active !== false;
  if (input.id) {
    if (!active) {
      const used = await qx(client, `SELECT count(*)::int AS n FROM tenant.hr_employees WHERE organization_id=$1 AND designation_id=$2 AND status = ANY($3::text[])`, [c.organizationId, uuid(input.id, "Designation"), LIVE]);
      if (used.rows[0].n > 0) throw new HrError(409, `${used.rows[0].n} current employee(s) hold this designation.`, "HR_DESIGNATION_IN_USE");
    }
    const { rows } = await qx(client, 
      `UPDATE tenant.hr_designations SET name=$4, grade=$5, description=$6, active=$7 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Designation"), name, textOrNull(input.grade, 30), textOrNull(input.description, 500), active],
    );
    if (!rows[0]) throw new HrError(404, "Designation was not found.", "HR_DESIGNATION_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, 
      `INSERT INTO tenant.hr_designations(organization_id,company_id,code,name,grade,description,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [c.organizationId, c.companyId, code, name, textOrNull(input.grade, 30), textOrNull(input.description, 500), active, c.userId],
    );
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, `Designation ${code} already exists.`, "HR_DESIGNATION_DUPLICATE");
    throw e;
  }
}

// ---------------------------------------------------------------- employees
async function loadEmployee(client, c, id, { lock = false } = {}) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3${lock ? " FOR UPDATE" : ""}`, [c.organizationId, c.companyId, uuid(id, "Employee")]);
  if (!rows[0]) throw new HrError(404, "Employee was not found.", "HR_EMPLOYEE_NOT_FOUND");
  return rows[0];
}
export const requireEmployee = loadEmployee;

// A reporting line must never loop: walk up from the proposed manager; meeting the employee is a loop.
async function assertReportingLine(client, c, employeeId, managerId) {
  if (!managerId) return;
  if (managerId === employeeId) throw new HrError(400, "An employee cannot report to themselves.", "HR_MANAGER_CYCLE");
  let cursor = managerId;
  for (let i = 0; i < 60 && cursor; i += 1) {
    if (cursor === employeeId) throw new HrError(400, "That reporting line would loop back to the employee.", "HR_MANAGER_CYCLE");
    const up = await qx(client, `SELECT manager_employee_id, status FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, cursor]);
    if (!up.rows[0]) throw new HrError(400, "Reporting manager was not found.", "HR_MANAGER_INVALID");
    if (i === 0 && up.rows[0].status === "separated") throw new HrError(400, "A separated employee cannot be a reporting manager.", "HR_MANAGER_INVALID");
    cursor = up.rows[0].manager_employee_id;
  }
}

async function assertReferences(client, c, { departmentId, designationId, branchId }) {
  if (departmentId) {
    const r = await qx(client, `SELECT active FROM tenant.hr_departments WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, departmentId]);
    if (!r.rows[0]) throw new HrError(400, "Department was not found.", "HR_DEPARTMENT_NOT_FOUND");
    if (!r.rows[0].active) throw new HrError(400, "That department is inactive.", "HR_DEPARTMENT_INACTIVE");
  }
  if (designationId) {
    const r = await qx(client, `SELECT active FROM tenant.hr_designations WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, designationId]);
    if (!r.rows[0]) throw new HrError(400, "Designation was not found.", "HR_DESIGNATION_NOT_FOUND");
    if (!r.rows[0].active) throw new HrError(400, "That designation is inactive.", "HR_DESIGNATION_INACTIVE");
  }
  if (branchId) {
    const r = await qx(client, `SELECT id FROM public.branches WHERE organization_id=$1 AND company_id=$2 AND id=$3`, [c.organizationId, c.companyId, branchId]);
    if (!r.rows[0]) throw new HrError(400, "Branch was not found in this company.", "HR_BRANCH_NOT_FOUND");
  }
}

function cleanEmails(input) {
  const email = (v, label) => {
    const t = text(v, 200).toLowerCase();
    if (t && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t)) throw new HrError(400, `${label} is not a valid email address.`, "HR_EMAIL_INVALID");
    return t || null;
  };
  return { work: email(input.workEmail, "Work email"), personal: email(input.personalEmail, "Personal email") };
}
const cleanPhone = (v, label) => {
  const t = text(v, 20);
  if (t && !/^[+\d][\d\s-]{6,18}$/.test(t)) throw new HrError(400, `${label} is not a valid phone number.`, "HR_PHONE_INVALID");
  return t || null;
};
function cleanContacts(list) {
  if (list === undefined) return undefined;
  if (!Array.isArray(list)) throw new HrError(400, "Emergency contacts must be a list.", "HR_CONTACT_INVALID");
  return list.slice(0, 5).map((x) => {
    const name = text(x?.name, 120);
    const phone = cleanPhone(x?.phone, "Emergency contact phone");
    if (!name || !phone) throw new HrError(400, "An emergency contact needs a name and a phone number.", "HR_CONTACT_INVALID");
    return { name, relationship: text(x?.relationship, 60), phone };
  });
}
const cleanAddress = (a) => {
  if (a === undefined) return undefined;
  if (typeof a !== "object" || a === null || Array.isArray(a)) throw new HrError(400, "Address must be an object.", "HR_ADDRESS_INVALID");
  const out = {};
  for (const k of ["line1", "line2", "city", "state", "postalCode", "country"]) if (a[k]) out[k] = text(a[k], 200);
  return out;
};

export async function saveEmployee(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const firstName = text(input.firstName, 80);
  const lastName = text(input.lastName, 80);
  if (!firstName || !lastName) throw new HrError(400, "First and last name are required.", "HR_EMPLOYEE_INVALID");
  const employmentType = oneOf(String(input.employmentType ?? "permanent"), EMPLOYMENT_TYPES, "Employment type");
  const joiningDate = dateRequired(input.joiningDate, "Joining date");
  const dob = dateOrNull(input.dateOfBirth, "Date of birth");
  if (dob && dob >= joiningDate) throw new HrError(400, "Date of birth must be before the joining date.", "HR_EMPLOYEE_INVALID");
  if (dob && (Date.parse(joiningDate) - Date.parse(dob)) / 31557600000 < 14) throw new HrError(400, "An employee must be at least 14 years old at joining.", "HR_EMPLOYEE_INVALID");
  const emails = cleanEmails(input);
  const departmentId = uuidOrNull(input.departmentId, "Department");
  const designationId = uuidOrNull(input.designationId, "Designation");
  const managerId = uuidOrNull(input.managerEmployeeId, "Reporting manager");
  const branchId = uuidOrNull(input.branchId, "Branch");
  await assertReferences(client, c, { departmentId, designationId, branchId });
  await assertReportingLine(client, c, "00000000-0000-4000-8000-000000000000", managerId);
  const tax = cleanTax(input.taxIdentifiers ?? { pan: input.pan, aadhaar: input.aadhaar });
  if (tax.pan) {
    const dup = await qx(client, `SELECT employee_number FROM tenant.hr_employees WHERE organization_id=$1 AND tax_identifiers->>'pan'=$2 AND status <> 'separated' LIMIT 1`, [c.organizationId, tax.pan]);
    if (dup.rows[0]) throw new HrError(409, `PAN ${tax.pan} already belongs to employee ${dup.rows[0].employee_number}.`, "HR_PAN_DUPLICATE");
  }
  const settings = await loadSettings(client, c);
  const probation = input.probationMonths === undefined || input.probationMonths === "" ? settings.default_probation_months : Math.trunc(nonNegative(input.probationMonths, "Probation months"));
  if (probation > 24) throw new HrError(400, "Probation cannot exceed 24 months.", "HR_EMPLOYEE_INVALID");
  const userId = uuidOrNull(input.userId, "Linked user");
  if (userId) {
    const linked = await qx(client, `SELECT employee_number FROM tenant.hr_employees WHERE organization_id=$1 AND user_id=$2 AND status <> 'separated'`, [c.organizationId, userId]);
    if (linked.rows[0]) throw new HrError(409, `That user is already linked to ${linked.rows[0].employee_number}.`, "HR_USER_ALREADY_LINKED");
  }
  const number = await nextDocumentNumber(client, c, { documentType: "hr_employee", prefix: settings.employee_number_prefix, padding: settings.employee_number_padding });
  const noticeDays = input.noticePeriodDays === undefined || input.noticePeriodDays === "" ? settings.default_notice_days : Math.trunc(nonNegative(input.noticePeriodDays, "Notice period"));
  try {
    const { rows } = await qx(client, 
      `INSERT INTO tenant.hr_employees(organization_id,company_id,branch_id,employee_number,user_id,first_name,middle_name,last_name,preferred_name,work_email,personal_email,work_phone,personal_phone,
         date_of_birth,gender,marital_status,nationality,address,department_id,designation_id,manager_employee_id,employment_type,joining_date,probation_end_date,status,
         bank_details,tax_identifiers,statutory_identifiers,emergency_contacts,created_by,grade,work_location,notice_period_days,probation_status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18::jsonb,$19,$20,$21,$22,$23,
         CASE WHEN $24::int > 0 THEN ($23::date + make_interval(months => $24::int))::date END,'draft',
         $25::jsonb,$26::jsonb,$27::jsonb,$28::jsonb,$29,$30,$31,$32,CASE WHEN $24::int > 0 THEN 'on_probation' ELSE 'not_applicable' END) RETURNING *`,
      [
        c.organizationId, c.companyId, branchId, number, userId, firstName, textOrNull(input.middleName, 80), lastName, textOrNull(input.preferredName, 80), emails.work, emails.personal,
        cleanPhone(input.workPhone, "Work phone"), cleanPhone(input.personalPhone, "Personal phone"), dob, textOrNull(input.gender, 30), textOrNull(input.maritalStatus, 30), textOrNull(input.nationality, 60),
        JSON.stringify(cleanAddress(input.address) ?? {}), departmentId, designationId, managerId, employmentType, joiningDate, probation,
        JSON.stringify(cleanBank(input.bankDetails)), JSON.stringify(tax), JSON.stringify(cleanStatutory(input.statutoryIdentifiers)), JSON.stringify(cleanContacts(input.emergencyContacts) ?? []),
        c.userId, textOrNull(input.grade, 30), textOrNull(input.workLocation, 120), noticeDays,
      ],
    );
    await recordEvent(client, c, "employee", rows[0].id, "hr.employee.created", { number, employmentType });
    return stripSensitive(rows[0], c);
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, "An employee with that work email already exists.", "HR_EMPLOYEE_DUPLICATE");
    throw e;
  }
}

export async function updateEmployee(client, c, id, input) {
  need(c, "hr_payroll.employee.manage");
  const e = await loadEmployee(client, c, id, { lock: true });
  if (e.status === "separated") throw new HrError(409, "A separated employee's record is closed.", "HR_EMPLOYEE_CLOSED");
  if (input.joiningDate !== undefined && String(input.joiningDate) !== String(e.joining_date).slice(0, 10) && e.status !== "draft") {
    throw new HrError(409, "The joining date cannot change after the employee has joined.", "HR_JOINING_DATE_LOCKED");
  }
  const set = [];
  const params = [c.organizationId, c.companyId, e.id];
  const add = (column, value, cast = "") => {
    params.push(value);
    set.push(`${column}=$${params.length}${cast}`);
  };
  if (input.firstName !== undefined) add("first_name", text(input.firstName, 80) || (() => { throw new HrError(400, "First name is required.", "HR_EMPLOYEE_INVALID"); })());
  if (input.lastName !== undefined) add("last_name", text(input.lastName, 80) || (() => { throw new HrError(400, "Last name is required.", "HR_EMPLOYEE_INVALID"); })());
  if (input.middleName !== undefined) add("middle_name", textOrNull(input.middleName, 80));
  if (input.preferredName !== undefined) add("preferred_name", textOrNull(input.preferredName, 80));
  if (input.workEmail !== undefined || input.personalEmail !== undefined) {
    const emails = cleanEmails({ workEmail: input.workEmail ?? e.work_email, personalEmail: input.personalEmail ?? e.personal_email });
    if (input.workEmail !== undefined) add("work_email", emails.work);
    if (input.personalEmail !== undefined) add("personal_email", emails.personal);
  }
  if (input.workPhone !== undefined) add("work_phone", cleanPhone(input.workPhone, "Work phone"));
  if (input.personalPhone !== undefined) add("personal_phone", cleanPhone(input.personalPhone, "Personal phone"));
  if (input.dateOfBirth !== undefined) add("date_of_birth", dateOrNull(input.dateOfBirth, "Date of birth"));
  for (const [key, column] of [["gender", "gender"], ["maritalStatus", "marital_status"], ["nationality", "nationality"], ["workLocation", "work_location"]]) if (input[key] !== undefined) add(column, textOrNull(input[key], 120));
  if (input.address !== undefined) add("address", JSON.stringify(cleanAddress(input.address)), "::jsonb");
  if (input.emergencyContacts !== undefined) add("emergency_contacts", JSON.stringify(cleanContacts(input.emergencyContacts)), "::jsonb");
  if (input.noticePeriodDays !== undefined) add("notice_period_days", Math.trunc(nonNegative(input.noticePeriodDays, "Notice period")));
  if (input.departmentId !== undefined) { const v = uuidOrNull(input.departmentId, "Department"); await assertReferences(client, c, { departmentId: v }); add("department_id", v); }
  if (input.designationId !== undefined) { const v = uuidOrNull(input.designationId, "Designation"); await assertReferences(client, c, { designationId: v }); add("designation_id", v); }
  if (input.branchId !== undefined) { const v = uuidOrNull(input.branchId, "Branch"); await assertReferences(client, c, { branchId: v }); add("branch_id", v); }
  if (input.managerEmployeeId !== undefined) { const v = uuidOrNull(input.managerEmployeeId, "Reporting manager"); await assertReportingLine(client, c, e.id, v); add("manager_employee_id", v); }
  if (input.grade !== undefined) add("grade", textOrNull(input.grade, 30));
  if (input.employmentType !== undefined) add("employment_type", oneOf(String(input.employmentType), EMPLOYMENT_TYPES, "Employment type"));
  if (input.joiningDate !== undefined) add("joining_date", dateRequired(input.joiningDate, "Joining date"));
  const sensitiveTouched = ["bankDetails", "taxIdentifiers", "statutoryIdentifiers", "userId"].some((k) => input[k] !== undefined);
  if (sensitiveTouched) {
    if (!canSeeSensitive(c)) throw new HrError(403, "Changing bank, tax, statutory identifiers or the user link needs the sensitive-data permission.", "HR_SENSITIVE_FORBIDDEN");
    if (input.bankDetails !== undefined) add("bank_details", JSON.stringify(cleanBank(input.bankDetails)), "::jsonb");
    if (input.taxIdentifiers !== undefined) {
      const tax = cleanTax(input.taxIdentifiers);
      if (tax.pan) {
        const dup = await qx(client, `SELECT employee_number FROM tenant.hr_employees WHERE organization_id=$1 AND tax_identifiers->>'pan'=$2 AND status <> 'separated' AND id <> $3 LIMIT 1`, [c.organizationId, tax.pan, e.id]);
        if (dup.rows[0]) throw new HrError(409, `PAN ${tax.pan} already belongs to employee ${dup.rows[0].employee_number}.`, "HR_PAN_DUPLICATE");
      }
      add("tax_identifiers", JSON.stringify(tax), "::jsonb");
    }
    if (input.statutoryIdentifiers !== undefined) add("statutory_identifiers", JSON.stringify(cleanStatutory(input.statutoryIdentifiers)), "::jsonb");
    if (input.userId !== undefined) {
      const v = uuidOrNull(input.userId, "Linked user");
      if (v) {
        const linked = await qx(client, `SELECT employee_number FROM tenant.hr_employees WHERE organization_id=$1 AND user_id=$2 AND status <> 'separated' AND id <> $3`, [c.organizationId, v, e.id]);
        if (linked.rows[0]) throw new HrError(409, `That user is already linked to ${linked.rows[0].employee_number}.`, "HR_USER_ALREADY_LINKED");
      }
      add("user_id", v);
    }
  }
  if (!set.length) return stripSensitive(e, c);
  try {
    const { rows } = await qx(client, `UPDATE tenant.hr_employees SET ${set.join(", ")}, updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`, params);
    await recordEvent(client, c, "employee", e.id, "hr.employee.updated", { fields: Object.keys(input).filter((k) => !["bankDetails", "taxIdentifiers", "statutoryIdentifiers"].includes(k)), sensitive: sensitiveTouched });
    return stripSensitive(rows[0], c);
  } catch (err) {
    if (err.code === "23505") throw new HrError(409, "An employee with that work email already exists.", "HR_EMPLOYEE_DUPLICATE");
    throw err;
  }
}

async function makeTasks(client, c, employee, kind, list, anchor) {
  const items = Array.isArray(list) && list.length ? list : DEFAULT_ONBOARDING;
  for (const item of items) {
    await qx(client, 
      `INSERT INTO tenant.hr_lifecycle_tasks(organization_id,company_id,employee_id,kind,title,owner_label,mandatory,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.organizationId, c.companyId, employee.id, kind, item.title, item.owner || null, item.mandatory !== false, anchor],
    );
  }
}

// F389: joining. The employee record exists as a draft; joining activates it and raises the onboarding
// checklist.
export async function completeJoining(client, c, id) {
  need(c, "hr_payroll.employee.manage");
  const e = await loadEmployee(client, c, id, { lock: true });
  if (e.status !== "draft") throw new HrError(409, "Only an employee who has not yet joined can be joined.", "HR_JOINING_STATE");
  const settings = await loadSettings(client, c);
  const { rows } = await qx(client, 
    `UPDATE tenant.hr_employees SET status='active', joined_at=now(), updated_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, e.id],
  );
  await makeTasks(client, c, e, "onboarding", settings.onboarding_checklist, String(e.joining_date).slice(0, 10));
  await recordEvent(client, c, "employee", e.id, "hr.employee.joined", { joiningDate: e.joining_date });
  return stripSensitive(rows[0], c);
}

export async function listEmployees(client, c, filters = {}) {
  needAny(c, ["hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const where = ["e.organization_id=$1", "e.company_id=$2"];
  const params = [c.organizationId, c.companyId];
  const add = (sql, v) => { params.push(v); where.push(sql.replace("?", `$${params.length}`)); };
  if (filters.status) add("e.status = ?", String(filters.status));
  if (filters.departmentId) add("e.department_id = ?", uuid(filters.departmentId, "Department"));
  if (filters.employmentType) add("e.employment_type = ?", String(filters.employmentType));
  if (filters.managerId) add("e.manager_employee_id = ?", uuid(filters.managerId, "Manager"));
  if (filters.branchId) add("e.branch_id = ?", uuid(filters.branchId, "Branch"));
  const { rows } = await qx(client, 
    `SELECT e.*, ${NAMES} AS full_name, d.name AS department_name, g.name AS designation_name, ${NAMES.replace(/e\./g, "m.")} AS manager_name, b.name AS branch_name
     FROM tenant.hr_employees e
     LEFT JOIN tenant.hr_departments d ON d.id=e.department_id
     LEFT JOIN tenant.hr_designations g ON g.id=e.designation_id
     LEFT JOIN tenant.hr_employees m ON m.id=e.manager_employee_id
     LEFT JOIN public.branches b ON b.id=e.branch_id
     WHERE ${where.join(" AND ")} ORDER BY e.employee_number LIMIT 1000`,
    params,
  );
  const own = await ownEmployee(client, c);
  return rows.map((r) => stripSensitive(r, c, own?.id));
}

export async function getEmployee(client, c, id) {
  const own = await ownEmployee(client, c);
  if (!(own && own.id === id)) needAny(c, ["hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const e = await loadEmployee(client, c, id);
  const names = await qx(client, 
    `SELECT ${NAMES} AS full_name, d.name AS department_name, g.name AS designation_name, ${NAMES.replace(/e\./g, "m.")} AS manager_name, b.name AS branch_name
     FROM tenant.hr_employees e LEFT JOIN tenant.hr_departments d ON d.id=e.department_id LEFT JOIN tenant.hr_designations g ON g.id=e.designation_id
     LEFT JOIN tenant.hr_employees m ON m.id=e.manager_employee_id LEFT JOIN public.branches b ON b.id=e.branch_id WHERE e.id=$1`, [e.id]);
  const chain = [];
  let cursor = e.manager_employee_id;
  for (let i = 0; i < 20 && cursor; i += 1) {
    const r = await qx(client, `SELECT id, employee_number, manager_employee_id, ${NAMES} AS full_name FROM tenant.hr_employees e WHERE organization_id=$1 AND id=$2`, [c.organizationId, cursor]);
    if (!r.rows[0]) break;
    chain.push({ id: r.rows[0].id, employeeNumber: r.rows[0].employee_number, name: r.rows[0].full_name });
    cursor = r.rows[0].manager_employee_id;
  }
  const reports = await qx(client, `SELECT id, employee_number, status, ${NAMES} AS full_name FROM tenant.hr_employees e WHERE organization_id=$1 AND manager_employee_id=$2 AND status <> 'separated' ORDER BY employee_number`, [c.organizationId, e.id]);
  const tasks = await qx(client, `SELECT * FROM tenant.hr_lifecycle_tasks WHERE organization_id=$1 AND employee_id=$2 ORDER BY kind, created_at`, [c.organizationId, e.id]);
  return { ...stripSensitive(e, c, own?.id), ...names.rows[0], reportingChain: chain, directReports: reports.rows, tasks: tasks.rows };
}

export async function getOrgChart(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const { rows } = await qx(client, 
    `SELECT e.id, e.employee_number, e.manager_employee_id, e.status, ${NAMES} AS full_name, g.name AS designation_name, d.name AS department_name
     FROM tenant.hr_employees e LEFT JOIN tenant.hr_designations g ON g.id=e.designation_id LEFT JOIN tenant.hr_departments d ON d.id=e.department_id
     WHERE e.organization_id=$1 AND e.company_id=$2 AND e.status = ANY($3::text[]) ORDER BY e.employee_number`,
    [c.organizationId, c.companyId, LIVE],
  );
  return rows;
}

// ---------------------------------------------------------------- lifecycle tasks
export async function listLifecycleTasks(client, c, filters = {}) {
  const own = await ownEmployee(client, c);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND t.employee_id=$${params.length}`; }
  if (filters.kind) { params.push(String(filters.kind)); extra += ` AND t.kind=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND t.status=$${params.length}`; }
  if (!hasAny(c, ["hr_payroll.employee.view", "hr_payroll.employee.manage"])) {
    if (!own) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
    params.push(own.id);
    extra += ` AND t.employee_id=$${params.length}`;
  }
  const { rows } = await qx(client, 
    `SELECT t.*, ${NAMES} AS employee_name, e.employee_number, (t.status='open' AND t.due_date IS NOT NULL AND t.due_date < current_date) AS overdue
     FROM tenant.hr_lifecycle_tasks t JOIN tenant.hr_employees e ON e.id=t.employee_id WHERE t.organization_id=$1 AND t.company_id=$2${extra} ORDER BY t.status, t.due_date NULLS LAST, t.created_at LIMIT 1000`, params);
  return rows;
}
export async function addLifecycleTask(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const e = await loadEmployee(client, c, input.employeeId);
  const kind = oneOf(String(input.kind), ["onboarding", "offboarding"], "Checklist kind");
  const title = text(input.title, 200);
  if (!title) throw new HrError(400, "A task needs a title.", "HR_TASK_INVALID");
  const { rows } = await qx(client, 
    `INSERT INTO tenant.hr_lifecycle_tasks(organization_id,company_id,employee_id,kind,title,owner_label,assignee_user_id,mandatory,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [c.organizationId, c.companyId, e.id, kind, title, textOrNull(input.ownerLabel, 60), uuidOrNull(input.assigneeUserId, "Assignee"), input.mandatory !== false, dateOrNull(input.dueDate, "Due date")],
  );
  return rows[0];
}
export async function completeLifecycleTask(client, c, id, { note, waive } = {}) {
  need(c, "hr_payroll.employee.manage");
  if (waive && !text(note)) throw new HrError(400, "Give a reason for waiving the task.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, 
    `UPDATE tenant.hr_lifecycle_tasks SET status=$4, completed_by=$5, completed_at=now(), note=$6 WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status='open' RETURNING *`,
    [c.organizationId, c.companyId, uuid(id, "Task"), waive ? "waived" : "done", c.userId, textOrNull(note)],
  );
  if (!rows[0]) throw new HrError(409, "That task is not open.", "HR_TASK_STATE");
  return rows[0];
}

// ---------------------------------------------------------------- employee self-service
export async function getMyProfile(client, c) {
  const me = await requireOwnEmployee(client, c);
  return getEmployee(client, c, me.id);
}

const SELF_EDITABLE = ["preferredName", "personalPhone", "personalEmail", "maritalStatus", "address", "emergencyContacts"];
export async function updateMyProfile(client, c, input) {
  const me = await requireOwnEmployee(client, c);
  const attempted = Object.keys(input).filter((k) => input[k] !== undefined);
  const blocked = attempted.filter((k) => !SELF_EDITABLE.includes(k));
  if (blocked.length) throw new HrError(403, `You can change your contact details, address and emergency contacts yourself. ${blocked.join(", ")} must go through HR.`, "HR_ESS_FIELD_BLOCKED");
  const set = [];
  const params = [c.organizationId, me.id];
  const add = (col, v, cast = "") => { params.push(v); set.push(`${col}=$${params.length}${cast}`); };
  if (input.preferredName !== undefined) add("preferred_name", textOrNull(input.preferredName, 80));
  if (input.personalPhone !== undefined) add("personal_phone", cleanPhone(input.personalPhone, "Phone"));
  if (input.personalEmail !== undefined) add("personal_email", cleanEmails({ personalEmail: input.personalEmail }).personal);
  if (input.maritalStatus !== undefined) add("marital_status", textOrNull(input.maritalStatus, 30));
  if (input.address !== undefined) add("address", JSON.stringify(cleanAddress(input.address)), "::jsonb");
  if (input.emergencyContacts !== undefined) add("emergency_contacts", JSON.stringify(cleanContacts(input.emergencyContacts)), "::jsonb");
  if (!set.length) return me;
  const { rows } = await qx(client, `UPDATE tenant.hr_employees SET ${set.join(", ")}, updated_at=now() WHERE organization_id=$1 AND id=$2 RETURNING *`, params);
  await recordEvent(client, c, "employee", me.id, "hr.ess.profile_updated", { fields: attempted });
  return rows[0];
}

// ---------------------------------------------------------------- dashboard
export async function getWorkforceDashboard(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const [byStatus, tasks, byDept, byType] = await seq([
    () => qx(client, `SELECT status, count(*)::int AS n FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 GROUP BY status`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS n FROM tenant.hr_lifecycle_tasks WHERE organization_id=$1 AND company_id=$2 AND status='open' AND due_date < current_date`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT coalesce(d.name,'Unassigned') AS name, count(*)::int AS n FROM tenant.hr_employees e LEFT JOIN tenant.hr_departments d ON d.id=e.department_id WHERE e.organization_id=$1 AND e.company_id=$2 AND e.status = ANY($3::text[]) GROUP BY 1 ORDER BY n DESC LIMIT 12`, [c.organizationId, c.companyId, LIVE]),
    () => qx(client, `SELECT employment_type, count(*)::int AS n FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND status = ANY($3::text[]) GROUP BY 1 ORDER BY n DESC`, [c.organizationId, c.companyId, LIVE]),
  ]);
  const status = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n]));
  const headcount = LIVE.reduce((sum, s) => sum + (status[s] ?? 0), 0);
  return { headcount, status, overdueTasks: tasks.rows[0].n, byDepartment: byDept.rows, byEmploymentType: byType.rows };
}

