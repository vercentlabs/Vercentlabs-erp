// k6 regression baseline (NOT a capacity test). Representative authenticated
// read paths, one safe write and the v1 API, at a small constant load:
//
//   BASE_URL=http://host:port EMAIL=... PASSWORD=... [API_KEY=vcl_...] \
//     k6 run scripts/perf/k6-baseline.js      (or: pnpm perf:baseline)
//
// One sign-in in setup() (login is rate limited by the application on
// purpose), then every virtual user loops over the scenario list. Results: p50/p95/p99 and
// error rate per endpoint tag; DB pool saturation is read from the web's
// `db.pool` log events during the run (waiting > 0). Laptop numbers are a
// regression reference only — never a production capacity claim.
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Trend } from "k6/metrics";

const BASE = (__ENV.BASE_URL || "http://localhost:3001").replace(/\/$/, "");
const loginDuration = new Trend("login_duration", true);

export const options = {
  scenarios: {
    baseline: { executor: "constant-vus", vus: Number(__ENV.VUS || 5), duration: __ENV.DURATION || "60s" },
  },
  summaryTrendStats: ["avg", "med", "p(95)", "p(99)", "max"],
  thresholds: {
    http_req_failed: ["rate<0.01"],
    "http_req_duration{kind:read}": ["p(95)<1500"],
    "http_req_duration{kind:write}": ["p(95)<2000"],
  },
};

// ORIGIN: the configured APP_URL origin (same-origin check); defaults to BASE.
const origin = { Origin: (__ENV.ORIGIN || BASE).replace(/\/$/, "") };
// The session cookie is Secure in production; over plain HTTP (a local
// baseline) k6's jar would drop it, so it is carried explicitly.
// One sign-in per run (setup), shared by every virtual user: the application
// rate-limits sign-in on purpose, so per-VU logins would measure the limiter.
export function setup() {
  const response = http.post(`${BASE}/api/auth/login`, JSON.stringify({ email: __ENV.EMAIL, password: __ENV.PASSWORD }), {
    headers: { "Content-Type": "application/json", ...origin },
    tags: { endpoint: "auth.login", kind: "login" },
  });
  loginDuration.add(response.timings.duration);
  if (!check(response, { "login 200": (r) => r.status === 200 })) throw new Error(`sign-in failed: ${response.status}`);
  return { Cookie: Object.entries(response.cookies).map(([name, values]) => `${name}=${values[0].value}`).join("; ") };
}

const reads = [
  ["workspace.companies", "/api/workspace/companies"],
  ["workspace.notifications", "/api/notifications?status=unread"],
  ["crm.leads.list", "/api/crm/leads?limit=25"],
  ["platform.search", "/api/search?q=e2e"],
  ["sales.orders.list", "/api/sales/orders?limit=25"],
  ["stock.balances", "/api/inventory/stock/balances"],
];

export default function (session) {
  group("reads", () => {
    for (const [endpoint, path] of reads) {
      const response = http.get(`${BASE}${path}`, { headers: session, tags: { endpoint, kind: "read" } });
      check(response, { [`${endpoint} ok`]: (r) => r.status === 200 });
    }
  });
  group("safe write", () => {
    // Idempotent: marks the caller's own notifications read.
    const response = http.patch(`${BASE}/api/notifications`, null, { headers: { ...origin, ...session }, tags: { endpoint: "notifications.mark_all_read", kind: "write" } });
    check(response, { "mark all read ok": (r) => r.status === 200 });
  });
  if (__ENV.API_KEY) {
    const response = http.get(`${BASE}/api/v1/platform/context`, { headers: { Authorization: `Bearer ${__ENV.API_KEY}` }, tags: { endpoint: "v1.platform.context", kind: "read" } });
    check(response, { "v1 context ok": (r) => r.status === 200 });
  }
  sleep(1);
}
