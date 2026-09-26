#!/usr/bin/env node
// Post-deployment smoke test (deploy workflow, staging and production):
//
//   node scripts/deploy/smoke.mjs --url https://erp.example.com [--attempts 30]
//
// Checks, against the public URL through the load balancer:
//   - /api/health returns 200 {status:"ok"}
//   - /api/readiness returns 200 (configuration, DB role, migrations, storage)
//   - the sign-in page returns 200 with the production security headers
//     (HSTS, CSP without unsafe-eval, nosniff, frame protection)
//   - plain http:// redirects to https://
//   - optionally (SMOKE_EMAIL + SMOKE_PASSWORD, a dedicated smoke account
//     without MFA): sign in and read /api/workspace/context through the
//     full workspace pipeline.
// Read-only apart from the smoke account's own session. Prints JSON evidence.
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, arg, index, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[index + 1]]] : pairs), []),
);
const base = String(args.url || process.env.SMOKE_URL || "").replace(/\/$/, "");
if (!/^https:\/\//.test(base)) {
  console.error("--url https://<host> is required");
  process.exit(2);
}
const attempts = Number(args.attempts || 30);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const checks = [];

async function check(name, run) {
  try {
    const detail = await run();
    checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
  }
}

async function eventually(run) {
  let last;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      last = error;
      await sleep(10_000);
    }
  }
  throw last;
}

const fetchWithTimeout = (url, init = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(15_000), ...init });

await check("health", () =>
  eventually(async () => {
    const response = await fetchWithTimeout(`${base}/api/health`);
    const body = await response.json().catch(() => ({}));
    if (response.status !== 200 || body.status !== "ok") throw new Error(`/api/health -> ${response.status}`);
  }),
);

await check("readiness", () =>
  eventually(async () => {
    const response = await fetchWithTimeout(`${base}/api/readiness`);
    if (response.status !== 200) throw new Error(`/api/readiness -> ${response.status} ${(await response.text()).slice(0, 300)}`);
  }),
);

await check("security headers", async () => {
  const response = await fetchWithTimeout(`${base}/login`);
  if (response.status !== 200) throw new Error(`/login -> ${response.status}`);
  const header = (name) => response.headers.get(name) || "";
  const problems = [];
  if (!/max-age=\d{7,}/.test(header("strict-transport-security"))) problems.push("HSTS missing or short");
  const csp = header("content-security-policy");
  if (!csp) problems.push("CSP missing");
  if (/unsafe-eval/.test(csp)) problems.push("CSP allows unsafe-eval");
  if (header("x-content-type-options") !== "nosniff") problems.push("nosniff missing");
  if (!/frame-ancestors\s+'none'|frame-ancestors\s+'self'/.test(csp) && !header("x-frame-options")) problems.push("frame protection missing");
  if (problems.length) throw new Error(problems.join("; "));
});

await check("http redirects to https", async () => {
  const response = await fetchWithTimeout(base.replace(/^https:/, "http:") + "/login");
  const location = response.headers.get("location") || "";
  if (![301, 308].includes(response.status) || !location.startsWith("https://")) throw new Error(`http -> ${response.status} ${location}`);
});

if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
  await check("sign in and workspace context", async () => {
    const login = await fetchWithTimeout(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: base },
      body: JSON.stringify({ email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }),
    });
    if (login.status !== 200) throw new Error(`login -> ${login.status}`);
    const cookie = (login.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]).join("; ");
    if (!cookie) throw new Error("login set no session cookie");
    const context = await fetchWithTimeout(`${base}/api/workspace/companies`, { headers: { cookie } });
    if (context.status !== 200) throw new Error(`/api/workspace/companies -> ${context.status}`);
    await fetchWithTimeout(`${base}/api/auth/logout`, { method: "POST", headers: { cookie, origin: base } }).catch(() => undefined);
  });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(JSON.stringify({ smoke: base, at: new Date().toISOString(), passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
