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
    const error = new Error(
      payload?.message || `CRM request failed (${response.status}).`,
    );
    error.status = response.status;
    error.code = payload?.code || "CRM_REQUEST_FAILED";
    throw error;
  }
  return payload;
}

export function createCrmClient({ baseUrl = "", fetchImpl = fetch } = {}) {
  const request = async (path, init) =>
    readResponse(await fetchImpl(`${baseUrl}${path}`, init));

  return Object.freeze({
    list(resource, filters) {
      return request(`/api/crm/${resource}${encodeQuery(filters)}`);
    },
    get(resource, id) {
      return request(`/api/crm/${resource}/${id}`);
    },
    create(resource, input) {
      return request(`/api/crm/${resource}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },
    update(resource, id, input) {
      return request(`/api/crm/${resource}/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input),
      });
    },
    archive(resource, id) {
      return request(`/api/crm/${resource}/${id}`, { method: "DELETE" });
    },
    convertLead(id, input) {
      return request(`/api/crm/leads/${id}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(input || {}),
      });
    },
    mergeLead(id, targetLeadId) {
      return request(`/api/crm/leads/${id}/merge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetLeadId }),
      });
    },
    moveOpportunity(id, stageId, note) {
      return request(`/api/crm/opportunities/${id}/stage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stageId, note }),
      });
    },
    completeActivity(id, outcome) {
      return request(`/api/crm/activities/${id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
    },
    dashboard() {
      return request("/api/crm/dashboard");
    },
    report(name, filters) {
      return request(`/api/crm/reports/${name}${encodeQuery(filters)}`);
    },
  });
}
