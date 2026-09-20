"use client";

import { act, type Row } from "@/features/hr/shared/client";
import type { RegisterConfig, RowAction } from "@/features/hr/shared/Register";
import { badge, calendarDate, col, dateTime, label, opts, quantity, strong, text } from "@/features/hr/configs";

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : undefined);
const mins = (v: unknown) => (Number(v) > 0 ? `${Math.floor(Number(v) / 60)}h ${Number(v) % 60}m` : "—");
const hhmm = (v: unknown) => String(v ?? "").slice(0, 5);
const clock = (v: unknown) => (v ? new Date(String(v)).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }) : "—");
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const days = (list: unknown) => ((list as number[]) ?? []).map((d) => WEEKDAYS[d - 1]).join(" ");

const shifts: RegisterConfig = {
  key: "shifts",
  title: "Shifts",
  description: "Working hours. An overnight shift ends after midnight. Grace minutes forgive a short delay before a check-in counts as late.",
  searchLabel: "Search shifts",
  emptyTitle: "No shifts yet",
  emptyDescription: "Add a shift, then assign it to employees.",
  source: { kind: "view", view: "shifts" },
  createLabel: "New shift",
  createPermission: "hr_payroll.shift.manage",
  save: { action: "shift-save", success: "Shift saved.", transform: (v) => ({ workingDays: String(v.workingDays || "1,2,3,4,5").split(",").map((d) => Number(d.trim())).filter(Boolean) }) },
  edit: { action: "shift-save", permission: "hr_payroll.shift.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "startTime", label: "Starts (HH:MM)", kind: "text", required: true, defaultValue: "09:00", rowKey: "start_time" },
    { name: "endTime", label: "Ends (HH:MM)", kind: "text", required: true, defaultValue: "18:00", rowKey: "end_time" },
    { name: "breakMinutes", label: "Break (minutes)", kind: "number", step: 5, rowKey: "break_minutes" },
    { name: "graceMinutes", label: "Grace (minutes)", kind: "number", step: 5, rowKey: "grace_minutes" },
    { name: "overnight", label: "Overnight shift", kind: "bool", defaultValue: "false" },
    { name: "workingDays", label: "Working days (1=Mon … 7=Sun)", kind: "text", defaultValue: "1,2,3,4,5" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("time", "Hours", (r) => `${hhmm(r.start_time)} – ${hhmm(r.end_time)}${r.overnight ? " (overnight)" : ""}`),
    col("break", "Break", (r) => `${r.break_minutes} min`),
    col("grace", "Grace", (r) => `${r.grace_minutes} min`),
    col("days", "Working days", (r) => days(r.working_days)),
    col("assigned", "Assigned", (r) => String(r.assigned)),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name"]),
};

const shiftAssignments: RegisterConfig = {
  key: "shift-assignments",
  title: "Shift assignments",
  description: "Which shift each employee works, from a date. A new assignment ends the previous open-ended one the day before it starts.",
  searchLabel: "Search assignments",
  emptyTitle: "No shift assignments",
  emptyDescription: "Assign a shift to an employee.",
  source: { kind: "view", view: "shift-assignments" },
  createLabel: "Assign shift",
  createPermission: "hr_payroll.shift.manage",
  save: { action: "shift-assign", success: "Shift assigned." },
  fields: [
    { name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true },
    { name: "shiftId", label: "Shift", kind: "select", options: "shifts", required: true },
    { name: "effectiveFrom", label: "From", kind: "date", required: true },
    { name: "effectiveTo", label: "To (optional)", kind: "date" },
  ],
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("shift", "Shift", (r) => `${r.shift_name} (${r.shift_code})`),
    col("hours", "Hours", (r) => `${hhmm(r.start_time)} – ${hhmm(r.end_time)}`),
    col("from", "From", (r) => calendarDate(r.effective_from)),
    col("to", "To", (r) => (r.effective_to ? calendarDate(r.effective_to) : "Open")),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number", "shift_code"]),
};

const holidayCalendars: RegisterConfig = {
  key: "holiday-calendars",
  title: "Holiday calendars",
  description: "Public holidays are paid days off. One calendar is the default for everyone; an employee can be given another.",
  searchLabel: "Search calendars",
  emptyTitle: "No holiday calendars",
  emptyDescription: "Add a calendar, then its holidays.",
  source: { kind: "view", view: "holiday-calendars" },
  createLabel: "New calendar",
  createPermission: "hr_payroll.settings.manage",
  save: { action: "holiday-calendar-save", success: "Calendar saved." },
  edit: { action: "holiday-calendar-save", permission: "hr_payroll.settings.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "isDefault", label: "Default for everyone", kind: "bool", defaultValue: "false", rowKey: "is_default" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [strong("code", "Code", (r) => String(r.code)), col("name", "Name", (r) => String(r.name)), col("default", "Default", (r) => (r.is_default ? "Yes" : "")), col("holidays", "Holidays", (r) => String(r.holidays)), col("employees", "Employees on it", (r) => String(r.employees)), badge("status", "Status", (r) => (r.active ? "active" : "inactive"))],
  searchText: (r) => text(r, ["code", "name"]),
  rowActions: [
    {
      label: "Add holiday",
      permission: "hr_payroll.settings.manage",
      fields: [{ name: "holidayDate", label: "Date", kind: "date", required: true }, { name: "name", label: "Name", kind: "text", required: true }, { name: "holidayType", label: "Type", kind: "select", defaultValue: "public", options: opts("public", "optional", "restricted") }],
      run: (r, _note, v) => act("holiday-add", { calendarId: r.id, holidayDate: v.holidayDate, name: v.name, holidayType: v.holidayType }),
      success: "Holiday added.",
    },
  ],
};

const holidays: RegisterConfig = {
  key: "holidays",
  title: "Holidays",
  description: "The dates in each calendar. Only public holidays are paid days off; optional and restricted holidays are recorded for reference.",
  searchLabel: "Search holidays",
  emptyTitle: "No holidays yet",
  emptyDescription: "Add holidays to a calendar.",
  source: { kind: "view", view: "holidays" },
  createLabel: "Add holiday",
  createPermission: "hr_payroll.settings.manage",
  save: { action: "holiday-add", success: "Holiday added." },
  fields: [
    { name: "calendarId", label: "Calendar", kind: "select", options: "holidayCalendars", required: true },
    { name: "holidayDate", label: "Date", kind: "date", required: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "holidayType", label: "Type", kind: "select", defaultValue: "public", options: opts("public", "optional", "restricted") },
  ],
  columns: () => [col("date", "Date", (r) => calendarDate(r.holiday_date)), col("name", "Holiday", (r) => String(r.name)), col("type", "Type", (r) => label(r.holiday_type)), col("cal", "Calendar", (r) => `${r.calendar_name} (${r.calendar_code})`)],
  searchText: (r) => text(r, ["name", "calendar_name", "holiday_type"]),
  rowActions: [{ label: "Remove", permission: "hr_payroll.settings.manage", run: (r) => act("holiday-remove", { id: r.id }), success: "Holiday removed." }],
};

const attendanceColumns = () => [
  col("date", "Date", (r) => calendarDate(r.attendance_date)),
  col("employee", "Employee", (r) => `${r.employee_name ?? ""} ${r.employee_number ? `(${r.employee_number})` : ""}`.trim()),
  col("shift", "Shift", (r) => String(r.shift_code ?? "—")),
  badge("status", "Status", (r) => r.status),
  col("in", "In", (r) => clock(r.check_in_at)),
  col("out", "Out", (r) => clock(r.check_out_at)),
  col("worked", "Worked", (r) => mins(r.worked_minutes)),
  col("late", "Late", (r) => (Number(r.late_minutes) > 0 ? `${r.late_minutes} min` : "—")),
  col("early", "Early exit", (r) => (Number(r.early_exit_minutes) > 0 ? `${r.early_exit_minutes} min` : "—")),
  col("ot", "Overtime", (r) => mins(r.overtime_minutes)),
  col("source", "Source", (r) => label(r.source)),
];

const attendance: RegisterConfig = {
  key: "attendance",
  title: "Attendance",
  description: "The daily record for everyone, built from check-ins and check-outs against the shift. The last 30 days are shown.",
  searchLabel: "Search attendance",
  emptyTitle: "No attendance recorded",
  emptyDescription: "Attendance appears once people check in, or when you record it by hand.",
  source: { kind: "view", view: "attendance" },
  filters: [{ name: "status", label: "Status", options: opts("present", "absent", "half_day", "leave", "holiday", "weekly_off", "remote") }, { name: "flag", label: "Flag", options: [{ value: "late", label: "Late arrivals" }, { value: "early", label: "Early exits" }] }],
  createLabel: "Record attendance",
  createPermission: "hr_payroll.attendance.manage",
  save: { action: "attendance-record", success: "Attendance recorded.", transform: (v) => ({ checkIn: iso(v.checkIn), checkOut: iso(v.checkOut) }) },
  fields: [
    { name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true },
    { name: "attendanceDate", label: "Date", kind: "date", required: true },
    { name: "status", label: "Status", kind: "select", defaultValue: "present", options: opts("present", "absent", "half_day", "remote", "holiday", "weekly_off"), required: true },
    { name: "checkIn", label: "Check-in", kind: "datetime" },
    { name: "checkOut", label: "Check-out", kind: "datetime" },
    { name: "reason", label: "Reason for recording by hand", kind: "text", required: true, wide: true },
  ],
  columns: attendanceColumns,
  searchText: (r) => text(r, ["employee_name", "employee_number", "status", "shift_code"]),
  summary: (rows) => [
    { label: "Present", value: String(rows.filter((r) => r.status === "present" || r.status === "remote").length) },
    { label: "Half days", value: String(rows.filter((r) => r.status === "half_day").length) },
    { label: "Absent", value: String(rows.filter((r) => r.status === "absent").length) },
    { label: "Late arrivals", value: String(rows.filter((r) => Number(r.late_minutes) > 0).length) },
    { label: "Overtime hours", value: quantity(rows.reduce((n, r) => n + Number(r.overtime_minutes), 0) / 60) },
  ],
};

const myAttendance: RegisterConfig = {
  key: "my-attendance",
  title: "My attendance",
  description: "Your own days. If a check-in or check-out is missing, request a correction.",
  searchLabel: "Search my attendance",
  emptyTitle: "No attendance yet",
  emptyDescription: "Check in to start your record.",
  source: { kind: "view", view: "my-attendance" },
  columns: () => attendanceColumns().filter((c) => c.id !== "employee" && c.id !== "source"),
  searchText: (r) => text(r, ["attendance_date", "status"]),
  rowActions: [
    {
      label: "Request correction",
      show: (r) => ["absent", "half_day", "present"].includes(String(r.status)) && !r.leave_request_id,
      fields: [{ name: "checkIn", label: "Correct check-in", kind: "datetime" }, { name: "checkOut", label: "Correct check-out", kind: "datetime" }],
      note: { label: "Why does this day need correcting?", required: true },
      run: (r, note, v) => act("regularization-request", { attendanceDate: calendarDate(r.attendance_date), checkIn: iso(v.checkIn), checkOut: iso(v.checkOut), reason: note }),
      success: "Correction requested. Your manager will review it.",
    },
  ],
};

function regularizationRegister(scope: "all" | "team" | "mine"): RegisterConfig {
  const title = scope === "team" ? "Team corrections" : scope === "mine" ? "My corrections" : "Attendance corrections";
  const decide: RowAction[] = scope === "mine" ? [] : [
    { label: "Approve", show: (r) => r.status === "pending", run: (r, note) => act("regularization-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Approved. The day has been recalculated." },
    { label: "Reject", show: (r) => r.status === "pending", run: (r, note) => act("regularization-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Rejected." },
  ];
  return {
    key: `regularizations-${scope}`,
    title,
    description: scope === "team" ? "Corrections your reports have asked for. You decide them; you cannot decide your own." : scope === "mine" ? "Corrections you have asked for." : "Missed check-ins and check-outs employees have asked to correct. The reporting manager or HR decides.",
    searchLabel: `Search ${title.toLowerCase()}`,
    emptyTitle: "No corrections",
    emptyDescription: "Corrections appear when someone asks to fix a day.",
    source: { kind: "view", view: "regularizations", params: scope === "all" ? {} : { scope } },
    filters: [{ name: "status", label: "Status", options: opts("pending", "approved", "rejected", "cancelled") }],
    columns: () => [
      col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
      col("date", "Day", (r) => calendarDate(r.attendance_date)),
      col("in", "Check-in", (r) => clock(r.requested_check_in)),
      col("out", "Check-out", (r) => clock(r.requested_check_out)),
      col("reason", "Reason", (r) => String(r.reason)),
      badge("status", "Status", (r) => r.status),
      col("note", "Decision note", (r) => String(r.decision_note ?? "")),
    ],
    searchText: (r) => text(r, ["employee_name", "employee_number", "reason", "status"]),
    rowActions: [...decide, { label: "Cancel", show: (r) => r.status === "pending" && scope !== "team", run: (r) => act("regularization-cancel", { id: r.id }), success: "Cancelled." }],
  };
}

function overtimeRegister(scope: "all" | "team"): RegisterConfig {
  return {
    key: `overtime-${scope}`,
    title: scope === "team" ? "Team overtime" : "Overtime",
    description: "Time worked beyond the shift. It is paid only once approved by the reporting manager or HR (never by the employee).",
    searchLabel: "Search overtime",
    emptyTitle: "No overtime",
    emptyDescription: "Overtime appears when a day runs past the shift by more than the threshold.",
    source: { kind: "view", view: "overtime", params: scope === "team" ? { scope: "team" } : {} },
    filters: [{ name: "status", label: "Status", options: opts("pending", "approved", "rejected", "paid") }],
    columns: () => [col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`), col("date", "Day", (r) => calendarDate(r.work_date)), col("mins", "Overtime", (r) => mins(r.minutes)), badge("status", "Status", (r) => r.status), col("note", "Decision note", (r) => String(r.decision_note ?? ""))],
    searchText: (r) => text(r, ["employee_name", "employee_number", "status"]),
    summary: (rows) => [{ label: "Pending hours", value: quantity(rows.filter((r) => r.status === "pending").reduce((n, r) => n + Number(r.minutes), 0) / 60) }, { label: "Approved hours", value: quantity(rows.filter((r) => r.status === "approved").reduce((n, r) => n + Number(r.minutes), 0) / 60) }],
    rowActions: [
      { label: "Approve", show: (r) => r.status === "pending", run: (r, note) => act("overtime-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Overtime approved." },
      { label: "Reject", show: (r) => r.status === "pending", run: (r, note) => act("overtime-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Overtime rejected." },
    ],
  };
}

const lateEarly: RegisterConfig = {
  key: "late-early",
  title: "Late arrivals and early exits",
  description: "Marks per employee over the last 30 days. When a deduction rule is set (for example, two marks cost half a day) the days it costs are shown.",
  searchLabel: "Search employees",
  emptyTitle: "No late arrivals or early exits",
  emptyDescription: "Nobody has been late or left early in this period.",
  source: { kind: "view", view: "late-early" },
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("late", "Late marks", (r) => String(r.late_marks)),
    col("lm", "Minutes late", (r) => String(r.late_minutes)),
    col("early", "Early exits", (r) => String(r.early_exits)),
    col("em", "Minutes early", (r) => String(r.early_exit_minutes)),
    col("ded", "Deduction (days)", (r) => String(r.deduction_days)),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number"]),
};

// ---------------------------------------------------------------- leave
const leaveTypes: RegisterConfig = {
  key: "leave-types",
  title: "Leave types",
  description: "The kinds of leave. Rules here apply to every request of the type: notice, attachments, half days, gender, consecutive days, carry forward. Unpaid leave needs no balance.",
  searchLabel: "Search leave types",
  emptyTitle: "No leave types yet",
  emptyDescription: "Add leave types, then put them in a leave policy.",
  source: { kind: "view", view: "leave-types" },
  createLabel: "New leave type",
  createPermission: "hr_payroll.leave.manage",
  save: { action: "leave-type-save", success: "Leave type saved." },
  edit: { action: "leave-type-save", permission: "hr_payroll.leave.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "paid", label: "Paid", kind: "bool", defaultValue: "true" },
    { name: "halfDayAllowed", label: "Half days allowed", kind: "bool", defaultValue: "true", rowKey: "half_day_allowed" },
    { name: "requiresAttachment", label: "Needs a supporting document", kind: "bool", defaultValue: "false", rowKey: "requires_attachment" },
    { name: "minNoticeDays", label: "Minimum notice (days)", kind: "number", step: 1, rowKey: "min_notice_days" },
    { name: "maxConsecutiveDays", label: "Maximum consecutive days", kind: "number", step: 1, rowKey: "max_consecutive_days" },
    { name: "allowNegativeBalance", label: "Allow a negative balance", kind: "bool", defaultValue: "false", rowKey: "allow_negative_balance" },
    { name: "applicableGender", label: "Available to", kind: "select", defaultValue: "any", options: opts("any", "female", "male"), rowKey: "applicable_gender" },
    { name: "countsWeekends", label: "Weekends and holidays count", kind: "bool", defaultValue: "false", rowKey: "counts_weekends" },
    { name: "carryForwardAllowed", label: "Carries forward", kind: "bool", defaultValue: "false", rowKey: "carry_forward_allowed" },
    { name: "maxCarryForward", label: "Carry-forward limit (days)", kind: "number", step: 1, rowKey: "max_carry_forward" },
    { name: "encashmentAllowed", label: "Can be encashed", kind: "bool", defaultValue: "false", rowKey: "encashment_allowed" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("paid", "Paid", (r) => (r.paid ? "Paid" : "Unpaid")),
    col("notice", "Notice", (r) => (Number(r.min_notice_days) > 0 ? `${r.min_notice_days} days` : "—")),
    col("cf", "Carry forward", (r) => (r.carry_forward_allowed ? `up to ${quantity(r.max_carry_forward)}` : "No")),
    col("att", "Document", (r) => (r.requires_attachment ? "Required" : "—")),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name"]),
};

const leavePolicies: RegisterConfig = {
  key: "leave-policies",
  title: "Leave policies",
  description: "What each group of employees is entitled to. A policy lists leave types with days a year, how they accrue, a cap, and how much carries forward.",
  searchLabel: "Search policies",
  emptyTitle: "No leave policies yet",
  emptyDescription: "Create a policy, add its entitlements, then assign it.",
  source: { kind: "view", view: "leave-policies" },
  createLabel: "New policy",
  createPermission: "hr_payroll.leave.manage",
  save: { action: "leave-policy-save", success: "Policy saved.", transform: (v) => ({ employmentTypes: String(v.employmentTypes || "").split(",").map((s) => s.trim()).filter(Boolean) }) },
  edit: { action: "leave-policy-save", permission: "hr_payroll.leave.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "employmentTypes", label: "Employment types covered (comma separated)", kind: "text", placeholder: "permanent, contract", wide: true },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("types", "Covers", (r) => ((r.employment_types as string[]) ?? []).map(label).join(", ") || "Assigned by hand"),
    col("entries", "Entitlements", (r) => ((r.entries as Array<{ code: string; annualDays: string; accrualFrequency: string }>) ?? []).map((e) => `${e.code} ${quantity(e.annualDays)} (${e.accrualFrequency})`).join(" · ") || "None yet"),
    col("emp", "Employees", (r) => String(r.employees)),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name"]),
  rowActions: [
    {
      label: "Set entitlement",
      permission: "hr_payroll.leave.manage",
      fields: [
        { name: "leaveTypeId", label: "Leave type", kind: "select", options: "leaveTypes", required: true },
        { name: "annualDays", label: "Days a year", kind: "number", step: 1, required: true },
        { name: "accrualFrequency", label: "Accrual", kind: "select", defaultValue: "monthly", options: opts("upfront", "monthly", "quarterly", "yearly", "none") },
        { name: "maxBalance", label: "Maximum balance", kind: "number", step: 1 },
        { name: "carryForwardLimit", label: "Carry-forward limit", kind: "number", step: 1 },
        { name: "eligibleAfterDays", label: "Eligible after (days of service)", kind: "number", step: 1 },
      ],
      run: (r, _n, v) => act("policy-entry-set", { policyId: r.id, ...v }),
      success: "Entitlement saved.",
    },
    { label: "Assign to employees", permission: "hr_payroll.leave.manage", run: (r) => act("policy-assign", { policyId: r.id }), success: "Policy assigned to every current employee of the types it covers." },
  ],
};

const leaveBalances: RegisterConfig = {
  key: "leave-balances",
  title: "Leave balances",
  description: "Every employee's balance for the current leave year: opening, accrued, used, adjusted and what is left after requests still awaiting approval.",
  searchLabel: "Search balances",
  emptyTitle: "No balances yet",
  emptyDescription: "Assign a policy and run accrual to create balances.",
  source: { kind: "view", view: "leave-balances" },
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("type", "Leave type", (r) => `${r.type_name} (${r.type_code})`),
    col("year", "Year", (r) => String(r.leave_year)),
    col("open", "Opening", (r) => quantity(r.opening_balance)),
    col("acc", "Accrued", (r) => quantity(r.accrued)),
    col("used", "Used", (r) => quantity(r.used)),
    col("adj", "Adjusted", (r) => quantity(r.adjusted)),
    col("bal", "Balance", (r) => quantity(r.closing_balance)),
    col("pend", "Pending", (r) => quantity(r.pending)),
    col("avail", "Available", (r) => quantity(r.available)),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number", "type_name", "type_code"]),
  rowActions: [
    {
      label: "Adjust",
      permission: "hr_payroll.leave.manage",
      fields: [{ name: "days", label: "Days to add (negative to remove)", kind: "number", step: 0.5, min: -365, required: true }],
      note: { label: "Reason", required: true },
      run: (r, note, v) => act("leave-balance-adjust", { employeeId: r.employee_id, leaveTypeId: r.leave_type_id, leaveYear: r.leave_year, days: Number(v.days), note }),
      success: "Balance adjusted.",
    },
  ],
};
const myBalances: RegisterConfig = { ...leaveBalances, key: "my-leave-balances", title: "My leave balances", description: "What you have available, this leave year.", source: { kind: "view", view: "my-leave-balances" }, columns: () => leaveBalances.columns(undefined).filter((c) => c.id !== "employee"), rowActions: [] };

const leaveColumns = () => [
  col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
  col("type", "Leave", (r) => `${r.type_name}${r.paid ? "" : " (unpaid)"}`),
  col("from", "From", (r) => `${calendarDate(r.start_date)}${r.start_half ? " (half)" : ""}`),
  col("to", "To", (r) => `${calendarDate(r.end_date)}${r.end_half ? " (half)" : ""}`),
  col("days", "Days", (r) => quantity(r.days)),
  badge("status", "Status", (r) => r.status),
  col("reason", "Reason", (r) => String(r.reason ?? "")),
  col("note", "Decision", (r) => String(r.rejection_reason ?? r.cancel_reason ?? "")),
];
const leaveActions = (scope: "all" | "team" | "mine"): RowAction[] => [
  ...(scope === "mine" ? [] : [
    { label: "Approve", show: (r: Row) => r.status === "submitted", run: (r: Row, note: string) => act("leave-decide", { id: r.id, approve: true, note }), note: { label: "Note (optional)" }, success: "Leave approved." },
    { label: "Reject", show: (r: Row) => r.status === "submitted", run: (r: Row, note: string) => act("leave-decide", { id: r.id, approve: false, note }), note: { label: "Reason", required: true }, success: "Leave rejected." },
  ]),
  { label: "Cancel", show: (r: Row) => ["submitted", "approved"].includes(String(r.status)) && (scope !== "all" || true), run: (r: Row, note: string) => act("leave-cancel", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Leave cancelled." },
];
function leaveRegister(scope: "all" | "team" | "mine"): RegisterConfig {
  const title = scope === "team" ? "Team leave" : scope === "mine" ? "My leave" : "Leave requests";
  return {
    key: `leave-${scope}`,
    title,
    description: scope === "mine" ? "Apply for leave and follow your requests. Pending requests set balance aside until they are decided." : scope === "team" ? "Requests from your reports. You decide them; you cannot decide your own." : "Every leave request. Approval is by the reporting manager or HR, never by the employee.",
    searchLabel: `Search ${title.toLowerCase()}`,
    emptyTitle: "No leave requests",
    emptyDescription: scope === "mine" ? "Apply for leave to see it here." : "Requests appear here as they are made.",
    source: { kind: "view", view: "leave-requests", params: scope === "all" ? {} : { scope } },
    filters: [{ name: "status", label: "Status", options: opts("submitted", "approved", "rejected", "cancelled") }],
    ...(scope === "mine" || scope === "all" ? {
      createLabel: scope === "mine" ? "Apply for leave" : "Record leave",
      save: { action: "leave-apply", success: "Leave requested. It is with your manager." },
      fields: [
        ...(scope === "all" ? [{ name: "employeeId", label: "Employee", kind: "select" as const, options: "employees" as const, required: true }] : []),
        { name: "leaveTypeId", label: "Leave type", kind: "select" as const, options: "leaveTypes" as const, required: true },
        { name: "startDate", label: "From", kind: "date" as const, required: true },
        { name: "endDate", label: "To", kind: "date" as const, required: true },
        { name: "startHalf", label: "First day is a half day", kind: "bool" as const, defaultValue: "false" },
        { name: "endHalf", label: "Last day is a half day", kind: "bool" as const, defaultValue: "false" },
        { name: "reason", label: "Reason", kind: "textarea" as const },
        { name: "attachmentReference", label: "Supporting document (file reference)", kind: "text" as const },
      ],
    } : {}),
    columns: scope === "mine" ? () => leaveColumns().filter((c) => c.id !== "employee") : leaveColumns,
    searchText: (r) => text(r, ["employee_name", "employee_number", "type_name", "status", "reason"]),
    summary: (rows) => [{ label: "Awaiting approval", value: String(rows.filter((r) => r.status === "submitted").length) }, { label: "Approved days", value: quantity(rows.filter((r) => r.status === "approved").reduce((n, r) => n + Number(r.days), 0)) }],
    rowActions: leaveActions(scope),
  };
}

export const TIME_REGISTERS: Record<string, RegisterConfig> = {
  shifts,
  "shift-assignments": shiftAssignments,
  "holiday-calendars": holidayCalendars,
  holidays,
  attendance,
  "my-attendance": myAttendance,
  regularizations: regularizationRegister("all"),
  "team-corrections": regularizationRegister("team"),
  "my-corrections": regularizationRegister("mine"),
  overtime: overtimeRegister("all"),
  "team-overtime": overtimeRegister("team"),
  "late-early": lateEarly,
  "leave-types": leaveTypes,
  "leave-policies": leavePolicies,
  "leave-balances": leaveBalances,
  "my-leave-balances": myBalances,
  "leave-requests": leaveRegister("all"),
  "team-leave": leaveRegister("team"),
  "my-leave": leaveRegister("mine"),
};
void dateTime;
