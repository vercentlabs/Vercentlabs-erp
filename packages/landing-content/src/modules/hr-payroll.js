import { CTAS } from "../navigation.js";
import { capabilityGroup } from "./capability-group.js";
import { PLATFORM_GOVERNANCE } from "./platform-governance.js";

/**
 * HR & Payroll — marketing content for the `hr-payroll` module of the ERP
 * module catalog (@vercentlabs/shared-types). The catalog owns `key`, `name`,
 * and `description`; `displayName` is the public label. Everything here must
 * stay inside this module's approved launch capabilities
 * (capabilities/launch-capabilities.js).
 */
export const HR_PAYROLL_MODULE = Object.freeze({
  key: "hr-payroll",
  displayName: "HR & Payroll",
  purpose: "Employees, shifts and attendance, leave, and payroll.",
  navGroup: "people-and-service",
  personas: ["HR managers and admins", "Payroll preparers", "Line managers", "Employees"],
  painPoints: [
    "Employee records spread across files",
    "Leave tracked in spreadsheets",
    "Payroll recalculated by hand from attendance",
  ],
  bestAngle:
    "Employee records, shifts, attendance, and approved leave feed a payroll calculation for each payroll period — approved before payslips are issued.",
  accentColor: { hex: "#a21caf", soft: "#fbeafd", sourcedFromProduct: false },
  directDefinition:
    "The Vercentlabs HR & Payroll module manages employees and their organisation, shifts, attendance, leave, salary structures, and payroll — from attendance and approved leave to an approved payroll run and payslips.",
  heroVariant: "operational-sequence",
  searchIntent: "HR and payroll ERP",
  metaDescription:
    "Vercentlabs HR & Payroll manages employee records, shifts, attendance and check-in, leave requests and approval, salary structures, payroll calculation and approval, and payslips.",
  businessProblems: [
    { title: "Employee data in too many places", description: "Joining details, departments, and reporting lines live in separate files and drift apart." },
    { title: "Leave tracked by hand", description: "Leave requests arrive by message, and balances are kept in a spreadsheet." },
    { title: "Payroll rebuilt every month", description: "Attendance and leave are re-entered into a payroll spreadsheet each period." },
    { title: "Payroll approved informally", description: "There's no clear approval step before salaries are finalised." },
  ],
  businessOutcomes: [
    { title: "One employee record", description: "Employee master data, departments, designations, reporting managers, and locations live in one place." },
    { title: "Leave that keeps its own balance", description: "Leave requests are approved in the system and balances update." },
    { title: "Payroll from real attendance", description: "Payroll is calculated for each period from salary structures, attendance, and approved leave." },
    { title: "An approval step before payslips", description: "Payroll is approved before payslips are issued." },
  ],
  capabilityGroups: [
    capabilityGroup(
      "hr-workforce",
      "Employees & organisation",
      "Who works for you, where, in what role, and who they report to.",
      ["hr-employee-master", "hr-employee-number", "hr-departments", "hr-designations", "hr-reporting-manager", "hr-branch-location", "hr-employment-type", "hr-joining"],
    ),
    capabilityGroup(
      "hr-time-attendance",
      "Shifts & attendance",
      "When people are scheduled to work, and when they actually check in and out.",
      ["hr-shifts", "hr-attendance", "hr-check-in-check-out", "hr-holiday-calendars"],
      "hire-to-payroll",
    ),
    capabilityGroup(
      "hr-leave",
      "Leave",
      "Leave types, balances, requests, and approval.",
      ["hr-leave-types", "hr-leave-balances", "hr-leave-requests", "hr-leave-approval"],
    ),
    capabilityGroup(
      "hr-payroll-run",
      "Compensation & payroll",
      "Salary components and structures, and the payroll calculated, approved, and issued each period.",
      ["hr-salary-components", "hr-salary-structures", "hr-compensation-assignment", "hr-payroll-periods", "hr-payroll-calculation", "hr-payroll-approval", "hr-payslips"],
    ),
  ],
  primaryWorkflow: {
    name: "Attendance to Payslip",
    trigger: "A payroll period comes to a close.",
    steps: [
      { step: "Record attendance", detail: "Attendance and check-in/check-out are recorded against each employee's shift." },
      { step: "Approve leave", detail: "Leave requests are approved, and leave balances update." },
      { step: "Calculate", detail: "Payroll is calculated for the period from salary structures, attendance, and leave." },
      { step: "Approve", detail: "The payroll is approved; an approver can't approve a payroll that includes their own pay." },
      { step: "Issue payslips", detail: "Payslips are issued for the approved payroll." },
    ],
    approvals: ["Leave approval", "Payroll approval — an approver can't approve a payroll that includes their own pay"],
    automatedActions: ["Payroll calculation from salary structures and attendance", "Leave-balance update on approval"],
    connectedModuleKeys: ["accounting"],
    outcome: "An approved payroll for the period, with payslips issued from real attendance and leave.",
  },
  connectedModules: [
    { moduleKey: "accounting", relationship: "Approved payroll gives finance the figures it records in the books kept in Accounting." },
    { moduleKey: "projects", relationship: "Employees managed in HR are the people assigned to project tasks and logging timesheets." },
  ],
  reporting: [
    { name: "Payroll by period", measures: "Payroll status and totals for each payroll period", audience: "HR managers, payroll preparers" },
  ],
  automation: [
    { title: "Payroll calculation", description: "Payroll is calculated from each employee's salary structure, attendance, and leave." },
    { title: "Leave balances", description: "Approved leave updates the employee's leave balance." },
  ],
  governance: [
    { title: "Payroll approval", description: "Payroll is approved before payslips are issued, and an approver can't approve a payroll that includes their own pay." },
    PLATFORM_GOVERNANCE.permissions,
    PLATFORM_GOVERNANCE.audit,
  ],
  implementationConsiderations: [
    "Departments, designations, branches, and shifts are set up before employee records are loaded.",
    "Salary components and structures are configured and assigned to employees before the first payroll period.",
    "Leave types, opening balances, and holiday calendars are agreed with HR before go-live.",
  ],
  faqs: [
    { question: "Can an approver approve a payroll that includes their own pay?", answer: "No. Vercentlabs blocks approval of a payroll that includes the approver's own pay." },
    { question: "Is payroll calculated from attendance?", answer: "Yes. Payroll is calculated for each period from the employee's salary structure, attendance, and leave." },
    { question: "Does Vercentlabs HR & Payroll include statutory filings or recruitment?", answer: "No. The launch product covers employee records, attendance, leave, salary structures, payroll calculation and approval, and payslips; statutory filings, recruitment, and expense claims are not part of it." },
  ],
  screenshots: { primary: "hr-employee-directory" },
  conversion: { heading: "See how Vercentlabs HR & Payroll would run your attendance-to-payroll process.", ctaLabel: CTAS.talkToSpecialist.label },
});
