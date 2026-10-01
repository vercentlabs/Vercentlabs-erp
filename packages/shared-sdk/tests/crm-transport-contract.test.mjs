// CRM transport contract: every CRM endpoint the SDK clients call must exist in
// the Next.js route tree (apps/web/src/app/api) with a handler for that verb.
//
// Each client method is invoked against a recording fetch, so the verb and
// path are exactly what the client sends. The path is then resolved against
// the route files on disk the way Next.js does (a static segment beats
// [param], which beats [...catchAll]) and the matched route.ts must export
// the verb. No dev server is needed.
//
// Known gaps are listed by exact client, method, verb and route below. A new
// unlisted gap fails, and a listed gap that starts resolving fails too, so the
// list is removed as each defect is fixed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { createCrmClient } from "../src/crm.js";
import { createMobileClient } from "../src/mobile.js";

const apiRoot = fileURLToPath(new URL("../../../apps/web/src/app/api/", import.meta.url));
const VERBS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const RESOURCE = "__resource__";
const ID = "__id__";

function routeTable() {
  const routes = [];
  const walk = (dir, segments) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        // (group) folders do not appear in the URL.
        walk(full, /^\(.*\)$/.test(entry.name) ? segments : [...segments, entry.name]);
      } else if (/^route\.(ts|js)$/.test(entry.name)) {
        const source = fs.readFileSync(full, "utf8");
        const verbs = VERBS.filter((verb) =>
          new RegExp(`export\\s+(?:async\\s+)?function\\s+${verb}\\b|export\\s+const\\s+${verb}\\b|export\\s*\\{[^}]*\\b${verb}\\b[^}]*\\}`).test(source),
        );
        routes.push({ segments, verbs, file: path.relative(apiRoot, full).split(path.sep).join("/") });
      }
    }
  };
  walk(apiRoot, []);
  return routes;
}

const RANK = { static: 0, dynamic: 1, catchAll: 2, optionalCatchAll: 3 };
const kind = (segment) =>
  /^\[\[\.\.\..+\]\]$/.test(segment) ? "optionalCatchAll" : /^\[\.\.\..+\]$/.test(segment) ? "catchAll" : /^\[.+\]$/.test(segment) ? "dynamic" : "static";

function matches(routeSegments, urlSegments) {
  const ranks = [];
  let u = 0;
  for (const segment of routeSegments) {
    const k = kind(segment);
    if (k === "static") {
      if (urlSegments[u] !== segment) return null;
      u += 1;
    } else if (k === "dynamic") {
      if (u >= urlSegments.length) return null;
      u += 1;
    } else {
      if (k === "catchAll" && u >= urlSegments.length) return null;
      u = urlSegments.length;
    }
    ranks.push(RANK[k]);
  }
  return u === urlSegments.length ? ranks : null;
}

function resolve(routes, urlPath) {
  const urlSegments = urlPath.replace(/^\/api\//, "").split("/").filter(Boolean);
  let best = null;
  for (const route of routes) {
    const ranks = matches(route.segments, urlSegments);
    if (!ranks) continue;
    if (!best) { best = { route, ranks }; continue; }
    const length = Math.max(ranks.length, best.ranks.length);
    for (let i = 0; i < length; i += 1) {
      const a = ranks[i] ?? 9, b = best.ranks[i] ?? 9;
      if (a !== b) { if (a < b) best = { route, ranks }; break; }
    }
  }
  return best?.route ?? null;
}

const template = (urlPath) => urlPath.split("?")[0].replaceAll(RESOURCE, "{resource}").replaceAll(ID, "{id}");

function recordingFetch(sink) {
  return async (url, init = {}) => {
    const { pathname } = new URL(url, "https://erp.test");
    sink.push({ verb: String(init.method || "GET").toUpperCase(), path: pathname });
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

// Generic browser/server CRM client (packages/shared-sdk/src/crm.js).
const CRM_CLIENT_CALLS = {
  list: [RESOURCE, {}],
  get: [RESOURCE, ID],
  create: [RESOURCE, {}],
  update: [RESOURCE, ID, {}],
  archive: [RESOURCE, ID],
  convertLead: [ID, {}],
  mergeLead: [ID, ID],
  moveOpportunity: [ID, ID, "note"],
  completeActivity: [ID, "done"],
  dashboard: [],
  report: [RESOURCE, {}],
};

// CRM methods of the mobile client (packages/shared-sdk/src/mobile.js). Its
// non-CRM methods (auth, workspace, approvals, search, notifications) are
// outside this contract.
const MOBILE_CRM_CALLS = {
  crmDashboard: [],
  listCrm: ["leads", {}],
  getCrm: ["leads", ID],
  createCrm: ["leads", {}, "key"],
  updateCrm: ["leads", ID, {}, "key"],
  createCall: [{}, "key"],
  startCall: [ID, {}, "key"],
  completeCall: [ID, {}, "key"],
  cancelCall: [ID, {}, "key"],
  createMeeting: [{}, "key"],
  startMeeting: [ID, {}, "key"],
  completeMeeting: [ID, {}, "key"],
  cancelMeeting: [ID, {}, "key"],
  completeActivity: [ID, "done", "key", {}],
  moveOpportunity: [ID, ID, "note", "key", {}],
};
const MOBILE_NON_CRM = new Set([
  "setAuthenticationFailureHandler", "login", "logout", "refresh", "session", "workspace", "setWorkspaceContext", "setWorkspaceOrganization",
  "catalog", "health", "createApprovalRequest", "search", "notifications", "markNotifications",
  "listWorkspaceResource", "createWorkspaceResource", "updateWorkspaceResource", "archiveWorkspaceResource", "request", "apiRequest",
]);

// Known missing CRM routes. Each entry must still be missing; remove it when
// the route (or the client method) is fixed.
const MOBILE_V1_REMOVED = "The /api/mobile/v1 route tree (39 route files) was deleted in 49b80eeb (refactor(frontend)!: remove legacy ERP web frontend, 2026-09-14) and has not been restored; the mobile app's createMobileClient calls have no server route.";
const KNOWN_MISSING = [
  {
    client: "crm",
    method: "completeActivity",
    verb: "POST",
    route: "/api/crm/activities/{id}/complete",
    reason: "Known defect: the SDK completes activities through a route that does not exist (completion is per activity type: calls, meetings, tasks, follow-ups). Remove this entry when the route or the client method is fixed.",
  },
  ...Object.keys(MOBILE_CRM_CALLS).map((method) => ({ client: "mobile", method, reason: MOBILE_V1_REMOVED })),
];

async function inventory() {
  const routes = routeTable();
  const rows = [];
  const sink = [];
  const crm = createCrmClient({ fetchImpl: recordingFetch(sink) });
  const mobile = createMobileClient({
    baseUrl: "https://erp.test",
    fetchImpl: recordingFetch(sink),
    tokenStore: { getAccessToken: async () => "t", getRefreshToken: async () => "r", setTokens: async () => {}, clear: async () => {} },
    requestIdFactory: () => "req",
  });
  for (const [client, instance, plan] of [["crm", crm, CRM_CLIENT_CALLS], ["mobile", mobile, MOBILE_CRM_CALLS]]) {
    for (const [method, args] of Object.entries(plan)) {
      sink.length = 0;
      await instance[method](...args);
      assert.equal(sink.length, 1, `${client}.${method} should send exactly one request`);
      const { verb, path: urlPath } = sink[0];
      const route = resolve(routes, urlPath);
      rows.push({
        client, method, verb, route: template(urlPath),
        file: route?.file ?? null,
        exists: Boolean(route && route.verbs.includes(verb)),
      });
    }
  }
  return rows;
}

test("every SDK client method is classified for the transport contract", () => {
  const crm = createCrmClient({ fetchImpl: async () => new Response("{}") });
  assert.deepEqual(Object.keys(crm).sort(), Object.keys(CRM_CLIENT_CALLS).sort(), "add new crm.js methods to CRM_CLIENT_CALLS");
  const mobile = createMobileClient({ baseUrl: "https://erp.test", fetchImpl: async () => new Response("{}"), tokenStore: {} });
  const unclassified = Object.keys(mobile).filter((name) => !(name in MOBILE_CRM_CALLS) && !MOBILE_NON_CRM.has(name));
  assert.deepEqual(unclassified, [], "classify new mobile.js methods as CRM (MOBILE_CRM_CALLS) or non-CRM");
});

test("SDK CRM endpoints resolve to route handlers, except the exact known gaps", async () => {
  const rows = await inventory();
  const known = (row) => KNOWN_MISSING.find((entry) => entry.client === row.client && entry.method === row.method && (!entry.verb || entry.verb === row.verb) && (!entry.route || entry.route === row.route));
  const unexpected = rows.filter((row) => !row.exists && !known(row)).map((row) => `${row.client}.${row.method}: ${row.verb} ${row.route}`);
  assert.deepEqual(unexpected, [], "SDK calls a CRM endpoint with no route handler");
  const stale = rows.filter((row) => row.exists && known(row)).map((row) => `${row.client}.${row.method}: ${row.verb} ${row.route} now resolves to ${row.file}`);
  assert.deepEqual(stale, [], "a known-missing route now exists; remove it from KNOWN_MISSING");
  for (const entry of KNOWN_MISSING) assert.ok(rows.some((row) => row.client === entry.client && row.method === entry.method), `KNOWN_MISSING lists unknown method ${entry.client}.${entry.method}`);
});

test("completeActivity is the generic client's only missing route, and it is the documented one", async () => {
  const rows = await inventory();
  const missing = rows.filter((row) => row.client === "crm" && !row.exists);
  assert.deepEqual(missing.map((row) => `${row.verb} ${row.route}`), ["POST /api/crm/activities/{id}/complete"]);
  // The rest of the generic client resolves to real handlers.
  assert.equal(rows.find((row) => row.method === "list" && row.client === "crm").file, "crm/[resource]/route.ts");
  assert.equal(rows.find((row) => row.method === "moveOpportunity" && row.client === "crm").file, "crm/opportunities/[id]/stage/route.ts");
});

