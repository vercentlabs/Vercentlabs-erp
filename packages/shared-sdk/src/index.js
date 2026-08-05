function normalizeBaseUrl(value) {
  return String(value || "").replace(/\/+$/, "");
}

async function readResponse(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  const body = contentType.includes("application/json")
    ? await response.json()
    : await response.text();

  if (!response.ok) {
    const message =
      typeof body === "object" && body && "message" in body
        ? body.message
        : `Request failed with status ${response.status}.`;
    throw new Error(String(message));
  }

  return body;
}

export function createBusinessDataClient({
  baseUrl = "",
  fetchImpl = globalThis.fetch,
} = {}) {
  if (typeof fetchImpl !== "function") {
    throw new TypeError("A fetch implementation is required.");
  }

  const root = normalizeBaseUrl(baseUrl);

  function endpoint(resource, suffix = "") {
    return `${root}/api/business-data/${encodeURIComponent(resource)}${suffix}`;
  }

  return Object.freeze({
    async list(resource, parameters = {}) {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(parameters)) {
        if (value !== undefined && value !== null && value !== "") {
          query.set(key, String(value));
        }
      }
      const suffix = query.size ? `?${query.toString()}` : "";
      return readResponse(
        await fetchImpl(endpoint(resource, suffix), {
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        }),
      );
    },

    async create(resource, input) {
      return readResponse(
        await fetchImpl(endpoint(resource), {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        }),
      );
    },

    async update(resource, id, input) {
      return readResponse(
        await fetchImpl(endpoint(resource, `/${encodeURIComponent(id)}`), {
          method: "PATCH",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify(input),
        }),
      );
    },

    async archive(resource, id) {
      return readResponse(
        await fetchImpl(endpoint(resource, `/${encodeURIComponent(id)}`), {
          method: "DELETE",
          credentials: "same-origin",
          headers: { Accept: "application/json" },
        }),
      );
    },

    async importRows(resource, rows, fileName = "") {
      return readResponse(
        await fetchImpl(endpoint(resource, "/import"), {
          method: "POST",
          credentials: "same-origin",
          headers: {
            Accept: "application/json",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ rows, fileName }),
        }),
      );
    },

    exportUrl(resource) {
      return endpoint(resource, "/export");
    },
  });
}
export * from "./crm.js";
export * from "./billing.js";
export * from "./mobile.js";

export * from "./accounting.js";

export * from "./procurement.js";
export * from "./stock.js";
export * from "./manufacturing.js";
export * from "./projects.js";
