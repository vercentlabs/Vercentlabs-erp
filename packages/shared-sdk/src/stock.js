function root(v) {
  return String(v || "").replace(/\/+$/, "");
}
async function read(r) {
  const b = await r.json();
  if (!r.ok) throw new Error(b?.message || `Request failed with ${r.status}.`);
  return b;
}
export function createStockClient({
  baseUrl = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = root(baseUrl);
  const req = async (path, init = {}) =>
    read(
      await fetchImpl(`${base}/api/stock${path}`, {
        credentials: "same-origin",
        headers: {
          Accept: "application/json",
          ...(init.body ? { "Content-Type": "application/json" } : {}),
          ...(init.headers || {}),
        },
        ...init,
      }),
    );
  return Object.freeze({
    dashboard: () => req("/dashboard"),
    list: (resource, filters = {}) => {
      const q = new URLSearchParams(
        Object.entries(filters)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => [k, String(v)]),
      );
      return req(
        `/resources/${encodeURIComponent(resource)}${q.size ? `?${q}` : ""}`,
      );
    },
    postMovement: (input) =>
      req("/movements", { method: "POST", body: JSON.stringify(input) }),
    createTransfer: (input) =>
      req("/transfers", { method: "POST", body: JSON.stringify(input) }),
    completeTransfer: (id) =>
      req(`/transfers/${encodeURIComponent(id)}/complete`, { method: "POST" }),
    reserve: (input) =>
      req("/reservations", { method: "POST", body: JSON.stringify(input) }),
    releaseReservation: (id) =>
      req(`/reservations/${encodeURIComponent(id)}/release`, {
        method: "POST",
      }),
  });
}
