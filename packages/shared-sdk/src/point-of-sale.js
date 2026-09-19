// Real POS API contracts against apps/web/src/app/api/pos/**. This file
// previously targeted a "/api/point-of-sale" base path that no route in
// the repo ever served -- it was exported from the package index but
// never imported anywhere, effectively dead/misleading code. Rewritten
// this session (F277-F281) to match the actual route layer and to add
// the cart/promotion/coupon contracts that didn't exist before.
function root(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function unwrap(response) {
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body?.ok === false) {
    const error = new Error(body?.message || `Request failed with ${response.status}.`);
    error.status = response.status;
    error.code = body?.code;
    error.details = body?.details;
    throw error;
  }
  return body;
}

export function createPointOfSaleClient({ baseUrl = "", fetchImpl = globalThis.fetch } = {}) {
  const base = root(baseUrl);
  const request = async (path, init = {}) =>
    unwrap(
      await fetchImpl(`${base}/api/pos${path}`, {
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
        ...init,
      }),
    );
  const post = (path, body) => request(path, { method: "POST", body: JSON.stringify(body ?? {}) });
  const del = (path) => request(path, { method: "DELETE" });

  return Object.freeze({
    dashboard: () => request("/dashboard"),
    list: (resource, query = {}) => {
      const params = new URLSearchParams(
        Object.entries(query)
          .filter(([, value]) => value !== undefined && value !== null && value !== "")
          .map(([key, value]) => [key, String(value)]),
      );
      return request(`/${encodeURIComponent(resource)}${params.size ? `?${params}` : ""}`);
    },

    listStores: () => request("/stores"),
    createStore: (input) => post("/stores", input),
    listTerminals: () => request("/terminals"),
    createTerminal: (input) => post("/terminals", input),
    openShift: (input) => post("/shifts", input),
    closeShift: (id, input) => post(`/shifts/${encodeURIComponent(id)}/close`, input),

    searchProducts: (storeId, query, limit) =>
      request(`/stores/${encodeURIComponent(storeId)}/products?q=${encodeURIComponent(query)}${limit ? `&limit=${limit}` : ""}`),
    lookupBarcode: (storeId, code) => request(`/stores/${encodeURIComponent(storeId)}/barcode/${encodeURIComponent(code)}`),

    // F276: bounded customer search against tenant.business_parties --
    // replaces trusting a cashier-typed customer UUID.
    searchCustomers: (query, { limit, offset } = {}) => {
      const params = new URLSearchParams({ q: query || "" });
      if (limit) params.set("limit", String(limit));
      if (offset) params.set("offset", String(offset));
      return request(`/customers?${params}`);
    },

    // F277 Cart
    createCart: (input) => post("/carts", input),
    getCart: (id) => request(`/carts/${encodeURIComponent(id)}`),
    addCartLine: (id, input) => post(`/carts/${encodeURIComponent(id)}/lines`, input),
    updateCartLineQuantity: (id, lineId, quantity, expectedVersion) =>
      request(`/carts/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}`, {
        method: "PATCH",
        body: JSON.stringify({ quantity, expectedVersion }),
      }),
    removeCartLine: (id, lineId, expectedVersion) =>
      del(`/carts/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`),
    applyLineDiscount: (id, lineId, input) => post(`/carts/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/discount`, input),
    removeLineDiscount: (id, lineId, expectedVersion) =>
      del(`/carts/${encodeURIComponent(id)}/lines/${encodeURIComponent(lineId)}/discount${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`),
    setCartDiscount: (id, input) => post(`/carts/${encodeURIComponent(id)}/discount`, input),
    setCartCustomer: (id, customerId, expectedVersion) => post(`/carts/${encodeURIComponent(id)}/customer`, { customerId, expectedVersion }),
    applyCoupon: (id, code, expectedVersion) => post(`/carts/${encodeURIComponent(id)}/coupon`, { code, expectedVersion }),
    removeCoupon: (id, expectedVersion) => del(`/carts/${encodeURIComponent(id)}/coupon${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`),
    holdCart: (id, expectedVersion) => post(`/carts/${encodeURIComponent(id)}/hold`, { expectedVersion }),
    resumeCart: (id) => post(`/carts/${encodeURIComponent(id)}/resume`),
    cancelCart: (id, reason) => post(`/carts/${encodeURIComponent(id)}/cancel`, { reason }),
    completeCart: (id, input) => post(`/carts/${encodeURIComponent(id)}/complete`, input),
    // F287/F288: the held-cart queue.
    listHeldCarts: (search) => request(`/carts/held${search ? `?q=${encodeURIComponent(search)}` : ""}`),

    // F289: receipts -- read-only, built entirely from persisted sale facts.
    getSaleReceipt: (saleId) => request(`/sales/${encodeURIComponent(saleId)}/receipt`),
    // F289 gap closure: records that a print was requested (never that a
    // physical printer confirmed output -- no code in this stack can
    // observe that). Response includes the server-derived original/reprint
    // classification.
    recordReceiptPrint: (saleId) => post(`/sales/${encodeURIComponent(saleId)}/receipt/print`),

    // F283 (card) / F284 (UPI/digital) / F285 (split tender) / F286
    // (multiple payment methods). initiatePayment starts a non-cash leg;
    // completeCart above only ever accepts that leg's id once it has
    // independently reached 'captured' -- never a client-asserted amount.
    initiatePayment: (input) => post("/payments/initiate", input),
    getPayment: (id) => request(`/payments/${encodeURIComponent(id)}`),
    refundPayment: (id, input) => post(`/payments/${encodeURIComponent(id)}/refund`, input),
    requestPaymentOverride: (id, reason) => post(`/payments/${encodeURIComponent(id)}/override`, { reason }),

    // F280 Promotions / F281 Coupons (admin configuration)
    listPromotions: (status) => request(`/promotions${status ? `?status=${status}` : ""}`),
    createPromotion: (input) => post("/promotions", input),
    updatePromotion: (id, input) =>
      request(`/promotions/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
    setPromotionActive: (id, active) => post(`/promotions/${encodeURIComponent(id)}/active`, { active }),
    listCoupons: (status) => request(`/coupons${status ? `?status=${status}` : ""}`),
    createCoupon: (input) => post("/coupons", input),
    updateCoupon: (id, input) => request(`/coupons/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
    setCouponActive: (id, active) => post(`/coupons/${encodeURIComponent(id)}/active`, { active }),

    // F268/F269: store/terminal edit + activate/deactivate/status.
    updateStore: (id, input) => request(`/stores/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
    setStoreActive: (id, active) => post(`/stores/${encodeURIComponent(id)}/active`, { active }),
    getStoreSetupOptions: () => request("/stores/setup-options"),
    updateTerminal: (id, input) => request(`/terminals/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }),
    setTerminalStatus: (id, status) => post(`/terminals/${encodeURIComponent(id)}/status`, { status }),

    // F270/F271: cashier eligibility administration.
    listEligibleCashiers: () => request("/cashiers"),
    listStoreAccess: (storeId) => request(`/store-access${storeId ? `?storeId=${encodeURIComponent(storeId)}` : ""}`),
    grantStoreAccess: (userId, storeId) => post("/store-access", { userId, storeId }),
    revokeStoreAccess: (userId, storeId) =>
      del(`/store-access?userId=${encodeURIComponent(userId)}&storeId=${encodeURIComponent(storeId)}`),

    // F291/F292/F293: returns, refunds, exchanges.
    findSaleForReturn: (receiptNumber) => request(`/returns/find?receiptNumber=${encodeURIComponent(receiptNumber)}`),
    listReturns: () => request("/returns"),
    approveReturn: (id, input) => post(`/returns/${encodeURIComponent(id)}/approve`, input),
    completeReturn: (id, input) => post(`/returns/${encodeURIComponent(id)}/complete`, input),
    completeExchange: (returnId, input) => post(`/returns/${encodeURIComponent(returnId)}/exchange`, input),

    // F300: paid-in/paid-out cash movements. idempotencyKey is required --
    // this mutation has no other replay protection.
    listCashMovements: (shiftId) => request(`/shifts/${encodeURIComponent(shiftId)}/cash-movements`),
    recordCashMovement: (shiftId, input) => post(`/shifts/${encodeURIComponent(shiftId)}/cash-movements`, input),

    // Legacy direct sale-completion payload, retained for compatibility.
    completeSale: (input) => post("/sales", input),
    createReturn: (input) => post("/returns", input),

    // F303 Day-end / Z report
    listDayEndReports: (query = {}) => {
      const params = new URLSearchParams(
        Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key, String(value)]),
      );
      return request(`/reports/day-end${params.size ? `?${params}` : ""}`);
    },
    getDayEndReport: (id) => request(`/reports/day-end/${encodeURIComponent(id)}`),
    generateDayEndReport: (input) => post("/reports/day-end", input),
    reviewDayEndReport: (id, input) => post(`/reports/day-end/${encodeURIComponent(id)}/review`, input),
    finalizeDayEndReport: (id, input) => post(`/reports/day-end/${encodeURIComponent(id)}/finalize`, input),
    recordDayEndVariance: (id, input) => post(`/reports/day-end/${encodeURIComponent(id)}/variance`, input),

    // F306 Loyalty
    redeemCartLoyaltyPoints: (id, points, expectedVersion) => post(`/carts/${encodeURIComponent(id)}/loyalty`, { points, expectedVersion }),
    removeCartLoyaltyRedemption: (id, expectedVersion) =>
      del(`/carts/${encodeURIComponent(id)}/loyalty${expectedVersion != null ? `?expectedVersion=${expectedVersion}` : ""}`),
    getLoyaltyProgram: () => request("/loyalty/program"),
    upsertLoyaltyProgram: (input) => post("/loyalty/program", input),
    setLoyaltyProgramActive: (active) => post("/loyalty/program/active", { active }),
    getCustomerLoyaltyBalance: (customerId) => request(`/loyalty/customers/${encodeURIComponent(customerId)}`),
    listCustomerLoyaltyLedger: (customerId, limit) =>
      request(`/loyalty/customers/${encodeURIComponent(customerId)}/ledger${limit ? `?limit=${limit}` : ""}`),
    adjustCustomerLoyaltyBalance: (customerId, points, reason) =>
      post(`/loyalty/customers/${encodeURIComponent(customerId)}/adjust`, { points, reason }),

    // F290 Invoice generation
    generateSaleInvoice: (saleId, input) => post(`/sales/${encodeURIComponent(saleId)}/invoice`, input),
    getSaleInvoice: (saleId) => request(`/sales/${encodeURIComponent(saleId)}/invoice`),
    listInvoices: (query = {}) => {
      const params = new URLSearchParams(
        Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key, String(value)]),
      );
      return request(`/invoices${params.size ? `?${params}` : ""}`);
    },

    // F304 Payment reconciliation
    importSettlementBatch: (input) => post("/settlements", input),
    generateReconciliation: (reportId, input) => post(`/reports/day-end/${encodeURIComponent(reportId)}/reconciliation`, input),
    listReconciliations: (query = {}) => {
      const params = new URLSearchParams(
        Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key, String(value)]),
      );
      return request(`/reconciliations${params.size ? `?${params}` : ""}`);
    },
    getReconciliation: (id) => request(`/reconciliations/${encodeURIComponent(id)}`),
    resolveReconciliation: (id, resolutionNotes) => post(`/reconciliations/${encodeURIComponent(id)}/resolve`, { resolutionNotes }),
    recordReconciliationCorrection: (id, input) => post(`/reconciliations/${encodeURIComponent(id)}/correction`, input),

    // F305 Accounting posting
    postSaleToAccounting: (saleId) => post(`/sales/${encodeURIComponent(saleId)}/accounting-post`),
    postReturnToAccounting: (returnId) => post(`/returns/${encodeURIComponent(returnId)}/accounting-post`),
    postDayEndReportToAccounting: (reportId) => post(`/reports/day-end/${encodeURIComponent(reportId)}/accounting-post`),
    listAccountingPostingQueue: (query = {}) => {
      const params = new URLSearchParams(
        Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key, String(value)]),
      );
      return request(`/accounting/posting-queue${params.size ? `?${params}` : ""}`);
    },

    // F307 Analytics
    getSalesAnalytics: (query = {}) => {
      const params = new URLSearchParams(
        Object.entries(query).filter(([, value]) => value !== undefined && value !== null && value !== "").map(([key, value]) => [key, String(value)]),
      );
      return request(`/analytics${params.size ? `?${params}` : ""}`);
    },
  });
}
