// Route security matrix: every HTTP handler under apps/web/src/app/api (reads
// included), each resolved to exactly ONE protection class. A handler that
// cannot be classified is UNKNOWN and fails validate-route-security.mjs.
//
//   WORKSPACE_MODULE    workspaceRoute({ module }) (directly or through an
//                       audited module route helper): session -> organisation
//                       context -> access snapshot -> module -> permission(s)
//                       -> billing write gate; same-origin on every mutation.
//   WORKSPACE_PLATFORM  workspaceRoute() for a Shared Platform service
//                       (settings, billing, access, reports, approvals, ...):
//                       a route permission, or a PLATFORM_DOMAIN_AUTHORIZATION
//                       entry naming the domain check.
//   API_KEY        apiKeyRoute(): hashed API key -> organisation context ->
//                  key scopes.
//   SELF_SERVICE   the caller's own account (MFA, sessions): requireApiUser()
//                  + sessionTransaction(); mutations check the origin.
//   PUBLIC_AUTH    pre-authentication account flows (login, register,
//                  password reset, verification, invitations, logout).
//   PUBLIC_TOKEN   an opaque, hashed, per-link token is the credential
//                  (CRM meeting links, Sales quotation links).
//   WEBHOOK        a provider's servers; an HMAC signature over the raw body
//                  is the credential.
//   PROBE          unauthenticated platform health/readiness probes that
//                  disclose no tenant data.
//   TEST_SUPPORT   development/test-only adapter, hard-disabled in production.
//
// Classification is derived from the route source; the non-workspace
// classes additionally require an entry in EXPLICIT_ROUTES naming the
// protection, and the evidence each class claims is re-checked in the source
// (a class whose evidence disappears fails the scan instead of passing).
import fs from "node:fs";
import path from "node:path";

const API_DIR = "apps/web/src/app/api";
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
export const OUTPUT = "docs/frontend-rebuild/ROUTE_SECURITY_MATRIX.csv";

// Evidence each explicit class must show in the route source.
const CLASS_EVIDENCE = {
  PUBLIC_AUTH: { mutation: [/\bassertSameOrigin(OrMobile)?\s*\(/], any: [] },
  PUBLIC_TOKEN: { mutation: [], any: [/\bpublic[A-Za-z]*Token|\btoken\b|\bresolvePublic[A-Za-z]*Organization\s*\(/] },
  WEBHOOK: { mutation: [/signature/i], any: [] },
  PROBE: { mutation: [], any: [] },
  TEST_SUPPORT: { mutation: [], any: [/NODE_ENV/] },
};

// Every non-workspace, non-API-key, non-self-service route, with the actual
// protection. A route cannot silently join this list: its class's evidence
// is re-checked below.
export const EXPLICIT_ROUTES = Object.freeze({
  "api/auth/login/route.ts": ["PUBLIC_AUTH", "Credentials are the authentication; same-origin, rate limited per IP and account, lockout, MFA challenge before a full session."],
  "api/auth/register/route.ts": ["PUBLIC_AUTH", "Self-serve account creation; same-origin, rate limited per IP, no session exists yet."],
  "api/auth/logout/route.ts": ["PUBLIC_AUTH", "Reads the session cookie directly so logout works for any session state; idempotent; same-origin."],
  "api/auth/forgot-password/route.ts": ["PUBLIC_AUTH", "Account-enumeration-safe identical response; same-origin; rate limited."],
  "api/auth/reset-password/route.ts": ["PUBLIC_AUTH", "Single-use hashed reset token is the credential; same-origin."],
  "api/auth/verify-email/route.ts": ["PUBLIC_AUTH", "Single-use hashed verification token (mailbox control) is the credential; same-origin."],
  "api/auth/resend-verification/route.ts": ["PUBLIC_AUTH", "Signed-in but unverified user; same-origin; rate limited."],
  "api/auth/invitations/[token]/route.ts": ["PUBLIC_AUTH", "Read-only lookup by hashed invitation token through a narrow definer function."],
  "api/auth/invitations/[token]/accept/route.ts": ["PUBLIC_AUTH", "Hashed invitation token; an existing account must also hold a matching session; same-origin."],
  "api/crm/public/meetings/links/[token]/route.ts": ["PUBLIC_TOKEN", "Opaque meeting-link token (only its hash stored) resolves the organisation through a definer function; read-only."],
  "api/crm/public/meetings/links/[token]/availability/route.ts": ["PUBLIC_TOKEN", "Same meeting-link token model; read-only availability."],
  "api/crm/public/meetings/links/[token]/book/route.ts": ["PUBLIC_TOKEN", "Same meeting-link token model; the booking is validated against the link's own availability."],
  "api/crm/public/meetings/bookings/[token]/route.ts": ["PUBLIC_TOKEN", "Opaque booking token (hash stored) for the prospect's own booking."],
  "api/crm/public/meetings/bookings/[token]/availability/route.ts": ["PUBLIC_TOKEN", "Same booking token model; read-only reschedule availability."],
  "api/crm/public/capture/[key]/route.ts": ["PUBLIC_TOKEN", "Capture-form key resolves the organisation through a definer function; allowed origins, honeypots, required fields and an hourly per-fingerprint rate limit in the domain; the landing proxy is HMAC-verified over the raw body; billing write gate."],
  "api/sales/public/quotes/[token]/route.ts": ["PUBLIC_TOKEN", "32-byte quotation link token, only its SHA-256 stored; expiry, revocation and revision are enforced by the domain."],
  "api/sales/public/quotes/[token]/decision/route.ts": ["PUBLIC_TOKEN", "Same quotation token; one decision only, Zod-validated body, IP/user-agent recorded as evidence."],
  "api/billing/webhook/route.ts": ["WEBHOOK", "HMAC-SHA256 over the exact raw body (previous secret accepted during rotation), size-limited; stores the event, the worker applies it."],
  "api/platform/mail/inbound/[routeKey]/route.ts": ["WEBHOOK", "Hashed route key resolves the organisation; HMAC-SHA256 of the raw body with the route's own encrypted signing secret; body ids ignored; idempotent."],
  "api/pos/payments/webhook/[provider]/route.ts": ["WEBHOOK", "Provider HMAC signature over the raw body verified before parsing and again inside the domain transaction."],
  "api/health/route.ts": ["PROBE", "Liveness only; no database, no tenant data."],
  "api/readiness/route.ts": ["PROBE", "Readiness: configuration, database role, migrations and storage status only; no tenant data."],
  "api/test-support/email-capture/route.ts": ["TEST_SUPPORT", "Returns 404 unless NODE_ENV is not production AND AUTH_EMAIL_CAPTURE_ENABLED is set; production configuration validation forbids the flag."],
});

// Shared Platform workspace routes whose authorization is NOT a single route
// permission: the domain function scopes to the caller or re-checks module
// access per record. Every permission-less platform handler must be here.
export const PLATFORM_DOMAIN_AUTHORIZATION = Object.freeze({
  "api/jobs/route.ts": "Own jobs only; the organisation-wide view requires the job operations permission (checked in the handler).",
  "api/jobs/[id]/route.ts": "Same viewer rule as the job list (getJobForViewer).",
  "api/reports/datasets/route.ts": "Datasets filtered to the snapshot's accessible modules and their permissions.",
  "api/reports/definitions/route.ts": "Definitions filtered to accessible modules; creating one re-checks the dataset's module and permission.",
  "api/reports/definitions/[id]/status/route.ts": "Owner or reporting manager, enforced by setReportDefinitionStatus.",
  "api/reports/runs/route.ts": "Own runs; requesting a run re-checks the dataset's module and permission against the snapshot.",
  "api/reports/runs/[id]/download/route.ts": "Only the run's requester (readReportRunOutput).",
  "api/search/route.ts": "Results limited to the snapshot's accessible modules and the caller's record scope.",
  "api/approvals/route.ts": "Approval inbox limited to steps assigned to the caller in accessible modules.",
  "api/approvals/[id]/decide/route.ts": "Only an assigned approver of an accessible module; segregation of duties in decideApproval; denials audited.",
  "api/notifications/route.ts": "The caller's own notifications, filtered to accessible modules.",
  "api/notifications/[id]/read/route.ts": "The caller's own notification only.",
  "api/settings/notification-preferences/route.ts": "The caller's own preferences only.",
  "api/workspace/companies/route.ts": "Companies inside the caller's own access scope.",
  "api/workspace/context/route.ts": "Switches only to a company/branch inside the caller's own access scope.",
  "api/settings/organization/profile/route.ts": "Any member may read the organisation name/timezone; updating requires organization.manage.",
  "api/settings/organization/security/route.ts": "Any member may read whether MFA is enforced; changing it requires platform.security.manage.",
});

// Module route helpers that wrap workspaceRoute. Audited at scan time: the
// helper must call workspaceRoute, and its Mutation variant must set the
// billing write gate.
function moduleHelpers() {
  const helpers = new Map();
  const featuresDir = "apps/web/src/features";
  for (const feature of fs.readdirSync(featuresDir)) {
    const file = path.join(featuresDir, feature, "shared", "route-helpers.ts");
    if (!fs.existsSync(file)) continue;
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/export async function (\w+(?:Read|Mutation))\s*</g)) {
      const name = match[1];
      const start = match.index;
      const next = source.indexOf("\nexport ", start + 10);
      const body = source.slice(start, next < 0 ? source.length : next);
      if (!/\bworkspaceRoute\s*\(/.test(body)) throw new Error(`${file}: ${name} no longer calls workspaceRoute(); routes using it can no longer be treated as protected.`);
      const module = body.match(/module: "([^"]+)"/)?.[1];
      if (!module) throw new Error(`${file}: ${name} has no module option.`);
      const mutation = name.endsWith("Mutation");
      if (mutation && !/billingWrite: true/.test(body)) throw new Error(`${file}: ${name} no longer sets billingWrite.`);
      const defaultPermission = source.slice(start).match(/permission: string = "([^"]+)"/)?.[1] ?? null;
      helpers.set(name, { file: file.replaceAll("\\", "/"), module, mutation, defaultPermission, selfService: /selfService: true/.test(body) });
    }
  }
  return helpers;
}

function auditCoreWrappers() {
  const workspace = fs.readFileSync("apps/web/src/core/workspace-route.ts", "utf8");
  const secure = fs.readFileSync("apps/web/src/core/secure-route.ts", "utf8");
  const apiKey = fs.readFileSync("apps/web/src/core/api-key-route.ts", "utf8");
  const required = [
    [workspace, /requireSession: \(\) => requireApiWorkspace\(\)/, "workspaceRoute resolves the workspace session"],
    [workspace, /assertOrigin: \(incoming\) => assertSameOriginOrMobile\(/, "workspaceRoute wires the origin check"],
    [secure, /if \(mutation\) deps\.assertOrigin\(request\)/, "secure-route checks the origin on every mutation"],
    [secure, /deps\.authorize\(\{/, "secure-route authorizes before the handler"],
    [secure, /if \(options\.billingWrite\) await deps\.requireBillingWrite\(/, "secure-route runs the billing write gate"],
    [secure, /deps\.runTenant\(session\.organizationId/, "secure-route runs under the session organisation context"],
    [apiKey, /authenticateApiKey\(/, "apiKeyRoute authenticates the key"],
  ];
  for (const [source, pattern, label] of required) if (!pattern.test(source)) throw new Error(`core route composition changed: ${label} (${pattern}) not found.`);
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name === "route.ts") files.push(full);
  }
  return files;
}

function handlers(source) {
  const found = [];
  for (const method of HTTP_METHODS) {
    const match = new RegExp(`export\\s+(?:(?:async\\s+)?function\\s+${method}\\s*\\(|const\\s+${method}\\s*=)`).exec(source);
    if (!match) continue;
    const next = source.indexOf("\nexport ", match.index + 10);
    found.push({ method, body: source.slice(match.index, next < 0 ? source.length : next) });
  }
  return found;
}

function literal(options, key) {
  const value = options.match(new RegExp(`\\b${key}:\\s*("[^"]*"|[A-Za-z_][\\w.]*|\\[[^\\]]*\\])`))?.[1];
  return value ? value.replace(/"/g, "") : "";
}

// The permission a route passes to a module helper: salesRead/salesMutation
// take it as the second argument; the other helpers as their last argument.
function helperPermission(body, name) {
  const second = body.match(new RegExp(`\\b${name}\\(\\s*request,\\s*("[a-z_]+(?:\\.[a-z_]+)+"|[A-Z_]+\\.[A-Za-z]+)`));
  if (second) return second[1].replace(/"/g, "");
  const last = body.match(/,\s*("[a-z_]+(?:\.[a-z_]+)+")\s*,?\s*\)\s*;?\s*\}\s*$/);
  return last ? last[1].replace(/"/g, "") : null;
}

function classifyWorkspace(body, source, helpers) {
  const direct = body.match(/workspaceRoute\(\s*request,\s*([\s\S]*?),\s*async\s*\(/);
  if (direct) {
    let options = direct[1];
    // Options held in a local variable: read its definition(s) from the file.
    if (/^\w+$/.test(options.trim())) options = [...source.matchAll(new RegExp(`const ${options.trim()} = ([\\s\\S]*?);\\n`, "g"))].map((m) => m[1]).join(" ");
    const permission = literal(options, "permissions") || literal(options, "permission");
    const handlerPermission = /\brequireSessionPermission\s*\(|\bassertCrmResourceMutationPermission\s*\(/.test(body);
    return {
      via: "workspaceRoute",
      module: literal(options, "module") || "(none)",
      permission: permission || (handlerPermission ? "(checked in handler)" : ""),
      billingWrite: /billingWrite: true/.test(options) || /\brequireBillingWriteAccess\s*\(/.test(body),
      selfService: /selfService: true/.test(options),
    };
  }
  for (const [name, helper] of helpers) {
    if (!new RegExp(`\\b${name}\\s*\\(`).test(body)) continue;
    return {
      via: name,
      module: helper.module,
      permission: helperPermission(body, name) ?? (helper.defaultPermission ? `${helper.defaultPermission} (helper default; route may narrow)` : "(route-specified)"),
      billingWrite: helper.mutation,
      selfService: helper.selfService && /SELF_SERVICE|""/.test(body) ? "when self-service" : false,
    };
  }
  return null;
}

export function buildMatrix() {
  auditCoreWrappers();
  const helpers = moduleHelpers();
  const rows = [];
  for (const filePath of walk(API_DIR).sort()) {
    const source = fs.readFileSync(filePath, "utf8");
    const route = filePath.replaceAll("\\", "/").replace(/^apps\/web\/src\/app\//, "");
    for (const { method, body } of handlers(source)) {
      const mutation = MUTATION_METHODS.has(method);
      const row = { route, method, class: "UNKNOWN", via: "", module: "", permission: "", billingWrite: false, selfService: false, originCheck: false, protection: "" };
      const explicit = EXPLICIT_ROUTES[route];
      const workspace = classifyWorkspace(body, source, helpers);
      if (workspace) {
        const platform = !workspace.module || workspace.module === "(none)";
        const domain = PLATFORM_DOMAIN_AUTHORIZATION[route];
        Object.assign(row, workspace, {
          class: platform ? "WORKSPACE_PLATFORM" : "WORKSPACE_MODULE",
          module: platform ? "" : workspace.module,
          // The module check itself requires the module view permission.
          permission: workspace.permission || (platform ? "" : workspace.selfService ? "(self-service: own records)" : "(module view permission)"),
          originCheck: mutation,
          protection: platform && !workspace.permission ? (domain ?? "") : "session + organisation context + Shared Access authorize()",
        });
        if (platform && !workspace.permission && !domain) {
          row.class = "UNKNOWN";
          row.protection = "platform workspace route with no route permission and no PLATFORM_DOMAIN_AUTHORIZATION entry";
        }
      } else if (/\bapiKeyRoute\s*\(/.test(body)) {
        Object.assign(row, { class: "API_KEY", via: "apiKeyRoute", module: literal(body, "module"), permission: literal(body, "scope") || literal(body, "scopes"), protection: "hashed API key + key scopes + organisation context" });
      } else if (/\brequireApiUser\s*\(/.test(body) && /\bsessionTransaction\s*\(/.test(body)) {
        Object.assign(row, { class: "SELF_SERVICE", via: "requireApiUser + sessionTransaction", originCheck: /\bassertSameOrigin(OrMobile)?\s*\(/.test(body), protection: "the caller's own account; user + organisation context from the session" });
      } else if (explicit) {
        const [cls, protection] = explicit;
        const evidence = CLASS_EVIDENCE[cls];
        const missing = [...evidence.any, ...(mutation ? evidence.mutation : [])].filter((pattern) => !pattern.test(source));
        if (missing.length) {
          row.class = "UNKNOWN";
          row.protection = `${cls} evidence missing: ${missing.join(" ")}`;
        } else {
          Object.assign(row, { class: cls, via: "explicit", originCheck: /\bassertSameOrigin(OrMobile)?\s*\(/.test(body), protection });
        }
      }
      rows.push(row);
    }
  }
  return rows;
}

function csvField(value) {
  const s = String(value ?? "");
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function writeMatrix(rows) {
  const header = ["route", "method", "class", "via", "module", "permission", "billing_write", "self_service", "origin_check", "protection"];
  const lines = [header.join(",")];
  for (const row of rows) lines.push([row.route, row.method, row.class, row.via, row.module, row.permission, row.billingWrite, row.selfService, row.originCheck, row.protection].map(csvField).join(","));
  fs.writeFileSync(OUTPUT, lines.join("\n") + "\n");
}

if (import.meta.url === `file://${process.argv[1].replaceAll("\\", "/").replace(/^\/?/, "/")}` || process.argv[1]?.endsWith("generate-route-security-matrix.mjs")) {
  const rows = buildMatrix();
  writeMatrix(rows);
  const counts = rows.reduce((acc, row) => ({ ...acc, [row.class]: (acc[row.class] ?? 0) + 1 }), {});
  console.log(`Wrote ${rows.length} route handlers to ${OUTPUT}: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(", ")}.`);
}
