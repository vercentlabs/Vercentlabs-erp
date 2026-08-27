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

test("F013 mobile client exposes governed Call create/start/complete/cancel endpoints with idempotency", async () => {
  const calls = [];
  const client = createMobileClient({
    baseUrl: "https://erp.example.com",
    tokenStore: createMemoryTokenStore(),
    requestIdFactory: () => "request-f013",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true });
    },
  });

  await client.createCall({ mode: "schedule", subject: "Call customer" }, "idem-create");
  await client.startCall("call-1", { expectedStatus: "planned" }, "idem-start");
  await client.completeCall("call-1", { outcomeCode: "connected" }, "idem-complete");
  await client.cancelCall("call-2", { expectedStatus: "planned" }, "idem-cancel");

  assert.deepEqual(calls.map((entry) => entry.url), [
    "https://erp.example.com/api/mobile/v1/crm/calls",
    "https://erp.example.com/api/mobile/v1/crm/calls/call-1/start",
    "https://erp.example.com/api/mobile/v1/crm/calls/call-1/complete",
    "https://erp.example.com/api/mobile/v1/crm/calls/call-2/cancel",
  ]);
  assert.ok(calls.every((entry) => entry.init.method === "POST"));
  assert.deepEqual(calls.map((entry) => entry.init.headers.get("idempotency-key")), [
    "idem-create", "idem-start", "idem-complete", "idem-cancel",
  ]);
});


test("F014 mobile client exposes governed Meeting create/start/complete/cancel endpoints with idempotency", async () => {
  const calls = [];
  const client = createMobileClient({
    baseUrl: "https://erp.example.com",
    tokenStore: createMemoryTokenStore(),
    requestIdFactory: () => "request-f014",
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return jsonResponse({ ok: true });
    },
  });

  await client.createMeeting({ mode: "schedule", subject: "Customer review", startAt: "2026-08-28T10:00:00Z", endAt: "2026-08-28T10:30:00Z" }, "idem-meeting-create");
  await client.startMeeting("meeting-1", { expectedStatus: "planned" }, "idem-meeting-start");
  await client.completeMeeting("meeting-1", { outcomeCode: "held" }, "idem-meeting-complete");
  await client.cancelMeeting("meeting-2", { expectedStatus: "planned" }, "idem-meeting-cancel");

  assert.deepEqual(calls.map((entry) => entry.url), [
    "https://erp.example.com/api/mobile/v1/crm/meetings",
    "https://erp.example.com/api/mobile/v1/crm/meetings/meeting-1/start",
    "https://erp.example.com/api/mobile/v1/crm/meetings/meeting-1/complete",
    "https://erp.example.com/api/mobile/v1/crm/meetings/meeting-2/cancel",
  ]);
  assert.ok(calls.every((entry) => entry.init.method === "POST"));
  assert.deepEqual(calls.map((entry) => entry.init.headers.get("idempotency-key")), [
    "idem-meeting-create", "idem-meeting-start", "idem-meeting-complete", "idem-meeting-cancel",
  ]);
});
