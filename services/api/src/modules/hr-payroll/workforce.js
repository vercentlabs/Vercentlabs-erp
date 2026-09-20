// F381-F396: employee master and number, departments, designations, reporting line, branch and
// location, employment type, documents, joining, probation, confirmation, transfers, promotions,
// separation, offboarding and employee self-service.
import { nextDocumentNumber } from "../../core/document-numbering.js";
import {
  HrError, addDays, canSeeSensitive, cleanBank, cleanStatutory, cleanTax, dateOrNull, dateRequired, has, hasAny, need, needAny, oneOf, ownEmployee, recordEvent,
  requireOwnEmployee, stripSensitive, text, textOrNull, today, uuid, uuidOrNull, nonNegative, qx, seq,
} from "./common.js";

const EMPLOYMENT_TYPES = ["permanent", "contract", "intern", "consultant", "part_time", "temporary"];
const LIVE = ["active", "on_leave", "suspended", "on_notice"];
const DEFAULT_ONBOARDING = [
  { title: "Issue employee ID and email account", owner: "HR" },
  { title: "Collect signed offer and joining forms", owner: "HR" },
  { title: "Assign laptop and workstation", owner: "IT" },
  { title: "Induction with reporting manager", owner: "Manager" },
];
const DEFAULT_OFFBOARDING = [
  { title: "Return laptop and access cards", owner: "IT" },
  { title: "Knowledge transfer to successor", owner: "Manager" },
  { title: "Clear dues and advances", owner: "Finance" },
  { title: "Revoke system access", owner: "IT" },
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
  const off = checklist(input.offboardingChecklist, "The offboarding checklist");
  const { rows } = await qx(client, 
    `UPDATE tenant.hr_payroll_settings SET employee_number_prefix=$3, employee_number_padding=$4, default_probation_months=$5, default_notice_days=$6,
       require_documents_for_joining=$7, onboarding_checklist=$8::jsonb, offboarding_checklist=$9::jsonb,
       prohibit_self_approval=$10, attendance_grace_minutes=$11, updated_at=now()
     WHERE organization_id=$1 AND company_id=$2 RETURNING *`,
    [
      c.organizationId, c.companyId, prefix, num(input.employeeNumberPadding, cur.employee_number_padding, 3, 10, "Number padding"),
      num(input.defaultProbationMonths, cur.default_probation_months, 0, 24, "Default probation"), num(input.defaultNoticeDays, cur.default_notice_days, 0, 365, "Default notice period"),
      input.requireDocumentsForJoining === undefined ? cur.require_documents_for_joining : input.requireDocumentsForJoining === true,
      JSON.stringify(on ?? cur.onboarding_checklist), JSON.stringify(off ?? cur.offboarding_checklist),
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

// ---------------------------------------------------------------- document types
export async function listDocumentTypes(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_document_types WHERE organization_id=$1 AND company_id=$2 ORDER BY name`, [c.organizationId, c.companyId]);
  return rows;
}
export async function saveDocumentType(client, c, input) {
  need(c, "hr_payroll.settings.manage");
  const code = text(input.code, 40).toUpperCase();
  const name = text(input.name, 120);
  if (!/^[A-Z0-9_-]{2,40}$/.test(code)) throw new HrError(400, "Document type code must be 2 to 40 letters, digits, - or _.", "HR_DOCTYPE_INVALID");
  if (!name) throw new HrError(400, "Document type name is required.", "HR_DOCTYPE_INVALID");
  const flags = [input.requiredForJoining === true, input.expiryTracked === true, input.sensitive !== false, input.active !== false];
  if (input.id) {
    const { rows } = await qx(client, 
      `UPDATE tenant.hr_document_types SET name=$4, required_for_joining=$5, expiry_tracked=$6, sensitive=$7, active=$8 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
      [c.organizationId, c.companyId, uuid(input.id, "Document type"), name, ...flags],
    );
    if (!rows[0]) throw new HrError(404, "Document type was not found.", "HR_DOCTYPE_NOT_FOUND");
    return rows[0];
  }
  try {
    const { rows } = await qx(client, 
      `INSERT INTO tenant.hr_document_types(organization_id,company_id,code,name,required_for_joining,expiry_tracked,sensitive,active,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [c.organizationId, c.companyId, code, name, ...flags, c.userId],
    );
    return rows[0];
  } catch (e) {
    if (e.code === "23505") throw new HrError(409, `Document type ${code} already exists.`, "HR_DOCTYPE_DUPLICATE");
    throw e;
  }
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

const PLACEMENT = ["departmentId", "designationId", "managerEmployeeId", "branchId", "grade", "employmentType", "joiningDate"];
export async function updateEmployee(client, c, id, input) {
  need(c, "hr_payroll.employee.manage");
  const e = await loadEmployee(client, c, id, { lock: true });
  if (e.status === "separated") throw new HrError(409, "A separated employee's record is closed.", "HR_EMPLOYEE_CLOSED");
  const touchesPlacement = PLACEMENT.some((k) => input[k] !== undefined && String(input[k] ?? "") !== String({ departmentId: e.department_id, designationId: e.designation_id, managerEmployeeId: e.manager_employee_id, branchId: e.branch_id, grade: e.grade, employmentType: e.employment_type, joiningDate: String(e.joining_date).slice(0, 10) }[k] ?? ""));
  if (touchesPlacement && e.status !== "draft") {
    throw new HrError(409, "After joining, department, designation, manager, branch, grade and employment type change through a transfer or promotion that a second person approves.", "HR_USE_CHANGE_REQUEST");
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
  if (e.status === "draft") {
    if (input.departmentId !== undefined) { const v = uuidOrNull(input.departmentId, "Department"); await assertReferences(client, c, { departmentId: v }); add("department_id", v); }
    if (input.designationId !== undefined) { const v = uuidOrNull(input.designationId, "Designation"); await assertReferences(client, c, { designationId: v }); add("designation_id", v); }
    if (input.branchId !== undefined) { const v = uuidOrNull(input.branchId, "Branch"); await assertReferences(client, c, { branchId: v }); add("branch_id", v); }
    if (input.managerEmployeeId !== undefined) { const v = uuidOrNull(input.managerEmployeeId, "Reporting manager"); await assertReportingLine(client, c, e.id, v); add("manager_employee_id", v); }
    if (input.grade !== undefined) add("grade", textOrNull(input.grade, 30));
    if (input.employmentType !== undefined) add("employment_type", oneOf(String(input.employmentType), EMPLOYMENT_TYPES, "Employment type"));
    if (input.joiningDate !== undefined) add("joining_date", dateRequired(input.joiningDate, "Joining date"));
  }
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
  const items = (Array.isArray(list) && list.length ? list : kind === "onboarding" ? DEFAULT_ONBOARDING : DEFAULT_OFFBOARDING);
  for (const item of items) {
    await qx(client, 
      `INSERT INTO tenant.hr_lifecycle_tasks(organization_id,company_id,employee_id,kind,title,owner_label,mandatory,due_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [c.organizationId, c.companyId, employee.id, kind, item.title, item.owner || null, item.mandatory !== false, anchor],
    );
  }
}

// F389: joining. The employee record exists as a draft from the offer; joining verifies the
// mandatory documents, activates the record, starts probation and raises the onboarding checklist.
export async function completeJoining(client, c, id) {
  need(c, "hr_payroll.employee.manage");
  const e = await loadEmployee(client, c, id, { lock: true });
  if (e.status !== "draft") throw new HrError(409, "Only an employee who has not yet joined can be joined.", "HR_JOINING_STATE");
  const settings = await loadSettings(client, c);
  if (settings.require_documents_for_joining) {
    const missing = await qx(client, 
      `SELECT t.name FROM tenant.hr_document_types t
       WHERE t.organization_id=$1 AND t.company_id=$2 AND t.active AND t.required_for_joining
         AND NOT EXISTS (SELECT 1 FROM tenant.hr_employee_documents d WHERE d.employee_id=$3 AND d.document_type_id=t.id AND d.status='verified')`,
      [c.organizationId, c.companyId, e.id],
    );
    if (missing.rows.length) throw new HrError(409, `These documents must be verified before joining: ${missing.rows.map((r) => r.name).join(", ")}.`, "HR_JOINING_DOCUMENTS_MISSING");
  }
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
  const history = await qx(client, `SELECT * FROM tenant.hr_employee_changes WHERE organization_id=$1 AND employee_id=$2 ORDER BY effective_date DESC, created_at DESC`, [c.organizationId, e.id]);
  const documents = await qx(client, `SELECT d.id, d.title, d.file_name, d.status, d.expires_on, d.issued_on, t.name AS type_name FROM tenant.hr_employee_documents d JOIN tenant.hr_document_types t ON t.id=d.document_type_id WHERE d.organization_id=$1 AND d.employee_id=$2 AND d.status <> 'removed' ORDER BY d.created_at DESC`, [c.organizationId, e.id]);
  const tasks = await qx(client, `SELECT * FROM tenant.hr_lifecycle_tasks WHERE organization_id=$1 AND employee_id=$2 ORDER BY kind, created_at`, [c.organizationId, e.id]);
  const separation = await qx(client, `SELECT * FROM tenant.hr_separations WHERE organization_id=$1 AND employee_id=$2 ORDER BY created_at DESC LIMIT 1`, [c.organizationId, e.id]);
  return { ...stripSensitive(e, c, own?.id), ...names.rows[0], reportingChain: chain, directReports: reports.rows, changes: history.rows, documents: documents.rows, tasks: tasks.rows, separation: separation.rows[0] ?? null };
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

// ---------------------------------------------------------------- documents
export async function listEmployeeDocuments(client, c, filters = {}) {
  needAny(c, ["hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.employeeId) { params.push(uuid(filters.employeeId, "Employee")); extra += ` AND d.employee_id=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND d.status=$${params.length}`; }
  if (filters.expiringInDays) { params.push(Math.min(Math.max(Math.trunc(Number(filters.expiringInDays)) || 30, 1), 365)); extra += ` AND d.expires_on IS NOT NULL AND d.expires_on <= current_date + $${params.length}::int AND d.status <> 'removed'`; }
  const { rows } = await qx(client, 
    `SELECT d.*, t.name AS type_name, t.code AS type_code, ${NAMES} AS employee_name, e.employee_number
     FROM tenant.hr_employee_documents d JOIN tenant.hr_document_types t ON t.id=d.document_type_id JOIN tenant.hr_employees e ON e.id=d.employee_id
     WHERE d.organization_id=$1 AND d.company_id=$2 AND d.status <> 'removed'${extra} ORDER BY d.created_at DESC LIMIT 1000`,
    params,
  );
  return rows;
}
export async function addEmployeeDocument(client, c, input) {
  // HR adds for anyone; an employee may add to their own file (self-service)
  const own = await ownEmployee(client, c);
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  if (!(own && own.id === employeeId)) need(c, "hr_payroll.employee.manage");
  await loadEmployee(client, c, employeeId);
  const type = await qx(client, `SELECT * FROM tenant.hr_document_types WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND active`, [c.organizationId, c.companyId, uuid(input.documentTypeId, "Document type")]);
  if (!type.rows[0]) throw new HrError(400, "Document type was not found or is inactive.", "HR_DOCTYPE_NOT_FOUND");
  const reference = text(input.fileReference, 500);
  if (!reference) throw new HrError(400, "A file reference is required.", "HR_DOCUMENT_INVALID");
  const title = text(input.title, 200) || type.rows[0].name;
  const issued = dateOrNull(input.issuedOn, "Issue date");
  const expires = dateOrNull(input.expiresOn, "Expiry date");
  if (type.rows[0].expiry_tracked && !expires) throw new HrError(400, `${type.rows[0].name} needs an expiry date.`, "HR_DOCUMENT_EXPIRY_REQUIRED");
  if (issued && expires && expires < issued) throw new HrError(400, "The expiry date is before the issue date.", "HR_DOCUMENT_INVALID");
  const size = input.sizeBytes === undefined || input.sizeBytes === "" ? null : Math.trunc(nonNegative(input.sizeBytes, "File size"));
  const { rows } = await qx(client, 
    `INSERT INTO tenant.hr_employee_documents(organization_id,company_id,employee_id,document_type_id,title,file_reference,file_name,mime_type,size_bytes,issued_on,expires_on,uploaded_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
    [c.organizationId, c.companyId, employeeId, type.rows[0].id, title, reference, textOrNull(input.fileName, 200), textOrNull(input.mimeType, 100), size, issued, expires, c.userId],
  );
  await recordEvent(client, c, "employee", employeeId, "hr.document.added", { type: type.rows[0].code, documentId: rows[0].id });
  return rows[0];
}
export async function reviewEmployeeDocument(client, c, id, { verify, note }) {
  need(c, "hr_payroll.employee.manage");
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employee_documents WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Document")]);
  const d = rows[0];
  if (!d || d.status === "removed") throw new HrError(404, "Document was not found.", "HR_DOCUMENT_NOT_FOUND");
  if (d.status !== "submitted") throw new HrError(409, "Only a submitted document can be reviewed.", "HR_DOCUMENT_STATE");
  const emp = await qx(client, `SELECT user_id FROM tenant.hr_employees WHERE id=$1`, [d.employee_id]);
  if (emp.rows[0]?.user_id === c.userId) throw new HrError(403, "You cannot verify documents in your own file.", "HR_SELF_REVIEW_BLOCKED");
  if (!verify && !text(note)) throw new HrError(400, "Give a reason for rejecting the document.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_employee_documents SET status=$4, verified_by=$5, verified_at=now(), review_note=$6 WHERE organization_id=$1 AND company_id=$2 AND id=$3 RETURNING *`,
    [c.organizationId, c.companyId, d.id, verify ? "verified" : "rejected", c.userId, textOrNull(note)]);
  await recordEvent(client, c, "employee", d.employee_id, verify ? "hr.document.verified" : "hr.document.rejected", { documentId: d.id });
  return out.rows[0];
}
export async function removeEmployeeDocument(client, c, id) {
  need(c, "hr_payroll.employee.manage");
  const { rows } = await qx(client, `UPDATE tenant.hr_employee_documents SET status='removed' WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status <> 'removed' RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Document")]);
  if (!rows[0]) throw new HrError(404, "Document was not found.", "HR_DOCUMENT_NOT_FOUND");
  await recordEvent(client, c, "employee", rows[0].employee_id, "hr.document.removed", { documentId: id });
  return rows[0];
}

// ---------------------------------------------------------------- effective-dated changes
const CHANGE_FIELDS = {
  transfer: ["departmentId", "branchId", "managerEmployeeId", "workLocation"],
  promotion: ["designationId", "grade", "departmentId", "managerEmployeeId"],
  confirmation: [],
  probation_extension: ["probationEndDate"],
};
const COLUMN = { departmentId: "department_id", branchId: "branch_id", managerEmployeeId: "manager_employee_id", workLocation: "work_location", designationId: "designation_id", grade: "grade", probationEndDate: "probation_end_date" };

export async function proposeEmployeeChange(client, c, input) {
  need(c, "hr_payroll.employee.manage");
  const type = oneOf(String(input.changeType), Object.keys(CHANGE_FIELDS), "Change type");
  const e = await loadEmployee(client, c, input.employeeId, { lock: true });
  if (!LIVE.includes(e.status)) throw new HrError(409, "Only a current employee can be changed. Complete joining first.", "HR_CHANGE_STATE");
  if (e.status === "on_notice" && type !== "transfer") throw new HrError(409, "An employee serving notice can only be transferred.", "HR_CHANGE_STATE");
  const effective = dateRequired(input.effectiveDate, "Effective date");
  if (effective < String(e.joining_date).slice(0, 10)) throw new HrError(400, "The effective date is before the employee joined.", "HR_CHANGE_INVALID");
  const open = await qx(client, `SELECT 1 FROM tenant.hr_employee_changes WHERE organization_id=$1 AND employee_id=$2 AND change_type=$3 AND status IN ('pending_approval','approved')`, [c.organizationId, e.id, type]);
  if (open.rows[0]) throw new HrError(409, `There is already an open ${type.replace("_", " ")} for this employee.`, "HR_CHANGE_OPEN");
  const changes = {};
  for (const key of CHANGE_FIELDS[type]) if (input[key] !== undefined && input[key] !== "") changes[key] = key === "grade" || key === "workLocation" ? text(input[key], 120) : key === "probationEndDate" ? dateRequired(input[key], "New probation end date") : uuid(input[key], key);
  if (type === "confirmation") {
    if (e.probation_status === "confirmed" || e.probation_status === "not_applicable") throw new HrError(409, "This employee is not on probation.", "HR_CHANGE_STATE");
  } else if (!Object.keys(changes).length) {
    throw new HrError(400, "Say what is changing.", "HR_CHANGE_INVALID");
  }
  if (type === "probation_extension") {
    if (!["on_probation", "extended"].includes(e.probation_status)) throw new HrError(409, "This employee is not on probation.", "HR_CHANGE_STATE");
    if (changes.probationEndDate <= String(e.probation_end_date ?? e.joining_date).slice(0, 10)) throw new HrError(400, "The new probation end date must be later than the current one.", "HR_CHANGE_INVALID");
  }
  if (type === "promotion" && changes.designationId && changes.designationId === e.designation_id && !changes.grade) throw new HrError(400, "A promotion changes the designation or grade.", "HR_CHANGE_INVALID");
  await assertReferences(client, c, { departmentId: changes.departmentId, designationId: changes.designationId, branchId: changes.branchId });
  if (changes.managerEmployeeId) await assertReportingLine(client, c, e.id, changes.managerEmployeeId);
  if (type === "promotion" && input.proposedAnnualCtc !== undefined && input.proposedAnnualCtc !== "") nonNegative(input.proposedAnnualCtc, "Proposed CTC");
  const snapshot = { departmentId: e.department_id, designationId: e.designation_id, managerEmployeeId: e.manager_employee_id, branchId: e.branch_id, grade: e.grade, workLocation: e.work_location, probationEndDate: e.probation_end_date ? String(e.probation_end_date).slice(0, 10) : null };
  const { rows } = await qx(client, 
    `INSERT INTO tenant.hr_employee_changes(organization_id,company_id,employee_id,change_type,effective_date,changes,before_snapshot,proposed_annual_ctc,reason,requested_by)
     VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9,$10) RETURNING *`,
    [c.organizationId, c.companyId, e.id, type, effective, JSON.stringify(changes), JSON.stringify(snapshot), type === "promotion" && input.proposedAnnualCtc ? Number(input.proposedAnnualCtc) : null, textOrNull(input.reason), c.userId],
  );
  await recordEvent(client, c, "employee", e.id, `hr.${type}.requested`, { changeId: rows[0].id, effective });
  return rows[0];
}

async function applyChangeRow(client, c, change) {
  const e = await loadEmployee(client, c, change.employee_id, { lock: true });
  if (!LIVE.includes(e.status)) {
    await qx(client, `UPDATE tenant.hr_employee_changes SET status='cancelled', decision_note=coalesce(decision_note,'') || ' [employee left before the effective date]' WHERE id=$1`, [change.id]);
    return null;
  }
  const set = [];
  const params = [c.organizationId, e.id];
  for (const [key, value] of Object.entries(change.changes)) {
    if (key === "managerEmployeeId") await assertReportingLine(client, c, e.id, value);
    params.push(value);
    set.push(`${COLUMN[key]}=$${params.length}`);
  }
  if (change.change_type === "confirmation") {
    params.push(change.effective_date);
    set.push(`probation_status='confirmed'`, `confirmation_date=$${params.length}`);
  }
  if (change.change_type === "probation_extension") set.push(`probation_status='extended'`);
  await qx(client, `UPDATE tenant.hr_employees SET ${set.join(", ")}, updated_at=now() WHERE organization_id=$1 AND id=$2`, params);
  await qx(client, `UPDATE tenant.hr_employee_changes SET status='applied', applied_at=now() WHERE id=$1`, [change.id]);
  await recordEvent(client, c, "employee", e.id, `hr.${change.change_type}.applied`, { changeId: change.id, changes: change.changes });
  return change.id;
}

export async function decideEmployeeChange(client, c, id, { approve, note }) {
  need(c, "hr_payroll.employee.manage");
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employee_changes WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Change")]);
  const ch = rows[0];
  if (!ch) throw new HrError(404, "Change was not found.", "HR_CHANGE_NOT_FOUND");
  if (ch.status !== "pending_approval") throw new HrError(409, "Only a pending change can be decided.", "HR_CHANGE_STATE");
  if (ch.requested_by === c.userId) throw new HrError(403, "A change must be approved by someone other than the person who requested it.", "SELF_APPROVAL_BLOCKED");
  const subject = await qx(client, `SELECT user_id FROM tenant.hr_employees WHERE id=$1`, [ch.employee_id]);
  if (subject.rows[0]?.user_id === c.userId) throw new HrError(403, "You cannot decide a change to your own record.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting the change.", "HR_REASON_REQUIRED");
  await qx(client, `UPDATE tenant.hr_employee_changes SET status=$4, decided_by=$5, decided_at=now(), decision_note=$6 WHERE organization_id=$1 AND company_id=$2 AND id=$3`,
    [c.organizationId, c.companyId, ch.id, approve ? "approved" : "rejected", c.userId, textOrNull(note)]);
  await recordEvent(client, c, "employee", ch.employee_id, approve ? `hr.${ch.change_type}.approved` : `hr.${ch.change_type}.rejected`, { changeId: ch.id });
  if (approve && String(ch.effective_date).slice(0, 10) <= today()) await applyChangeRow(client, c, { ...ch, status: "approved" });
  return (await qx(client, `SELECT * FROM tenant.hr_employee_changes WHERE id=$1`, [ch.id])).rows[0];
}

// Approved changes whose effective date has arrived take effect (run from the screen or a schedule).
export async function applyDueEmployeeChanges(client, c) {
  need(c, "hr_payroll.employee.manage");
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_employee_changes WHERE organization_id=$1 AND company_id=$2 AND status='approved' AND effective_date <= current_date FOR UPDATE`, [c.organizationId, c.companyId]);
  const applied = [];
  for (const ch of rows) {
    const id = await applyChangeRow(client, c, ch);
    if (id) applied.push(id);
  }
  return { applied: applied.length, ids: applied };
}

export async function cancelEmployeeChange(client, c, id, reason) {
  need(c, "hr_payroll.employee.manage");
  if (!text(reason)) throw new HrError(400, "Give a reason for cancelling.", "HR_REASON_REQUIRED");
  const { rows } = await qx(client, `UPDATE tenant.hr_employee_changes SET status='cancelled', decision_note=$4, decided_by=$5, decided_at=now() WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status IN ('pending_approval','approved') RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Change"), text(reason), c.userId]);
  if (!rows[0]) throw new HrError(409, "Only a pending or approved change can be cancelled.", "HR_CHANGE_STATE");
  return rows[0];
}

export async function listEmployeeChanges(client, c, filters = {}) {
  needAny(c, ["hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.type) { params.push(String(filters.type)); extra += ` AND ch.change_type=$${params.length}`; }
  if (filters.status) { params.push(String(filters.status)); extra += ` AND ch.status=$${params.length}`; }
  const { rows } = await qx(client, 
    `SELECT ch.*, ${NAMES} AS employee_name, e.employee_number FROM tenant.hr_employee_changes ch JOIN tenant.hr_employees e ON e.id=ch.employee_id
     WHERE ch.organization_id=$1 AND ch.company_id=$2${extra} ORDER BY ch.created_at DESC LIMIT 500`, params);
  return rows;
}

// Probation register: everyone on probation, soonest end first, flagged when due.
export async function listProbation(client, c) {
  needAny(c, ["hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const { rows } = await qx(client, 
    `SELECT e.id, e.employee_number, ${NAMES} AS full_name, e.probation_status, e.probation_end_date, e.joining_date, d.name AS department_name,
       (e.probation_end_date - current_date) AS days_left,
       EXISTS (SELECT 1 FROM tenant.hr_employee_changes ch WHERE ch.employee_id=e.id AND ch.change_type='confirmation' AND ch.status IN ('pending_approval','approved')) AS confirmation_pending
     FROM tenant.hr_employees e LEFT JOIN tenant.hr_departments d ON d.id=e.department_id
     WHERE e.organization_id=$1 AND e.company_id=$2 AND e.probation_status IN ('on_probation','extended') AND e.status = ANY($3::text[]) ORDER BY e.probation_end_date NULLS LAST`,
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

// ---------------------------------------------------------------- separation and offboarding
export async function listSeparations(client, c, filters = {}) {
  needAny(c, ["hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra += ` AND s.status=$${params.length}`; }
  const { rows } = await qx(client, 
    `SELECT s.*, ${NAMES} AS employee_name, e.employee_number, d.name AS department_name,
       (SELECT count(*) FROM tenant.hr_lifecycle_tasks t WHERE t.employee_id=s.employee_id AND t.kind='offboarding' AND t.status='open' AND t.mandatory)::int AS open_tasks
     FROM tenant.hr_separations s JOIN tenant.hr_employees e ON e.id=s.employee_id LEFT JOIN tenant.hr_departments d ON d.id=e.department_id
     WHERE s.organization_id=$1 AND s.company_id=$2${extra} ORDER BY s.created_at DESC LIMIT 500`, params);
  return rows;
}

export async function initiateSeparation(client, c, input) {
  const own = await ownEmployee(client, c);
  const isHr = has(c, "hr_payroll.employee.manage");
  const employeeId = uuid(input.employeeId ?? own?.id, "Employee");
  const type = oneOf(String(input.separationType ?? "resignation"), ["resignation", "termination", "retirement", "end_of_contract", "absconding", "death"], "Separation type");
  if (!isHr) {
    if (!(own && own.id === employeeId && type === "resignation")) throw new HrError(403, "You can only submit your own resignation.", "HR_FORBIDDEN");
  }
  const e = await loadEmployee(client, c, employeeId, { lock: true });
  if (!["active", "on_leave", "suspended"].includes(e.status)) throw new HrError(409, e.status === "on_notice" ? "This employee is already serving notice." : "Only a current employee can separate.", "HR_SEPARATION_STATE");
  const noticeDate = dateOrNull(input.noticeDate, "Notice date") ?? today();
  const requested = dateOrNull(input.requestedLastDay, "Requested last working day") ?? addDays(noticeDate, e.notice_period_days);
  if (requested < noticeDate) throw new HrError(400, "The last working day cannot be before the notice date.", "HR_SEPARATION_INVALID");
  if (type === "resignation" && !text(input.reason)) throw new HrError(400, "Please give a reason for resigning.", "HR_REASON_REQUIRED");
  try {
    const { rows } = await qx(client, 
      `INSERT INTO tenant.hr_separations(organization_id,company_id,employee_id,separation_type,notice_date,requested_last_day,reason,initiated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [c.organizationId, c.companyId, e.id, type, noticeDate, requested, textOrNull(input.reason, 1000), c.userId],
    );
    await recordEvent(client, c, "employee", e.id, "hr.separation.submitted", { separationId: rows[0].id, type });
    return rows[0];
  } catch (err) {
    if (err.code === "23505") throw new HrError(409, "There is already an open separation for this employee.", "HR_SEPARATION_OPEN");
    throw err;
  }
}

export async function decideSeparation(client, c, id, { approve, note, lastWorkingDay }) {
  need(c, "hr_payroll.employee.manage");
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_separations WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Separation")]);
  const s = rows[0];
  if (!s) throw new HrError(404, "Separation was not found.", "HR_SEPARATION_NOT_FOUND");
  if (s.status !== "submitted") throw new HrError(409, "Only a submitted separation can be decided.", "HR_SEPARATION_STATE");
  const e = await loadEmployee(client, c, s.employee_id, { lock: true });
  if (e.user_id === c.userId) throw new HrError(403, "You cannot decide your own separation.", "SELF_APPROVAL_BLOCKED");
  if (!approve) {
    if (!text(note)) throw new HrError(400, "Give a reason for rejecting the separation.", "HR_REASON_REQUIRED");
    const out = await qx(client, `UPDATE tenant.hr_separations SET status='rejected', decided_by=$2, decided_at=now(), decision_note=$3 WHERE id=$1 RETURNING *`, [s.id, c.userId, text(note)]);
    await recordEvent(client, c, "employee", e.id, "hr.separation.rejected", { separationId: s.id });
    return out.rows[0];
  }
  const lwd = dateOrNull(lastWorkingDay, "Last working day") ?? (s.requested_last_day ? String(s.requested_last_day).slice(0, 10) : addDays(String(s.notice_date).slice(0, 10), e.notice_period_days));
  if (lwd < String(s.notice_date).slice(0, 10)) throw new HrError(400, "The last working day cannot be before the notice date.", "HR_SEPARATION_INVALID");
  const out = await qx(client, `UPDATE tenant.hr_separations SET status='accepted', last_working_day=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 RETURNING *`, [s.id, lwd, c.userId, textOrNull(note)]);
  await qx(client, `UPDATE tenant.hr_employees SET status='on_notice', last_working_date=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, e.id, lwd]);
  const settings = await loadSettings(client, c);
  await makeTasks(client, c, e, "offboarding", settings.offboarding_checklist, lwd);
  await recordEvent(client, c, "employee", e.id, "hr.separation.accepted", { separationId: s.id, lastWorkingDay: lwd });
  return out.rows[0];
}

export async function withdrawSeparation(client, c, id, reason) {
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_separations WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Separation")]);
  const s = rows[0];
  if (!s) throw new HrError(404, "Separation was not found.", "HR_SEPARATION_NOT_FOUND");
  if (!(s.initiated_by === c.userId || has(c, "hr_payroll.employee.manage"))) throw new HrError(403, "You do not have permission to perform this HR operation.", "HR_FORBIDDEN");
  if (!["submitted", "accepted"].includes(s.status)) throw new HrError(409, "Only an open separation can be withdrawn.", "HR_SEPARATION_STATE");
  if (!text(reason)) throw new HrError(400, "Give a reason for withdrawing.", "HR_REASON_REQUIRED");
  const out = await qx(client, `UPDATE tenant.hr_separations SET status='withdrawn', decision_note=$2 WHERE id=$1 RETURNING *`, [s.id, text(reason)]);
  if (s.status === "accepted") {
    await qx(client, `UPDATE tenant.hr_employees SET status='active', last_working_date=NULL, updated_at=now() WHERE organization_id=$1 AND id=$2 AND status='on_notice'`, [c.organizationId, s.employee_id]);
    await qx(client, `UPDATE tenant.hr_lifecycle_tasks SET status='waived', note='Separation withdrawn', completed_at=now(), completed_by=$3 WHERE organization_id=$1 AND employee_id=$2 AND kind='offboarding' AND status='open'`, [c.organizationId, s.employee_id, c.userId]);
  }
  await recordEvent(client, c, "employee", s.employee_id, "hr.separation.withdrawn", { separationId: s.id });
  return out.rows[0];
}

export async function recordExitInterview(client, c, id, input) {
  need(c, "hr_payroll.employee.manage");
  const interview = { reasonCategory: text(input.reasonCategory, 60), feedback: text(input.feedback, 2000), wouldRejoin: input.wouldRejoin === true, conductedOn: dateOrNull(input.conductedOn, "Interview date") ?? today(), conductedBy: c.userId };
  const { rows } = await qx(client, `UPDATE tenant.hr_separations SET exit_interview=$4::jsonb WHERE organization_id=$1 AND company_id=$2 AND id=$3 AND status IN ('accepted','completed') RETURNING *`, [c.organizationId, c.companyId, uuid(id, "Separation"), JSON.stringify(interview)]);
  if (!rows[0]) throw new HrError(409, "An exit interview is recorded once the separation is accepted.", "HR_SEPARATION_STATE");
  return rows[0];
}

export async function completeSeparation(client, c, id, input = {}) {
  need(c, "hr_payroll.employee.manage");
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_separations WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Separation")]);
  const s = rows[0];
  if (!s) throw new HrError(404, "Separation was not found.", "HR_SEPARATION_NOT_FOUND");
  if (s.status !== "accepted") throw new HrError(409, "Only an accepted separation can be completed.", "HR_SEPARATION_STATE");
  const e = await loadEmployee(client, c, s.employee_id, { lock: true });
  if (e.user_id === c.userId) throw new HrError(403, "You cannot complete your own separation.", "SELF_APPROVAL_BLOCKED");
  const lwd = String(s.last_working_day).slice(0, 10);
  if (lwd > today()) throw new HrError(409, `The last working day is ${lwd}. Complete the separation on or after that day.`, "HR_SEPARATION_NOT_DUE");
  const open = await qx(client, `SELECT title FROM tenant.hr_lifecycle_tasks WHERE organization_id=$1 AND employee_id=$2 AND kind='offboarding' AND mandatory AND status='open'`, [c.organizationId, e.id]);
  if (open.rows.length) throw new HrError(409, `Clear the offboarding checklist first: ${open.rows.map((r) => r.title).join("; ")}.`, "HR_OFFBOARDING_OPEN");
  const reports = await qx(client, `SELECT id FROM tenant.hr_employees WHERE organization_id=$1 AND manager_employee_id=$2 AND status <> 'separated'`, [c.organizationId, e.id]);
  if (reports.rows.length) {
    const to = uuidOrNull(input.reassignReportsTo, "New manager for the direct reports");
    if (!to) throw new HrError(409, `${reports.rows.length} employee(s) report to this person. Choose who they report to now.`, "HR_REPORTS_REASSIGN");
    if (to === e.id) throw new HrError(400, "Choose someone else.", "HR_MANAGER_INVALID");
    for (const r of reports.rows) await assertReportingLine(client, c, r.id, to);
    await qx(client, `UPDATE tenant.hr_employees SET manager_employee_id=$3, updated_at=now() WHERE organization_id=$1 AND manager_employee_id=$2 AND status <> 'separated'`, [c.organizationId, e.id, to]);
  }
  await qx(client, `UPDATE tenant.hr_departments SET manager_employee_id=NULL WHERE organization_id=$1 AND manager_employee_id=$2`, [c.organizationId, e.id]);
  await qx(client, `UPDATE tenant.hr_employees SET status='separated', separation_date=$3, last_working_date=$3, updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, e.id, lwd]);
  await qx(client, `UPDATE tenant.hr_employee_changes SET status='cancelled', decision_note='Employee separated' WHERE organization_id=$1 AND employee_id=$2 AND status IN ('pending_approval','approved')`, [c.organizationId, e.id]);
  const out = await qx(client, `UPDATE tenant.hr_separations SET status='completed', completed_by=$2, completed_at=now() WHERE id=$1 RETURNING *`, [s.id, c.userId]);
  await recordEvent(client, c, "employee", e.id, "hr.separation.completed", { separationId: s.id, lastWorkingDay: lwd });
  return out.rows[0];
}

// ---------------------------------------------------------------- employee self-service
export async function getMyProfile(client, c) {
  const me = await requireOwnEmployee(client, c);
  const profile = await getEmployee(client, c, me.id);
  const pending = await qx(client, `SELECT * FROM tenant.hr_profile_change_requests WHERE organization_id=$1 AND employee_id=$2 ORDER BY created_at DESC LIMIT 20`, [c.organizationId, me.id]);
  return { ...profile, profileChangeRequests: pending.rows };
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

// Bank, tax and statutory identifiers drive pay, so a change is requested here and applied only
// after HR (a different person) approves it.
export async function requestProfileChange(client, c, input) {
  const me = await requireOwnEmployee(client, c);
  const group = oneOf(String(input.fieldGroup), ["bank_details", "tax_identifiers", "statutory_identifiers"], "Field group");
  const payload = group === "bank_details" ? cleanBank(input.payload) : group === "tax_identifiers" ? cleanTax(input.payload) : cleanStatutory(input.payload);
  if (!Object.keys(payload).length) throw new HrError(400, "Nothing to change.", "HR_PROFILE_CHANGE_INVALID");
  const dup = await qx(client, `SELECT 1 FROM tenant.hr_profile_change_requests WHERE organization_id=$1 AND employee_id=$2 AND field_group=$3 AND status='pending'`, [c.organizationId, me.id, group]);
  if (dup.rows[0]) throw new HrError(409, "You already have a pending request for this.", "HR_PROFILE_CHANGE_OPEN");
  const { rows } = await qx(client, `INSERT INTO tenant.hr_profile_change_requests(organization_id,company_id,employee_id,field_group,payload,requested_by) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
    [c.organizationId, c.companyId, me.id, group, JSON.stringify(payload), c.userId]);
  await recordEvent(client, c, "employee", me.id, "hr.ess.change_requested", { group });
  return rows[0];
}
export async function listProfileChangeRequests(client, c, filters = {}) {
  need(c, "hr_payroll.employee.manage");
  if (!canSeeSensitive(c)) throw new HrError(403, "Reviewing bank and tax changes needs the sensitive-data permission.", "HR_SENSITIVE_FORBIDDEN");
  const params = [c.organizationId, c.companyId];
  let extra = "";
  if (filters.status) { params.push(String(filters.status)); extra = ` AND r.status=$3`; }
  const { rows } = await qx(client, `SELECT r.*, ${NAMES} AS employee_name, e.employee_number FROM tenant.hr_profile_change_requests r JOIN tenant.hr_employees e ON e.id=r.employee_id WHERE r.organization_id=$1 AND r.company_id=$2${extra} ORDER BY r.created_at DESC LIMIT 500`, params);
  return rows;
}
export async function decideProfileChange(client, c, id, { approve, note }) {
  need(c, "hr_payroll.employee.manage");
  if (!canSeeSensitive(c)) throw new HrError(403, "Reviewing bank and tax changes needs the sensitive-data permission.", "HR_SENSITIVE_FORBIDDEN");
  const { rows } = await qx(client, `SELECT * FROM tenant.hr_profile_change_requests WHERE organization_id=$1 AND company_id=$2 AND id=$3 FOR UPDATE`, [c.organizationId, c.companyId, uuid(id, "Request")]);
  const r = rows[0];
  if (!r) throw new HrError(404, "Request was not found.", "HR_PROFILE_CHANGE_NOT_FOUND");
  if (r.status !== "pending") throw new HrError(409, "That request has already been decided.", "HR_PROFILE_CHANGE_STATE");
  if (r.requested_by === c.userId) throw new HrError(403, "You cannot approve your own change.", "SELF_APPROVAL_BLOCKED");
  if (!approve && !text(note)) throw new HrError(400, "Give a reason for rejecting.", "HR_REASON_REQUIRED");
  if (approve) {
    if (r.field_group === "tax_identifiers" && r.payload.pan) {
      const dup = await qx(client, `SELECT employee_number FROM tenant.hr_employees WHERE organization_id=$1 AND tax_identifiers->>'pan'=$2 AND status <> 'separated' AND id <> $3 LIMIT 1`, [c.organizationId, r.payload.pan, r.employee_id]);
      if (dup.rows[0]) throw new HrError(409, `PAN ${r.payload.pan} already belongs to employee ${dup.rows[0].employee_number}.`, "HR_PAN_DUPLICATE");
    }
    await qx(client, `UPDATE tenant.hr_employees SET ${r.field_group}=${r.field_group} || $3::jsonb, updated_at=now() WHERE organization_id=$1 AND id=$2`, [c.organizationId, r.employee_id, JSON.stringify(r.payload)]);
  }
  const out = await qx(client, `UPDATE tenant.hr_profile_change_requests SET status=$2, decided_by=$3, decided_at=now(), decision_note=$4 WHERE id=$1 RETURNING *`, [r.id, approve ? "approved" : "rejected", c.userId, textOrNull(note)]);
  await recordEvent(client, c, "employee", r.employee_id, approve ? "hr.ess.change_approved" : "hr.ess.change_rejected", { group: r.field_group });
  return out.rows[0];
}

// ---------------------------------------------------------------- dashboard and reports
export async function getWorkforceDashboard(client, c) {
  needAny(c, ["hr_payroll.view", "hr_payroll.employee.view", "hr_payroll.employee.manage"]);
  const [byStatus, probation, docs, changes, tasks, separations, byDept, byType] = await seq([
    () => qx(client, `SELECT status, count(*)::int AS n FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 GROUP BY status`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS n FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND probation_status IN ('on_probation','extended') AND probation_end_date <= current_date + 30 AND status = ANY($3::text[])`, [c.organizationId, c.companyId, LIVE]),
    () => qx(client, `SELECT count(*)::int AS n FROM tenant.hr_employee_documents WHERE organization_id=$1 AND company_id=$2 AND status <> 'removed' AND expires_on IS NOT NULL AND expires_on <= current_date + 30`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS n FROM tenant.hr_employee_changes WHERE organization_id=$1 AND company_id=$2 AND status='pending_approval'`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS n FROM tenant.hr_lifecycle_tasks WHERE organization_id=$1 AND company_id=$2 AND status='open' AND due_date < current_date`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT count(*)::int AS n FROM tenant.hr_separations WHERE organization_id=$1 AND company_id=$2 AND status IN ('submitted','accepted')`, [c.organizationId, c.companyId]),
    () => qx(client, `SELECT coalesce(d.name,'Unassigned') AS name, count(*)::int AS n FROM tenant.hr_employees e LEFT JOIN tenant.hr_departments d ON d.id=e.department_id WHERE e.organization_id=$1 AND e.company_id=$2 AND e.status = ANY($3::text[]) GROUP BY 1 ORDER BY n DESC LIMIT 12`, [c.organizationId, c.companyId, LIVE]),
    () => qx(client, `SELECT employment_type, count(*)::int AS n FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND status = ANY($3::text[]) GROUP BY 1 ORDER BY n DESC`, [c.organizationId, c.companyId, LIVE]),
  ]);
  const status = Object.fromEntries(byStatus.rows.map((r) => [r.status, r.n]));
  const headcount = LIVE.reduce((sum, s) => sum + (status[s] ?? 0), 0);
  return { headcount, status, probationEnding: probation.rows[0].n, documentsExpiring: docs.rows[0].n, pendingChanges: changes.rows[0].n, overdueTasks: tasks.rows[0].n, openSeparations: separations.rows[0].n, byDepartment: byDept.rows, byEmploymentType: byType.rows };
}

// Attrition over a trailing window: leavers / average headcount.
export async function getAttritionReport(client, c, { months = 12 } = {}) {
  need(c, "hr_payroll.reports.view");
  const m = Math.min(Math.max(Math.trunc(Number(months)) || 12, 1), 60);
  const { rows } = await qx(client, 
    `SELECT
       (SELECT count(*) FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND separation_date > current_date - ($3::int * 30) AND status='separated')::int AS leavers,
       (SELECT count(*) FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND joining_date <= current_date - ($3::int * 30) AND (separation_date IS NULL OR separation_date > current_date - ($3::int * 30)) AND status <> 'draft')::int AS opening,
       (SELECT count(*) FROM tenant.hr_employees WHERE organization_id=$1 AND company_id=$2 AND status = ANY($4::text[]))::int AS closing`,
    [c.organizationId, c.companyId, m, LIVE],
  );
  const { leavers, opening, closing } = rows[0];
  const average = (opening + closing) / 2;
  const byType = await qx(client, `SELECT s.separation_type, count(*)::int AS n FROM tenant.hr_separations s WHERE s.organization_id=$1 AND s.company_id=$2 AND s.status='completed' AND s.completed_at > now() - ($3::int * interval '30 days') GROUP BY 1`, [c.organizationId, c.companyId, m]);
  return { months: m, leavers, openingHeadcount: opening, closingHeadcount: closing, attritionPercent: average > 0 ? Math.round((leavers / average) * 10000) / 100 : 0, byType: byType.rows };
}
