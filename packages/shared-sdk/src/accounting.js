function encodeQuery(input = {}) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    query.set(key, String(value));
  }
  const value = query.toString();
  return value ? `?${value}` : "";
}

async function readResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.message || `Accounting request failed (${response.status}).`);
    error.status = response.status;
    error.code = payload?.code || "ACCOUNTING_REQUEST_FAILED";
    throw error;
  }
  return payload;
}

export function createAccountingClient({ baseUrl = "", fetchImpl = fetch } = {}) {
  const request = async (path, init) => readResponse(await fetchImpl(`${baseUrl}${path}`, { credentials: "same-origin", ...init }));
  const create = (path, input) => request(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) });
  return Object.freeze({
    dashboard(filters) { return request(`/api/accounting/dashboard${encodeQuery(filters)}`); },
    options(companyId) { return request(`/api/accounting/options${encodeQuery({ companyId })}`); },
    journals(filters) { return request(`/api/accounting/journals${encodeQuery(filters)}`); },
    journal(id) { return request(`/api/accounting/journals/${id}`); },
    createJournal(input) { return create("/api/accounting/journals", input); },
    journalAction(id, action, input = {}) { return create(`/api/accounting/journals/${id}/actions`, { action, ...input }); },
    receivables(filters) { return request(`/api/accounting/receivables/invoices${encodeQuery(filters)}`); },
    receivable(id) { return request(`/api/accounting/receivables/invoices/${id}`); },
    createReceivable(input) { return create("/api/accounting/receivables/invoices", input); },
    receivableAction(id, action, input = {}) { return create(`/api/accounting/receivables/invoices/${id}/actions`, { action, ...input }); },
    receipts(filters) { return request(`/api/accounting/receivables/receipts${encodeQuery(filters)}`); },
    createReceipt(input) { return create("/api/accounting/receivables/receipts", input); },
    receiptAction(id, action, input = {}) { return create(`/api/accounting/receivables/receipts/${id}/actions`, { action, ...input }); },
    importSalesInvoiceRequest(id) { return create(`/api/accounting/receivables/sales-requests/${id}/import`, {}); },
    payables(filters) { return request(`/api/accounting/payables/bills${encodeQuery(filters)}`); },
    payable(id) { return request(`/api/accounting/payables/bills/${id}`); },
    createPayable(input) { return create("/api/accounting/payables/bills", input); },
    payableAction(id, action, input = {}) { return create(`/api/accounting/payables/bills/${id}/actions`, { action, ...input }); },
    payments(filters) { return request(`/api/accounting/payables/payments${encodeQuery(filters)}`); },
    createPayment(input) { return create("/api/accounting/payables/payments", input); },
    paymentAction(id, action, input = {}) { return create(`/api/accounting/payables/payments/${id}/actions`, { action, ...input }); },
    vendorBillMatch(id) { return request(`/api/accounting/payables/bills/${id}/matching`); },
    evaluateVendorBillMatch(id, input) { return create(`/api/accounting/payables/bills/${id}/matching`, { action: "evaluate", ...input }); },
    overrideVendorBillMatch(id, reason) { return create(`/api/accounting/payables/bills/${id}/matching`, { action: "override", reason }); },
    complianceRequests(filters) { return request(`/api/accounting/compliance/requests${encodeQuery(filters)}`); },
    createComplianceRequest(input) { return create("/api/accounting/compliance/requests", input); },
    updateComplianceRequest(id, input) { return request(`/api/accounting/compliance/requests/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }); },
    forecasts(filters) { return request(`/api/accounting/forecasts${encodeQuery(filters)}`); },
    createForecast(input) { return create("/api/accounting/forecasts", input); },
    forecast(id) { return request(`/api/accounting/forecasts/${id}`); },
    generateForecast(id, input = {}) { return create(`/api/accounting/forecasts/${id}/generate`, input); },
    assets(filters) { return request(`/api/accounting/assets${encodeQuery(filters)}`); },
    asset(id) { return request(`/api/accounting/assets/${id}`); },
    createAsset(input) { return create("/api/accounting/assets", input); },
    assetAction(id, action, input = {}) { return create(`/api/accounting/assets/${id}/actions`, { action, ...input }); },
    bankAccounts(filters) { return request(`/api/accounting/banking/accounts${encodeQuery(filters)}`); },
    createBankAccount(input) { return create("/api/accounting/banking/accounts", input); },
    bankStatements(filters) { return request(`/api/accounting/banking/statements${encodeQuery(filters)}`); },
    importBankStatement(input) { return create("/api/accounting/banking/statements", input); },
    bankStatement(id) { return request(`/api/accounting/banking/statements/${id}`); },
    bankStatementAction(id, action, input = {}) { return create(`/api/accounting/banking/statements/${id}/actions`, { action, ...input }); },
    bankReconciliationAction(id, action, input = {}) { return create(`/api/accounting/banking/reconciliations/${id}/actions`, { action, ...input }); },
    budgets() { return request("/api/accounting/budgets"); },
    createBudget(input) { return create("/api/accounting/budgets", input); },
    report(name, filters) { return request(`/api/accounting/reports/${name}${encodeQuery(filters)}`); },
    taxReturns(filters) { return request(`/api/accounting/tax/returns${encodeQuery(filters)}`); },
    createTaxReturn(input) { return create("/api/accounting/tax/returns", input); },
    taxReturnAction(id, action, input = {}) { return create(`/api/accounting/tax/returns/${id}/actions`, { action, ...input }); },
    closeRuns(filters) { return request(`/api/accounting/close${encodeQuery(filters)}`); },
    closeRun(id) { return request(`/api/accounting/close/${id}`); },
    createCloseRun(input) { return create("/api/accounting/close", input); },
    closeRunAction(id, action, input = {}) { return create(`/api/accounting/close/${id}/actions`, { action, ...input }); },
  });
}
