function root(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function unwrap(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with ${response.status}.`);
  }
  return body;
}

export function createQualityClient({
  baseUrl = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const base = root(baseUrl);
  const request = async (path, init = {}) =>
    unwrap(
      await fetchImpl(`${base}/api/quality${path}`, {
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
    list: (resource, query = {}) => {
      const params = new URLSearchParams(
        Object.entries(query)
          .filter(
            ([, value]) =>
              value !== undefined && value !== null && value !== "",
          )
          .map(([key, value]) => [key, String(value)]),
      );
      return request(
        `/resources/${encodeURIComponent(resource)}${params.size ? `?${params}` : ""}`,
      );
    },
    create: (resource, input) =>
      request(`/resources/${encodeURIComponent(resource)}`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    inspectionAction: (id, action, input = {}) =>
      request(`/inspections/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, ...input }),
      }),
    nonconformanceAction: (id, action, input = {}) =>
      request(`/non-conformances/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, ...input }),
      }),
  });
}
