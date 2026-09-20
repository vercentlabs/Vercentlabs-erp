"use client";

import { act } from "@/features/hr/shared/client";
import type { RegisterConfig } from "@/features/hr/shared/Register";
import { amount, badge, calendarDate, col, label, opts, quantity, strong, text } from "@/features/hr/configs";

const TYPES = opts("pf", "esi", "professional_tax", "tds", "gratuity", "bonus", "labor_welfare", "other");
const BASES = opts("percentage_of_wage", "flat_amount", "slab");
const WAGE_BASES = opts("pf_wage", "esic_wage", "gross", "net");

const components: RegisterConfig = {
  key: "statutory-components",
  title: "Statutory components",
  description: "PF, ESIC, professional tax, TDS and labour welfare fund, each configured with an effective date and (for professional tax and TDS) its own slab table -- not hard-coded. A percentage component applies to the wage basis you choose, capped at the wage ceiling if one is set.",
  searchLabel: "Search statutory components",
  emptyTitle: "No statutory components configured",
  emptyDescription: "Add PF, ESIC or another statutory component to have payroll compute it automatically.",
  source: { kind: "view", view: "statutory-components" },
  filters: [{ name: "type", label: "Type", options: TYPES }],
  createLabel: "New component",
  createPermission: "hr_payroll.statutory.manage",
  save: { action: "statutory-component-save", success: "Saved. It applies to every payroll from its effective date." },
  edit: { action: "statutory-component-save", permission: "hr_payroll.statutory.manage" },
  fields: [
    { name: "code", label: "Code", kind: "text", required: true, createOnly: true },
    { name: "name", label: "Name", kind: "text", required: true },
    { name: "statutoryType", label: "Type", kind: "select", defaultValue: "pf", options: TYPES, rowKey: "statutory_type", required: true },
    { name: "calculationBasis", label: "Calculation", kind: "select", defaultValue: "percentage_of_wage", options: BASES, rowKey: "calculation_basis" },
    { name: "wageBasis", label: "Wage basis (percentage components)", kind: "select", defaultValue: "gross", options: WAGE_BASES, rowKey: "wage_basis" },
    { name: "employeeRate", label: "Employee rate %", kind: "number", step: 0.05, rowKey: "employee_rate" },
    { name: "employerRate", label: "Employer rate %", kind: "number", step: 0.05, rowKey: "employer_rate" },
    { name: "wageCeiling", label: "Wage ceiling (percentage components)", kind: "number", step: 500, rowKey: "wage_ceiling" },
    { name: "employeeFlatAmount", label: "Employee flat amount", kind: "number", step: 10, rowKey: "employee_flat_amount" },
    { name: "employerFlatAmount", label: "Employer flat amount", kind: "number", step: 10, rowKey: "employer_flat_amount" },
    { name: "state", label: "State (professional tax / LWF only)", kind: "text" },
    { name: "effectiveFrom", label: "Effective from", kind: "date", required: true, rowKey: "effective_from" },
    { name: "effectiveTo", label: "Effective to", kind: "date", rowKey: "effective_to" },
    { name: "dueDay", label: "Remittance due day (of the next month)", kind: "number", step: 1, rowKey: "due_day" },
    { name: "active", label: "Active", kind: "bool", defaultValue: "true" },
  ],
  columns: () => [
    strong("code", "Code", (r) => String(r.code)),
    col("name", "Name", (r) => String(r.name)),
    col("type", "Type", (r) => label(r.statutory_type)),
    col("state", "State", (r) => String(r.state ?? "All")),
    col("basis", "Basis", (r) => label(r.calculation_basis)),
    col("rate", "Employee rate", (r) => (r.calculation_basis === "percentage_of_wage" ? `${quantity(r.employee_rate)}%` : r.calculation_basis === "flat_amount" ? amount(r.employee_flat_amount) : `${r.slab_count} slab(s)`)),
    col("ceiling", "Ceiling", (r) => (r.wage_ceiling === null ? "—" : amount(r.wage_ceiling))),
    col("from", "From", (r) => calendarDate(r.effective_from)),
    badge("status", "Status", (r) => (r.active ? "active" : "inactive")),
  ],
  searchText: (r) => text(r, ["code", "name", "statutory_type", "state", "status"]),
  rowActions: [
    {
      label: "Add slab",
      permission: "hr_payroll.statutory.manage",
      show: (r) => r.calculation_basis === "slab",
      fields: [
        { name: "fromAmount", label: "From amount", kind: "number", step: 1000, required: true },
        { name: "toAmount", label: "To amount (blank for no upper limit)", kind: "number", step: 1000 },
        { name: "flatAmount", label: "Flat amount", kind: "number", step: 10 },
        { name: "ratePercent", label: "Rate % of the amount in this bracket", kind: "number", step: 0.5 },
      ],
      run: (r, _n, v) => act("statutory-slab-set", { statutoryComponentId: r.id, fromAmount: v.fromAmount, toAmount: v.toAmount || undefined, flatAmount: v.flatAmount, ratePercent: v.ratePercent }),
      success: "Slab saved.",
    },
    { label: "Retire", permission: "hr_payroll.statutory.manage", show: (r) => Boolean(r.active), run: (r, note) => act("statutory-component-deactivate", { id: r.id, reason: note }), note: { label: "Reason", required: true }, success: "Retired." },
  ],
};

const gratuity: RegisterConfig = {
  key: "gratuity-records",
  title: "Gratuity",
  description: "An estimate (while an employee is still with the company) or the amount actually paid in a final settlement, using the last-drawn basic and years of service. Eligibility and the formula follow the settings under HR settings.",
  searchLabel: "Search gratuity records",
  emptyTitle: "No gratuity records yet",
  emptyDescription: "Estimate gratuity for an employee, or it will appear automatically on their final settlement once eligible.",
  source: { kind: "view", view: "gratuity-records" },
  createLabel: "Estimate gratuity",
  createPermission: "hr_payroll.statutory.manage",
  save: { action: "gratuity-estimate", success: "Estimated." },
  fields: [{ name: "employeeId", label: "Employee", kind: "select", options: "employees", required: true }],
  columns: () => [
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("asOf", "As of", (r) => calendarDate(r.as_of_date)),
    col("years", "Years of service", (r) => quantity(r.years_of_service)),
    col("basic", "Last drawn basic", (r) => amount(r.last_drawn_basic)),
    badge("eligible", "Eligible", (r) => (r.eligible ? "active" : "inactive")),
    col("amount", "Amount", (r) => amount(r.amount)),
    col("capped", "Capped", (r) => (r.capped ? "Yes" : "No")),
    col("type", "Kind", (r) => label(r.record_type)),
  ],
  searchText: (r) => text(r, ["employee_name", "employee_number", "record_type"]),
};

export const STATUTORY_REGISTERS: Record<string, RegisterConfig> = {
  "statutory-components": components,
  "gratuity-records": gratuity,
};
