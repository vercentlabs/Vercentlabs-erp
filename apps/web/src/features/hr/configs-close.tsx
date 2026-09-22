"use client";

import { act } from "@/features/hr/shared/client";
import type { RegisterConfig } from "@/features/hr/shared/Register";
import { amount, badge, calendarDate, col, dateTime, link, opts, strong, text } from "@/features/hr/configs";

const settlements: RegisterConfig = {
  key: "final-settlements",
  title: "Final settlements",
  description: "Full and final pay for a separated employee: leave encashment, any notice-period shortfall, outstanding loans, and unpaid approved bonus or arrears, netted to one amount. Calculated by one person, approved by another, then paid through a real payroll.",
  searchLabel: "Search settlements",
  emptyTitle: "No final settlements yet",
  emptyDescription: "A settlement is calculated for a separated employee from Employees or Separations.",
  source: { kind: "view", view: "final-settlements" },
  filters: [{ name: "status", label: "Status", options: opts("draft", "pending_approval", "approved", "paid", "cancelled") }],
  columns: () => [
    link("number", "Settlement", (r) => String(r.settlement_number), (r) => `/hr/settlement/${r.id}`),
    col("employee", "Employee", (r) => `${r.employee_name} (${r.employee_number})`),
    col("lwd", "Last working day", (r) => calendarDate(r.last_working_day)),
    col("earn", "Earnings", (r) => amount(r.total_earnings)),
    col("rec", "Recoveries", (r) => amount(r.total_recoveries)),
    col("net", "Net", (r) => amount(r.net_amount)),
    badge("status", "Status", (r) => r.status),
  ],
  searchText: (r) => text(r, ["settlement_number", "employee_name", "employee_number", "status"]),
};

const bankFiles: RegisterConfig = {
  key: "bank-files",
  title: "Bank transfer files",
  description: "The NEFT/RTGS file for a payroll's net pay, generated once per approved run and acknowledged with the bank's UTR once sent.",
  searchLabel: "Search bank files",
  emptyTitle: "No bank files yet",
  emptyDescription: "Generate one from an approved payroll run.",
  source: { kind: "view", view: "bank-files" },
  columns: () => [
    strong("number", "File", (r) => String(r.file_number)),
    col("run", "Payroll", (r) => String(r.payroll_number)),
    col("count", "Employees", (r) => String(r.record_count)),
    col("total", "Total", (r) => amount(r.total_amount)),
    badge("status", "Status", (r) => r.status),
    col("gen", "Generated", (r) => dateTime(r.generated_at)),
    col("utr", "UTR", (r) => String(r.utr_reference ?? "")),
  ],
  searchText: (r) => text(r, ["file_number", "payroll_number", "status", "utr_reference"]),
  rowActions: [
    {
      label: "Acknowledge",
      permission: "hr_payroll.payroll.post",
      show: (r) => r.status === "generated",
      fields: [{ name: "utrReference", label: "Bank UTR / batch reference", kind: "text", required: true }],
      run: (r, _n, v) => act("bank-file-acknowledge", { id: r.id, utrReference: v.utrReference }),
      success: "Acknowledged. The payroll is now marked paid.",
    },
  ],
};

export const CLOSE_REGISTERS: Record<string, RegisterConfig> = {
  "final-settlements": settlements,
  "bank-files": bankFiles,
};
