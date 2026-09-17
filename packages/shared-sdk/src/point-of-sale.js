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

    // Legacy direct sale-completion payload, retained for compatibility.
    completeSale: (input) => post("/sales", input),
    createReturn: (input) => post("/returns", input),
  });
}
