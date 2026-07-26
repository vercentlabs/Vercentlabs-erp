import assert from "node:assert/strict";
import test from "node:test";

import {
  VercentlabsApiError,
  createMemoryTokenStore,
  createMobileClient,
} from "../src/mobile.js";

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json",
      "x-request-id": "request-123",
    },
  });
}

test("mobile login sends device context and persists returned tokens", async () => {
  const calls = [];
  const tokens = createMemoryTokenStore();
  const client = createMobileClient({
    baseUrl: "https://erp.example.com/",
    tokenStore: tokens,
    requestIdFactory: () => "request-123",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        ok: true,
        accessToken: "access-token",
        refreshToken: "refresh-token",
        session: { user: { id: "user-1" } },
      });
    },
  });

  await client.login({
    email: "sales@example.com",
    password: "not-recorded",
    device: {
      deviceId: "00000000-0000-4000-8000-000000000001",
      platform: "android",
      deviceName: "Pixel",
      appVersion: "1.0.0",
    },
  });

  assert.equal(
    calls[0].url,
    "https://erp.example.com/api/mobile/v1/auth/login",
  );
  assert.equal(calls[0].init.headers.get("authorization"), null);
  assert.equal(await tokens.getAccessToken(), "access-token");
});

test("concurrent unauthorized requests share one rotating refresh", async () => {
  const tokens = createMemoryTokenStore({
    accessToken: "expired",
    refreshToken: "refresh-1",
  });
  let refreshCalls = 0;
  const client = createMobileClient({
    baseUrl: "https://erp.example.com",
    tokenStore: tokens,
    requestIdFactory: () => "request-123",
    fetchImpl: async (url, init) => {
      if (url.endsWith("/auth/refresh")) {
        refreshCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 5));
        return jsonResponse({
          ok: true,
          accessToken: "access-2",
          refreshToken: "refresh-2",
          session: {},
        });
      }
      if (init.headers.get("authorization") === "Bearer expired") {
        return jsonResponse({ ok: false, message: "Expired" }, 401);
      }
      return jsonResponse({ ok: true, value: "ready" });
    },
  });

  const [first, second] = await Promise.all([
    client.request("/one"),
    client.request("/two"),
  ]);
  assert.equal(first.value, "ready");
  assert.equal(second.value, "ready");
  assert.equal(refreshCalls, 1);
  assert.equal(await tokens.getRefreshToken(), "refresh-2");
});

test("mobile client exposes stable actionable errors", async () => {
  const client = createMobileClient({
    baseUrl: "https://erp.example.com",
    tokenStore: createMemoryTokenStore(),
    fetchImpl: async () =>
      jsonResponse(
        { ok: false, message: "Too many attempts.", code: "RATE_LIMITED" },
        429,
      ),
  });
  await assert.rejects(
    () => client.health(),
    (error) =>
      error instanceof VercentlabsApiError &&
      error.status === 429 &&
      error.code === "RATE_LIMITED" &&
      error.retryable,
  );
});


test("invalid refresh clears tokens and notifies the application shell", async () => {
  const tokens = createMemoryTokenStore({
    accessToken: "expired",
    refreshToken: "invalid-refresh",
  });
  const failures = [];
  const client = createMobileClient({
    baseUrl: "https://erp.example.com",
    tokenStore: tokens,
    requestIdFactory: () => "request-123",
    fetchImpl: async (url) =>
      url.endsWith("/auth/refresh")
        ? jsonResponse(
            { ok: false, message: "Sign in again.", code: "SESSION_REQUIRED" },
            401,
          )
        : jsonResponse({ ok: false, message: "Expired" }, 401),
  });
  const unsubscribe = client.setAuthenticationFailureHandler((error) => {
    failures.push(error.code);
  });

  await assert.rejects(() => client.session(), VercentlabsApiError);
  assert.equal(await tokens.getAccessToken(), null);
  assert.deepEqual(failures, ["SESSION_REQUIRED"]);
  unsubscribe();
});
