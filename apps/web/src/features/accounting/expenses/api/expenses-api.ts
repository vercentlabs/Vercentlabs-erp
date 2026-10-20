"use client";

// Expenses (Finance MVP F7): the client of /api/accounting/{expenses, expense-categories}.
import { AccountingApiError } from "@/features/accounting/shared/client";

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const isForm = typeof FormData !== "undefined" && init?.body instanceof FormData;
  const response = await fetch(`/api/accounting${path}`, {
    credentials: "same-origin",
    headers: { Accept: "application/json", ...(init?.body && !isForm ? { "Content-Type": "application/json" } : {}) },
    ...init,
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) throw new AccountingApiError(payload.message || "The request could not be completed.", response.status, payload.code);
  return payload as T;
}
const qs = (params: Record<string, string | undefined | null>) => {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  const text = search.toString();
  return text ? `?${text}` : "";
};
const post = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: unknown = {}) => call<T>(path, { method: "PATCH", body: JSON.stringify(body) });
export const errorMessage = (error: unknown) => (error instanceof Error ? error.message : "Something went wrong.");
export const errorStatus = (error: unknown) => (error instanceof AccountingApiError ? error.status : 0);

// ------------------------------------------------------------------ categories
export type ExpenseCategory = {
  id: string; code: string; name: string; description: string | null; account: { id: string; label: string; active: boolean }; defaultGstRate: number | null;
  receiptRequired: boolean; receiptThreshold: number; status: "active" | "inactive"; sortOrder: number; expenses: number; spentThisMonth: number;
};
export type CategoryInput = { name: string; description?: string | null; accountId: string; defaultGstRate?: number | null; receiptRequired?: boolean; receiptThreshold?: string; sortOrder?: number };
export const listCategories = (includeInactive = true) =>
  call<{ categories: ExpenseCategory[]; options: { accounts: Array<{ id: string; label: string }> } }>(`/expense-categories${includeInactive ? "?includeInactive=true" : ""}`);
export const createCategory = (input: CategoryInput) => post<{ category: ExpenseCategory }>("/expense-categories", input).then((r) => r.category);
export const updateCategory = (id: string, input: Partial<CategoryInput> & { status?: "active" | "inactive" }) =>
  patch<{ category: ExpenseCategory }>(`/expense-categories/${id}`, input).then((r) => r.category);

// ------------------------------------------------------------------ expenses
export type ExpenseStatus = "DRAFT" | "SUBMITTED" | "POSTED" | "REJECTED" | "REVERSED" | "CANCELLED";
export type ExpenseState = "DRAFT" | "SUBMITTED" | "REJECTED" | "TO_PAY" | "PAID" | "REVERSED" | "CANCELLED";
export type GstTreatment = "NO_GST" | "GST_CLAIM_ITC" | "GST_NO_ITC";
export type Expense = {
  id: string; number: string; date: string; description: string; status: ExpenseStatus; state: ExpenseState; category: { id: string; name: string; code: string } | null;
  expenseAccount: { id: string; label: string }; payee: string | null; partyId: string | null; payeeName: string | null; supplierGstin: string | null;
  supplierInvoiceReference: string | null; claimant: { id: string; name: string } | null; currency: string; amount: number; gstTreatment: GstTreatment;
  gstSupply: "INTRA_STATE" | "INTER_STATE" | null; gstRate: number; taxAmount: number; total: number; settlement: "PAID" | "PAYABLE"; paymentMethod: string | null;
  paidFrom: { id: string; label: string } | null; paidAt: string | null; department: { id: string; name: string } | null; costCenter: { id: string; name: string } | null;
  notes: string | null; noReceiptReason: string | null; files: number; submittedBy: string | null; submittedById: string | null; submittedAt: string | null;
  approvedBy: string | null; approvedAt: string | null; rejectionReason: string | null; cancelledBy: string | null; cancelledAt: string | null; cancelReason: string | null;
  journalEntryId: string | null; journalNumber: string | null; paymentJournalEntryId: string | null; paymentJournalNumber: string | null; reversalJournalEntryId: string | null;
  reversalJournalNumber: string | null; reversedAt: string | null; reversedBy: string | null; reversalReason: string | null; createdBy: string | null; createdById: string | null;
  createdAt: string; version: number; canApprove: boolean;
};
export type ExpenseFile = { id: string; fileName: string; mimeType: string; sizeBytes: number; uploadedAt: string };
export type ExpenseRecord = Expense & {
  fileList: ExpenseFile[]; evidence: { needed: boolean; threshold: number; satisfied: boolean };
  similar: Array<{ id: string; number: string; date: string; status: ExpenseStatus }>;
  history: Array<{ label: string; at: string; actor: string | null; detail: string | null }>;
};
export type ExpenseCounts = { toApprove: number; toPay: number; owed: number; drafts: number; thisMonth: number };
export type ExpenseOptions = {
  today: string; baseCurrency: string; approvalRequired: boolean; categories: ExpenseCategory[]; accounts: Array<{ id: string; label: string; cash: boolean }>;
  suppliers: Array<{ id: string; name: string; gstin: string | null }>; people: Array<{ id: string; name: string }>; departments: Array<{ id: string; name: string }>;
  costCenters: Array<{ id: string; name: string; departmentId: string | null }>;
};
export type ExpenseInput = {
  categoryId: string; date: string; description: string; amount: string; partyId?: string | null; payeeName?: string | null; supplierGstin?: string | null;
  supplierInvoiceReference?: string | null; gstTreatment: GstTreatment; gstSupply?: "INTRA_STATE" | "INTER_STATE" | null; gstRate?: string | null; settlement: "PAID" | "PAYABLE";
  paidFromAccountId?: string | null; paymentMethod?: string | null; claimantUserId?: string | null; departmentId?: string | null; costCenterId?: string | null;
  notes?: string | null; noReceiptReason?: string | null; submit?: boolean; version?: number; idempotencyKey?: string;
};
export const listExpenses = (filters: Record<string, string | undefined>) => call<{ expenses: Expense[]; counts: ExpenseCounts }>(`/expenses${qs(filters)}`);
export const getExpense = (id: string) => call<{ expense: ExpenseRecord }>(`/expenses/${id}`).then((r) => r.expense);
export const expenseOptions = () => call<{ options: ExpenseOptions }>("/expenses/options").then((r) => r.options);
export const createExpense = (input: ExpenseInput) => post<{ expense: ExpenseRecord }>("/expenses", input).then((r) => r.expense);
export const updateExpense = (id: string, input: ExpenseInput) => patch<{ expense: ExpenseRecord }>(`/expenses/${id}`, input).then((r) => r.expense);
export type ExpenseStep = "submit" | "approve" | "reject" | "cancel" | "pay" | "reverse";
export const expenseStep = (id: string, step: ExpenseStep, input: { reason?: string; paidFromAccountId?: string; date?: string; paymentMethod?: string } = {}) =>
  post<{ expense: ExpenseRecord }>(`/expenses/${id}/${step}`, input).then((r) => r.expense);
export const uploadExpenseFile = (id: string, file: File) => {
  const form = new FormData();
  form.set("file", file);
  return call<{ file: ExpenseFile }>(`/expenses/${id}/files`, { method: "POST", body: form }).then((r) => r.file);
};
export const removeExpenseFile = (id: string, fileId: string) => call(`/expenses/${id}/files/${fileId}`, { method: "DELETE", body: JSON.stringify({}) });
export const expenseFileHref = (id: string, fileId: string) => `/api/accounting/expenses/${id}/files/${fileId}`;

export const EXPENSE_STATE: Record<ExpenseState, { label: string; tone: "neutral" | "info" | "success" | "warning" | "danger" }> = {
  DRAFT: { label: "Draft", tone: "neutral" }, SUBMITTED: { label: "Awaiting approval", tone: "info" }, REJECTED: { label: "Sent back", tone: "warning" },
  TO_PAY: { label: "To pay", tone: "warning" }, PAID: { label: "Paid", tone: "success" }, REVERSED: { label: "Reversed", tone: "danger" }, CANCELLED: { label: "Cancelled", tone: "neutral" },
};
export const GST_TREATMENTS: Array<[GstTreatment, string]> = [["NO_GST", "No GST on the bill"], ["GST_CLAIM_ITC", "GST — claim input tax credit"], ["GST_NO_ITC", "GST — no credit (blocked or not eligible)"]];
export const PAYMENT_METHODS: Array<[string, string]> = [["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["bank_transfer", "Bank transfer"], ["cheque", "Cheque"], ["other", "Other"]];
export const methodLabel = (value: string | null) => PAYMENT_METHODS.find(([key]) => key === value)?.[1] ?? "—";
export { inr, cents, fromCents } from "@/features/accounting/receivables/api/receivables-api";
