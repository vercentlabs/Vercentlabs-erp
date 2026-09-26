import assert from "node:assert/strict";
import test from "node:test";

import { createSecureRoute, isMutationRequest, type SecureRouteDeps } from "./secure-route.ts";

// Proves the security ordering of the Shared Access route composition with
// fake primitives. The real primitives (origin check, session resolution,
// snapshot, authorize) have their own tests in services/api; here the point
// is that the composition cannot skip or reorder them.

type Session = { organizationId: string; userId: string };
type Client = { id: string };

const ORG = "11111111-1111-4111-8111-111111111111";

function harness(overrides: Partial<SecureRouteDeps<Session, Client>> & { allow?: boolean } = {}) {
  const calls: string[] = [];
  const principal = {
    kind: "user",
    userId: "u-1",
    organizationId: ORG,
  } as unknown as ReturnType<SecureRouteDeps<Session, Client>["createPrincipal"]>;
  const deps: SecureRouteDeps<Session, Client> = {
    assertOrigin: (request) => {
      calls.push("origin");
      if (request.headers.get("origin") !== "https://erp.example") {
        throw Object.assign(new Error("Cross-origin request rejected."), { status: 403, code: "ORIGIN_REJECTED" });
      }
    },
    requireSession: async () => {
      calls.push("session");
      return { organizationId: ORG, userId: "u-1" };
    },
    runTenant: async (organizationId, work) => {
      calls.push(`tenant:${organizationId}`);
      return work({ id: "tenant-client" });
    },
    runOrganizationConnection: async (organizationId, work) => {
      calls.push(`connection:${organizationId}`);
      return work({ id: "organization-connection" });
    },
    createPrincipal: () => {
      calls.push("principal");
      return principal;
    },
    buildSnapshot: async () => {
      calls.push("snapshot");
      return { principal } as unknown as Awaited<ReturnType<SecureRouteDeps<Session, Client>["buildSnapshot"]>>;
    },
    authorize: (input) => {
      calls.push(`authorize:${input.module ?? "-"}:${input.permission ?? "-"}`);
      return overrides.allow === false
        ? { allowed: false, code: "PERMISSION_DENIED", status: 403, module: input.module ?? null, permission: input.permission ?? null, action: null, reason: null, conceal: false }
        : { allowed: true, principal, module: input.module ?? null, action: null };
    },
    denialToError: (decision) => Object.assign(new Error("denied"), { status: decision.status, code: decision.code }),
    onDenied: () => calls.push("denied-logged"),
    requireBillingWrite: async () => {
      calls.push("billing");
    },
    toErrorResponse: (error) => {
      const status = (error as { status?: number }).status ?? 500;
      const code = (error as { code?: string }).code ?? "ERROR";
      calls.push(`error:${status}:${code}`);
      return new Response(JSON.stringify({ ok: false, code }), { status });
    },
    ...overrides,
  };
  return { calls, route: createSecureRoute(deps) };
}

const post = (origin: string | null = "https://erp.example") =>
  new Request("https://erp.example/api/thing", { method: "POST", headers: origin ? { origin } : {} });

test("safe methods are not treated as mutations; everything else is", () => {
  assert.equal(isMutationRequest(new Request("https://x.test", { method: "GET" })), false);
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    assert.equal(isMutationRequest(new Request("https://x.test", { method })), true, method);
  }
});

test("a mutation without origin protection is rejected before any session or database work", async () => {
  const { calls, route } = harness();
  let ran = false;
  const response = await route(post(null), { module: "crm" }, async () => {
    ran = true;
    return new Response("ok");
  });
  assert.equal(response.status, 403);
  assert.equal(ran, false);
  assert.deepEqual(calls, ["origin", "error:403:ORIGIN_REJECTED"]);
});

test("a mutation without an authenticated workspace is rejected before any database work", async () => {
  const { calls, route } = harness({
    requireSession: async () => {
      throw Object.assign(new Error("Authentication is required."), { status: 401, code: "AUTH_REQUIRED" });
    },
  });
  const response = await route(post(), { module: "crm" }, async () => new Response("ok"));
  assert.equal(response.status, 401);
  assert.deepEqual(calls, ["origin", "error:401:AUTH_REQUIRED"]);
});

test("an authorized mutation runs origin → session → tenant transaction → snapshot → authorize → billing → handler", async () => {
  const { calls, route } = harness();
  const response = await route(post(), { module: "crm", permission: "crm.settings.manage", billingWrite: true }, async ({ client, principal }) => {
    calls.push(`handler:${client.id}:${principal.organizationId}`);
    return new Response("created", { status: 201 });
  });
  assert.equal(response.status, 201);
  assert.deepEqual(calls, [
    "origin",
    "session",
    `tenant:${ORG}`,
    "snapshot",
    "authorize:crm:crm.settings.manage",
    "billing",
    `handler:tenant-client:${ORG}`,
  ]);
});

test("a denied authorization is logged, never reaches the handler, and skips the billing gate", async () => {
  const { calls, route } = harness({ allow: false });
  let ran = false;
  const response = await route(post(), { module: "crm", permission: "crm.settings.manage", billingWrite: true }, async () => {
    ran = true;
    return new Response("ok");
  });
  assert.equal(response.status, 403);
  assert.equal(ran, false);
  assert.ok(calls.includes("denied-logged"));
  assert.ok(!calls.includes("billing"));
});

test("reads skip the origin check; permission-only routes skip the snapshot; every request runs under the session's organisation", async () => {
  const { calls, route } = harness();
  const get = new Request("https://erp.example/api/thing", { method: "GET" });
  await route(get, { permission: "roles.manage" }, async () => new Response("ok"));
  assert.deepEqual(calls, ["session", `tenant:${ORG}`, "principal", "authorize:-:roles.manage"]);
});

test("the tenant for the transaction always comes from the session, never the request", async () => {
  const { calls, route } = harness();
  const spoof = new Request("https://erp.example/api/thing?organizationId=22222222-2222-4222-8222-222222222222", {
    method: "POST",
    headers: { origin: "https://erp.example", "content-type": "application/json" },
    body: JSON.stringify({ organizationId: "22222222-2222-4222-8222-222222222222" }),
  });
  await route(spoof, {}, async () => new Response("ok"));
  assert.ok(calls.includes(`tenant:${ORG}`));
});

test("billingWrite on a read is a programming error, surfaced as an error response", async () => {
  const { calls, route } = harness();
  const response = await route(new Request("https://erp.example/api/thing"), { billingWrite: true }, async () => new Response("ok"));
  assert.equal(response.status, 500);
  assert.deepEqual(calls, ["error:500:ERROR"]);
});

test("auditDenial: an authenticated domain denial is logged and durably recorded; a broken recorder never turns 403 into 500", async () => {
  const recorded: string[] = [];
  const logged: string[] = [];
  const denial = () => Object.assign(new Error("outside your scope"), { status: 403, code: "ACCESS_ADMIN_OUT_OF_SCOPE" });
  const { route } = harness({
    recordDeniedAccess: async (event) => {
      recorded.push(`${event.status}:${event.code}:${event.action}`);
    },
    logDeniedAccess: (event) => {
      logged.push(String(event.code));
    },
  });
  const response = await route(post(), { action: "settings.user_access.update", auditDenial: true }, async () => {
    throw denial();
  });
  assert.equal(response.status, 403);
  assert.deepEqual(recorded, ["403:ACCESS_ADMIN_OUT_OF_SCOPE:settings.user_access.update"]);
  assert.deepEqual(logged, ["ACCESS_ADMIN_OUT_OF_SCOPE"]);

  const failing = harness({
    recordDeniedAccess: async () => {
      throw new Error("audit database unavailable");
    },
  });
  const stillForbidden = await failing.route(post(), { auditDenial: true }, async () => {
    throw denial();
  });
  assert.equal(stillForbidden.status, 403);
});

test("auditDenial is opt-in and never records unauthenticated requests", async () => {
  const recorded: unknown[] = [];
  const optedOut = harness({ recordDeniedAccess: async (event) => void recorded.push(event) });
  await optedOut.route(post(), {}, async () => {
    throw Object.assign(new Error("no"), { status: 403, code: "PERMISSION_DENIED" });
  });
  const anonymous = harness({
    requireSession: async () => {
      throw Object.assign(new Error("Authentication is required."), { status: 401, code: "AUTH_REQUIRED" });
    },
    recordDeniedAccess: async (event) => void recorded.push(event),
  });
  const response = await anonymous.route(post(), { auditDenial: true }, async () => new Response("ok"));
  assert.equal(response.status, 401);
  assert.deepEqual(recorded, []);
});

test("transaction \"none\" runs the handler on an organisation connection without a request transaction (billing sagas)", async () => {
  const { route, calls } = harness();
  let client: Client | null = null;
  const response = await route(
    new Request("https://erp.example/api/billing/checkout", { method: "POST", headers: { origin: "https://erp.example" } }),
    { permission: "billing.checkout", transaction: "none", billingWrite: true },
    async (context) => {
      client = context.client;
      return new Response("ok");
    },
  );
  assert.equal(response.status, 200);
  assert.deepEqual(client, { id: "organization-connection" });
  assert.ok(calls.includes(`connection:${ORG}`));
  assert.ok(!calls.some((call) => call.startsWith("tenant:")), "no request-wide transaction");
  assert.ok(calls.indexOf("origin") < calls.indexOf(`connection:${ORG}`), "origin is still checked first");
});
