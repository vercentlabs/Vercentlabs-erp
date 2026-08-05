function normalizeRoot(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function readResponse(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with ${response.status}.`);
  }
  return body;
}

export function createManufacturingClient({
  baseUrl = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = normalizeRoot(baseUrl);

  const request = async (path, init = {}) =>
    readResponse(
      await fetchImpl(`${base}/api/manufacturing${path}`, {
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
    dashboard: () => request("/dashboard"),
    list: (resource, filters = {}) => {
      const query = new URLSearchParams(
        Object.entries(filters)
          .filter(
            ([, value]) =>
              value !== undefined && value !== null && value !== "",
          )
          .map(([key, value]) => [key, String(value)]),
      );
      return request(
        `/resources/${encodeURIComponent(resource)}${query.size ? `?${query}` : ""}`,
      );
    },
    create: (resource, input) =>
      request(`/resources/${encodeURIComponent(resource)}`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    releaseWorkOrder: (id) =>
      request(`/work-orders/${encodeURIComponent(id)}/release`, {
        method: "POST",
      }),
    startWorkOrder: (id) =>
      request(`/work-orders/${encodeURIComponent(id)}/start`, {
        method: "POST",
      }),
    postProduction: (id, input) =>
      request(`/work-orders/${encodeURIComponent(id)}/production`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
  });
}
