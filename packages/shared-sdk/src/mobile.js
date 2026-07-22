function normalizeBaseUrl(value) {
  const root = String(value || "").replace(/\/+$/, "");
  if (!root) throw new TypeError("A mobile API base URL is required.");
  return root;
}

function requestId() {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
}

export class VercentApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "VercentApiError";
    this.status = options.status || 0;
    this.code = options.code || "REQUEST_FAILED";
    this.requestId = options.requestId || null;
    this.details = options.details || null;
    this.retryable =
      options.retryable ??
      (this.status === 0 || this.status === 429 || this.status >= 500);
  }
}

async function parseResponse(response) {
  const contentType = response.headers?.get?.("content-type") || "";
  const payload = contentType.includes("application/json")
    ? await response.json().catch(() => ({}))
    : await response.text().catch(() => "");
  if (!response.ok || payload?.ok === false) {
    const message =
      payload && typeof payload === "object" && payload.message
        ? String(payload.message)
        : `Request failed with status ${response.status}.`;
    throw new VercentApiError(message, {
      status: response.status,
      code: payload?.code || "REQUEST_FAILED",
      requestId: response.headers?.get?.("x-request-id") || payload?.requestId,
      details: payload?.errors || payload?.details || null,
    });
  }
  return payload;
}

export function createMemoryTokenStore(initial = null) {
  let tokens = initial;
  return Object.freeze({
    async getAccessToken() {
      return tokens?.accessToken || null;
    },
    async getRefreshToken() {
      return tokens?.refreshToken || null;
    },
    async setTokens(next) {
      tokens = { ...next };
    },
    async clear() {
      tokens = null;
    },
  });
}

export function createMobileClient({
  baseUrl,
  tokenStore,
  fetchImpl = globalThis.fetch,
  timeoutMs = 15_000,
  clientVersion = "unknown",
  requestIdFactory = requestId,
} = {}) {
  if (typeof fetchImpl !== "function")
    throw new TypeError("A fetch implementation is required.");
  if (!tokenStore) throw new TypeError("A mobile token store is required.");
  const root = `${normalizeBaseUrl(baseUrl)}/api/mobile/v1`;
  let refreshPromise = null;

  async function perform(path, init = {}, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const headers = new Headers(init.headers || {});
    headers.set("Accept", "application/json");
    headers.set("X-Vercent-Client", `mobile/${clientVersion}`);
    headers.set("X-Request-ID", options.requestId || requestIdFactory());
    if (init.body && !headers.has("Content-Type")) {
      headers.set("Content-Type", "application/json");
    }
    if (options.idempotencyKey) {
      headers.set("Idempotency-Key", options.idempotencyKey);
    }
    if (options.authenticated !== false) {
      const token = await tokenStore.getAccessToken();
      if (token) headers.set("Authorization", `Bearer ${token}`);
    }

    try {
      const response = await fetchImpl(`${root}${path}`, {
        ...init,
        headers,
        signal: controller.signal,
      });
      if (
        response.status === 401 &&
        options.authenticated !== false &&
        options.retryAfterRefresh !== false
      ) {
        await refresh();
        return perform(path, init, {
          ...options,
          retryAfterRefresh: false,
          requestId: requestIdFactory(),
        });
      }
      return await parseResponse(response);
    } catch (error) {
      if (error instanceof VercentApiError) throw error;
      if (error?.name === "AbortError") {
        throw new VercentApiError(
          "The request timed out. Check your connection and try again.",
          {
            code: "REQUEST_TIMEOUT",
            retryable: true,
          },
        );
      }
      throw new VercentApiError("The server could not be reached.", {
        code: "NETWORK_ERROR",
        retryable: true,
        details: error instanceof Error ? { cause: error.message } : null,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  async function refresh() {
    if (!refreshPromise) {
      refreshPromise = (async () => {
        const refreshToken = await tokenStore.getRefreshToken();
        if (!refreshToken) {
          await tokenStore.clear();
          throw new VercentApiError("Sign in to continue.", {
            status: 401,
            code: "SESSION_REQUIRED",
            retryable: false,
          });
        }
        try {
          const payload = await perform(
            "/auth/refresh",
            { method: "POST", body: JSON.stringify({ refreshToken }) },
            { authenticated: false, retryAfterRefresh: false },
          );
          await tokenStore.setTokens({
            accessToken: payload.accessToken,
            refreshToken: payload.refreshToken,
            accessExpiresAt: payload.accessExpiresAt,
            refreshExpiresAt: payload.refreshExpiresAt,
          });
          return payload;
        } catch (error) {
          if (error instanceof VercentApiError && error.status === 401) {
            await tokenStore.clear();
          }
          throw error;
        }
      })().finally(() => {
        refreshPromise = null;
      });
    }
    return refreshPromise;
  }

  return Object.freeze({
    async login(input) {
      const payload = await perform(
        "/auth/login",
        { method: "POST", body: JSON.stringify(input) },
        { authenticated: false, retryAfterRefresh: false },
      );
      await tokenStore.setTokens({
        accessToken: payload.accessToken,
        refreshToken: payload.refreshToken,
        accessExpiresAt: payload.accessExpiresAt,
        refreshExpiresAt: payload.refreshExpiresAt,
      });
      return payload;
    },
    refresh,
    async logout() {
      try {
        return await perform("/auth/logout", { method: "POST" });
      } finally {
        await tokenStore.clear();
      }
    },
    session() {
      return perform("/session");
    },
    health() {
      return perform(
        "/health",
        {},
        { authenticated: false, retryAfterRefresh: false },
      );
    },
    crmDashboard() {
      return perform("/crm/dashboard");
    },
    listCrm(resource, query = {}) {
      const allowed = new Set(["leads", "opportunities", "activities", "pipeline-stages"]);
      if (!allowed.has(resource)) throw new TypeError("Unknown mobile CRM resource.");
      const search = new URLSearchParams();
      for (const [key, value] of Object.entries(query)) {
        if (value !== undefined && value !== null && value !== "") search.set(key, String(value));
      }
      return perform(`/crm/${resource}${search.size ? `?${search}` : ""}`);
    },
    getCrm(resource, id) {
      const allowed = new Set(["leads", "opportunities", "activities", "pipeline-stages"]);
      if (!allowed.has(resource)) throw new TypeError("Unknown mobile CRM resource.");
      return perform(`/crm/${resource}/${encodeURIComponent(id)}`);
    },
    updateCrm(resource, id, input, idempotencyKey = requestIdFactory()) {
      const allowed = new Set(["leads", "opportunities", "activities"]);
      if (!allowed.has(resource)) throw new TypeError("Unknown writable mobile CRM resource.");
      return perform(`/crm/${resource}/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(input) }, { idempotencyKey });
    },
    createCrm(resource, input, idempotencyKey = requestIdFactory()) {
      const allowed = new Set(["leads", "opportunities", "activities"]);
      if (!allowed.has(resource)) throw new TypeError("Unknown writable mobile CRM resource.");
      return perform(`/crm/${resource}`, { method: "POST", body: JSON.stringify(input) }, { idempotencyKey });
    },
    completeActivity(id, outcome, idempotencyKey = requestIdFactory()) {
      return perform(`/crm/activities/${encodeURIComponent(id)}/complete`, { method: "POST", body: JSON.stringify({ outcome }) }, { idempotencyKey });
    },
    moveOpportunity(id, stageId, note, idempotencyKey = requestIdFactory()) {
      return perform(`/crm/opportunities/${encodeURIComponent(id)}/stage`, { method: "POST", body: JSON.stringify({ stageId, note }) }, { idempotencyKey });
    },
    search(query) {
      return perform(`/search?q=${encodeURIComponent(query)}`);
    },
    notifications() {
      return perform("/notifications");
    },
    markNotifications(input) {
      return perform("/notifications", { method: "PATCH", body: JSON.stringify(input) });
    },
    request(path, init, options) {
      return perform(path, init, options);
    },
  });
}
