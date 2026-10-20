// HR & Payroll — after approval (MVP 39): posting to Finance, payslip publishing, salary and statutory payments, closing, and the payroll reports.
export {
  PA as PAYROLL_ACCOUNTING_PERMISSIONS, closePayrollRun, markPaymentException, postPayrollRunToFinance, postingOf as payrollPostingOf, publishPayslips, recordSalaryPayment,
  recordStatutoryPayment, statutoryOwed, unpostPayrollRun,
} from "./pa-commands.js";
export { PAYROLL_REPORTS, exportPayrollReport, getPayrollReport } from "./pa-reports.js";
