async function parseResponse(response) {
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.ok === false) {
    throw new Error(payload.message || "Billing request failed.");
  }
  return payload;
}

export function createBillingClient({ baseUrl = "", fetchImpl = fetch } = {}) {
  const request = (path, options) =>
    fetchImpl(`${baseUrl}${path}`, options).then(parseResponse);

  return Object.freeze({
    listPlans: () => request("/api/billing/plans"),
    getSummary: () => request("/api/billing/summary"),
    createCheckout: (planPriceId, users) =>
      request("/api/billing/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planPriceId, users }),
      }),
    verifyCheckout: (payload) =>
      request("/api/billing/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
    changeSeats: (users) =>
      request("/api/billing/seats", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ users }),
      }),
    cancelSubscription: (cancelAtCycleEnd = true) =>
      request("/api/billing/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cancelAtCycleEnd }),
      }),
    updateProfile: (payload) =>
      request("/api/billing/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      }),
  });
}
