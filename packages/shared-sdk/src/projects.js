function base(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function result(response) {
  const body = await response.json();
  if (!response.ok) {
    throw new Error(body?.message || `Request failed with ${response.status}.`);
  }
  return body;
}

export function createProjectsClient({
  baseUrl = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  const root = base(baseUrl);
  const request = async (path, init = {}) =>
    result(
      await fetchImpl(`${root}/api/projects${path}`, {
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
    transition: (id, action, input = {}) =>
      request(`/projects/${encodeURIComponent(id)}/actions`, {
        method: "POST",
        body: JSON.stringify({ action, ...input }),
      }),
    profitability: (id) =>
      request(`/projects/${encodeURIComponent(id)}/profitability`),
  });
}
