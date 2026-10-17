"use client";

// Projects — Project Expenses: the client of claims, their approval, Finance review, reimbursement, recharge and corrections, the project's
// expense summary, the queues, reports and the expense policy. Every command carries its key, so a retried click never acts twice.
import { call, qs, send } from "../api/projects-api";

export type ExpenseStatus = "DRAFT" | "SUBMITTED" | "CHANGES_REQUESTED" | "APPROVED" | "REJECTED" | "WITHDRAWN" | "CORRECTION_REQUIRED";
export type Expense = {
  id: string; code: string; projectId: string; project: string; projectCode: string; taskId: string | null; task: string | null; claimantId: string; claimant: string; enteredBy: string | null;
  expenseDate: string; categoryId: string; category: string; categoryCode: string; budgetCategory: string | null; description: string; amount: string; currency: string; exchangeRate: string;
  baseAmount: string; baseCurrency: string; paymentSource: "EMPLOYEE" | "COMPANY" | "SUPPLIER"; paymentSourceLabel: string; paymentReference: string | null;
  supplierInvoice: { number: string | null; date: string | null; gstin: string | null; taxable: string | null; cgst: string | null; sgst: string | null; igst: string | null };
  vendorBillLineId: string | null; vendorBillId: string | null; status: ExpenseStatus; statusLabel: string; version: number; submittedAt: string | null; approvedAt: string | null; approvedBy: string | null;
  overLimit: boolean; receipts: number; receiptRequired: boolean; receiptException: string | null; receiptExceptionAcceptedBy: string | null; missingReceipt: boolean;
  financeStatus: "NOT_REVIEWED" | "VERIFIED" | "RETURNED"; reimbursable: boolean; reimbursementStatus: string; reimbursementLabel: string; createdAt: string; updatedAt: string;
  taxTreatment?: string; taxLabel?: string; costBasis?: string | null; recognitionDate?: string | null; financeNote?: string | null; financeReviewedBy?: string | null; financeReviewedAt?: string | null;
  billingClassification?: string; classificationLabel?: string; billingStatus?: string; billingLabel?: string; rechargeAmount?: string | null; rechargeSalesOrderLineId?: string | null;
  can: { edit: boolean; submit: boolean; withdraw: boolean; approve: boolean; finance: boolean; reimburse: boolean; billing: boolean; correct: boolean; receipts: boolean };
};
export type ExpenseDetail = Expense & {
  duplicates: Array<{ id: string; code: string; amount: string; currency: string; expenseDate: string; status: string; description: string; reason: string }>;
  history: Array<{ id: string; action: string; from: string | null; to: string | null; reason: string | null; actor: string; at: string; version: number }>;
  reimbursement: { amount: string; paid: string; outstanding: string; status: string; payments: Array<{ amount: string; paidOn: string; reference: string; recordedBy: string | null; at: string }> } | null;
  allocations: Array<{ id: string; source: string; amount: string; status: string; recognitionDate: string; reversalReason: string | null }>;
  corrections: Array<{ id: string; number: string; kind: string; reason: string; changes: Record<string, unknown>; status: string; requestedBy: string | null; requestedAt: string; decidedBy: string | null;
    note: string | null; impact: Record<string, unknown>; canDecide: boolean }>;
  recharge: Array<{ requestId: string; number: string; amount: string; status: string; requestStatus: string }>;
};
export type ExpenseList = { view: string; total: number; page: number; pageSize: number; pages: number; totalAmount: string; currency: string; items: Expense[];
  can: { create: boolean; finance: boolean; team: boolean; export: boolean } };
export type ExpenseOptions = {
  currency: string; policy: { financeReviewRequired: boolean; receiptThreshold: string; managerLimit: string | null; deadlineDays: number; currency: string };
  categories: Array<{ id: string; code: string; name: string; description: string | null; receiptRequired: boolean; descriptionRequired: boolean }>;
  projects: Array<{ id: string; code: string; name: string | null; status: string; label: string }>; sources: Array<{ value: string; label: string }>; tax: Array<{ value: string; label: string }>;
  tasks?: Array<{ id: string; label: string }>; claimants?: Array<{ id: string; name: string }>; salesOrderLines?: Array<{ id: string; label: string }>; goodsIssues?: Array<{ id: string; label: string }>;
  can: { create: boolean; finance: boolean };
};
export type ExpenseSummary = {
  projectId: string; currency: string; measures: string; scope: "MINE" | "PROJECT";
  claims: { reported: string; draft: string; awaitingApproval: string; approved: string; count: number; awaitingCount: number };
  cost?: { recognized: string; pendingRecognition: string; bySource: Record<string, string>; pendingSupplierBills: string; byCategory: Array<{ category: string; amount: string }>; openCommitments: string;
    commitments: Array<{ id: string; number: string; total: string; billed: string }>; reimbursementsOutstanding: string; reimbursementsPaid: string; budget: { available: boolean; message: string } };
  billing?: { eligible: string; reserved: string; invoiced: string };
  can: { create: boolean; cost: boolean; billing: boolean; finance: boolean; lead: boolean; export: boolean };
};
export type ExpenseSettings = { financeReviewRequired: boolean; receiptThreshold: string; managerLimit: string | null; deadlineDays: number; currency: string; can: { manage: boolean } };

export const EXPENSES_BASE = "/projects/expenses";
export const listExpenses = (filters: Record<string, string | number | undefined>) => call<ExpenseList>(`/expenses${qs(filters)}`);
export const getExpense = (id: string) => call<{ expense: ExpenseDetail }>(`/expenses/${id}`).then((r) => r.expense);
export const createExpense = (input: Record<string, unknown>) => send<{ expenseId: string; code: string; status: string; version: number; replayed?: boolean }>("/expenses", input);
export const updateExpense = (id: string, input: Record<string, unknown>) => send<{ expenseId: string; version: number; changed: string[] }>(`/expenses/${id}`, input, "PATCH");
export const expenseAction = <T = Record<string, unknown>>(id: string, action: string, input: Record<string, unknown> = {}) => send<T>(`/expenses/${id}/${action}`, input);
export const getExpenseOptions = (projectId?: string) => call<ExpenseOptions>(`/expenses/options${qs({ projectId })}`);
export const getExpenseSummary = (projectId: string) => call<{ summary: ExpenseSummary }>(`/${projectId}/expenses`).then((r) => r.summary);
export const projectExpenseAction = <T = Record<string, unknown>>(projectId: string, action: string, input: Record<string, unknown>) => send<T>(`/${projectId}/expenses/${action}`, input);
export const searchBillLines = (search: string) => call<{ lines: Array<{ id: string; label: string; net: string; remaining: string; billStatus: string; billDate: string }> }>(`/expenses/supplier-lines${qs({ search })}`).then((r) => r.lines);
export const listRecharges = (projectId?: string) => call<{ requests: Array<{ id: string; number: string; projectId: string; project: string; status: string; total: string; currency: string; createdBy: string | null; createdAt: string }> }>(
  `/expenses/recharges${qs({ projectId })}`).then((r) => r.requests);
export const rechargeAction = (requestId: string, action: "cancel" | "invoiced", input: Record<string, unknown>) => send(`/expenses/recharges/${requestId}/${action}`, input);
export const decideCorrection = (correctionId: string, input: { decision: "APPLY" | "REJECT"; note?: string }) => send(`/expenses/corrections/${correctionId}`, input);
export async function uploadReceipt(id: string, file: File) {
  const form = new FormData();
  form.append("file", file);
  return call<{ file: { id: string; fileName: string } }>(`/expenses/${id}/files`, { method: "POST", body: form }).then((r) => r.file);
}
export const listReceipts = (id: string) => call<{ files: Array<{ id: string; fileName: string; sizeBytes: number; uploadedAt: string; uploadedBy: string | null }> }>(`/expenses/${id}/files`).then((r) => r.files);
export const removeReceipt = (id: string, fileId: string) => send(`/expenses/${id}/files/${fileId}`, {}, "DELETE");
export const receiptHref = (id: string, fileId: string) => `/api/projects/expenses/${id}/files/${fileId}`;
export const expensesExportHref = (filters: Record<string, string | undefined>) => `/api/projects/expenses/export${qs(filters)}`;
export const getExpenseReport = <T = Record<string, unknown>>(kind: string) => call<{ rows: T[] }>(`/reports/expenses${qs({ kind })}`).then((r) => r.rows);
export const getExpenseSettings = () => call<{ settings: ExpenseSettings }>("/expenses/settings").then((r) => r.settings);
export const saveExpenseSettings = (input: Partial<ExpenseSettings>) => send("/expenses/settings", input);
// "₹2,500.00" — money is shown as the server sent it (exact decimals), only grouped for reading.
export const moneyLabel = (amount: string | null | undefined, currency = "INR") => {
  if (amount === null || amount === undefined || amount === "") return "—";
  const [whole, fraction = "00"] = String(amount).split(".");
  const negative = whole!.startsWith("-");
  const digits = whole!.replace("-", "");
  const grouped = currency === "INR" ? digits.replace(/(\d)(?=(\d\d)+\d$)/g, "$1,") : digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const symbol = currency === "INR" ? "₹" : `${currency} `;
  return `${negative ? "−" : ""}${symbol}${grouped}.${fraction.padEnd(2, "0").slice(0, 2)}`;
};
export const STATUS_TONE: Record<string, "neutral" | "info" | "success" | "warning" | "danger"> = {
  DRAFT: "neutral", SUBMITTED: "info", CHANGES_REQUESTED: "warning", APPROVED: "success", REJECTED: "danger", WITHDRAWN: "neutral", CORRECTION_REQUIRED: "warning",
};
