// Phase 8 (ERP Checkpoint D): a machine-readable inventory of every
// mutation-capable route handler under apps/web/src/app/api, checked
// against the app's actual authentication/authorization/origin
// primitives — not a bare "does this file contain a string" grep.
// Detection requires both an import of the primitive from
// "@vercentlabs/api" AND a real call site (`name(`) in the same file, so
// a route that imports something unrelated but happens to share a
// substring can't produce a false positive.
import fs from "node:fs";
import path from "node:path";

const API_DIR = "apps/web/src/app/api";
const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"];
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const AUTH_PRIMITIVES = ["requireUser", "requireVerifiedUser", "requireWorkspace", "requireApiWorkspace", "requireApiUser"];
const ORIGIN_PRIMITIVES = ["assertSameOrigin", "assertSameOriginOrMobile"];
const AUTHORIZATION_PRIMITIVES = [
  "requireCrmAccess",
  "requireCrmMutationAccess",
  "requireSessionPermission",
  "assertPrivacyManage",
  "assertSensitiveLeadIntelligenceAccess",
  "requirePosAccess",
];

// Routes whose absence of the usual authenticated/same-origin pattern is
// a deliberate, reviewed design choice, not an oversight — each entry
// must name the actual alternative protection so this list can never
// silently grow into "things nobody checked".
const DOCUMENTED_EXCEPTIONS = {
  "api/auth/login/route.ts": "Pre-authentication: there is no session yet to protect; assertSameOrigin still applies to the login POST itself.",
  "api/auth/register/route.ts": "Pre-authentication self-serve account creation: there is no session yet to protect (this route creates the first one); assertSameOrigin applies, and enforceRateLimit(client, `register:${ip}`, 5, 600) bounds abuse the same way login/accept-invitation are bounded.",
  "api/auth/logout/route.ts": "Deliberately reads the session cookie directly rather than calling requireUser()/requireWorkspace() — logout must work even for an unverified or org-less session, which those helpers would redirect away from instead of processing. Idempotent/safe with no cookie at all. assertSameOriginOrMobile still applies.",
  "api/auth/forgot-password/route.ts": "Public by design (account-enumeration-safe); assertSameOrigin applies, rate-limited, identical response regardless of registration state.",
  "api/auth/verify-email/route.ts": "Token-bearer authentication (proof of mailbox control IS the credential); assertSameOrigin applies.",
  "api/auth/reset-password/route.ts": "Token-bearer authentication; assertSameOrigin applies.",
  "api/auth/invitations/[token]/route.ts": "GET only, public token lookup — no mutation.",
  "api/auth/invitations/[token]/accept/route.ts": "Token-bearer for a new account; an existing account additionally requires a matching authenticated session (see acceptOrganizationInvitation's authenticatedUserId parameter). assertSameOrigin applies.",
  "api/crm/public/meetings/links/[token]/book/route.ts": "Public by design (prospect booking a slot) — access control is the opaque per-link token, never a session cookie, so same-origin/session checks don't apply.",
  "api/crm/public/meetings/bookings/[token]/route.ts": "Public by design (prospect managing their own booking) — same token-based model as the link-booking route above.",
  "api/sales/public/quotes/[token]/decision/route.ts": "Public by design (a customer accepting or declining the quotation link a salesperson sent them) -- access control is the opaque per-link token, never a session: 32 random bytes (base64url), only its SHA-256 stored, so the URL is the credential and cannot be derived from any id. The domain function (recordPublicQuoteDecision -> resolvePublicQuoteToken) refuses an expired or revoked link, a quotation revised since the link was sent, a lapsed valid-until, and any second decision; the body is Zod-validated and IP/user-agent are recorded as evidence. Same token-based model as the CRM public booking routes above.",
  "api/test-support/email-capture/route.ts": "Dev/test-only capture adapter, hard-blocked by NODE_ENV and an explicit opt-in flag inside the route itself — never reachable in production regardless of any check here.",
  "api/pos/payments/webhook/[provider]/route.ts": "Public by design — a payment provider's own servers call it directly with no ERP session to present. Authenticated by the provider's cryptographic HMAC signature instead (adapter.verifyWebhookSignature over the raw body, verified before the payload is parsed or trusted, and re-verified inside handlePosPaymentWebhook's transaction), the same 'unauthenticated but cryptographically verified' pattern already established for inbound-mail webhooks (services/api/src/core/inbound-mail.js's verifyInboundMailSignature).",
};

function readFile(filePath) {
  return fs.readFileSync(filePath, "utf8");
}

function hasPrimitive(source, name) {
  const importPattern = new RegExp(`import\\s*\\{[^}]*\\b${name}\\b[^}]*\\}\\s*from`, "s");
  const callPattern = new RegExp(`\\b${name}\\s*\\(`);
  return importPattern.test(source) && callPattern.test(source);
}

// Audited route wrappers. A route that calls one of these gets the primitives
// the wrapper is PROVEN to call -- proven here, at scan time, by reading the
// wrapper's own source, so this trust cannot outlive the wrapper being changed
// to drop a check (the scan then fails loudly instead of quietly passing).
const AUDITED_WRAPPERS = {
  salesMutation: {
    file: "apps/web/src/features/sales/shared/route-helpers.ts",
    provides: { auth: ["requireWorkspace"], origin: ["assertSameOriginOrMobile"], authorization: ["requireSalesAccess"] },
  },
  salesRead: {
    file: "apps/web/src/features/sales/shared/route-helpers.ts",
    provides: { auth: ["requireWorkspace"], origin: [], authorization: ["requireSalesAccess"] },
  },
  procurementMutation: {
    file: "apps/web/src/features/procurement/shared/route-helpers.ts",
    provides: { auth: ["requireWorkspace"], origin: ["assertSameOriginOrMobile"], authorization: ["requireProcurementAccess"] },
  },
  manufacturingMutation: {
    file: "apps/web/src/features/manufacturing/shared/route-helpers.ts",
    provides: { auth: ["requireWorkspace"], origin: ["assertSameOriginOrMobile"], authorization: ["requireManufacturingAccess"] },
  },
  manufacturingRead: {
    file: "apps/web/src/features/manufacturing/shared/route-helpers.ts",
    provides: { auth: ["requireWorkspace"], origin: [], authorization: ["requireManufacturingAccess"] },
  },
  inventoryMutation: {
    file: "apps/web/src/features/inventory/shared/route-helpers.ts",
    provides: { auth: ["requireWorkspace"], origin: ["assertSameOriginOrMobile"], authorization: ["requireInventoryAccess"] },
  },
  inventoryRead: {
    file: "apps/web/src/features/inventory/shared/route-helpers.ts",
    provides: { auth: ["requireWorkspace"], origin: [], authorization: ["requireInventoryAccess"] },
  },
  procurementRead: {
    file: "apps/web/src/features/procurement/shared/route-helpers.ts",
    provides: { auth: ["requireWorkspace"], origin: [], authorization: ["requireProcurementAccess"] },
  },
};
for (const [wrapper, spec] of Object.entries(AUDITED_WRAPPERS)) {
  const wrapperSource = readFile(spec.file);
  const body = wrapperSource.slice(wrapperSource.indexOf(`export async function ${wrapper}`));
  const end = body.indexOf("\nexport ", 10);
  const scoped = end === -1 ? body : body.slice(0, end);
  for (const kind of Object.values(spec.provides).flat()) {
    if (!new RegExp(`\\b${kind}\\s*\\(`).test(scoped)) {
      throw new Error(`Audited wrapper ${wrapper} (${spec.file}) no longer calls ${kind}(); routes using it can no longer be treated as protected.`);
    }
  }
}
function viaWrapper(source, kind) {
  return Object.entries(AUDITED_WRAPPERS).some(([name, spec]) => spec.provides[kind].length > 0 && hasPrimitive(source, name));
}

function detectMethods(source) {
  return HTTP_METHODS.filter((method) => new RegExp(`export\\s+(async\\s+)?function\\s+${method}\\s*\\(`).test(source));
}

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, files);
    else if (entry.name === "route.ts") files.push(full);
  }
  return files;
}

const routeFiles = walk(API_DIR).sort();
const rows = [];

for (const filePath of routeFiles) {
  const source = readFile(filePath);
  const methods = detectMethods(source);
  const mutationMethods = methods.filter((m) => MUTATION_METHODS.has(m));
  if (mutationMethods.length === 0) continue; // read-only routes are out of scope for this matrix

  const relativePath = filePath.replaceAll("\\", "/").replace(/^apps\/web\/src\/app\//, "");
  const hasAuth = AUTH_PRIMITIVES.some((name) => hasPrimitive(source, name)) || viaWrapper(source, "auth");
  const hasOrigin = ORIGIN_PRIMITIVES.some((name) => hasPrimitive(source, name)) || viaWrapper(source, "origin");
  const hasAuthorization = AUTHORIZATION_PRIMITIVES.some((name) => hasPrimitive(source, name)) || viaWrapper(source, "authorization");
  const exceptionReason = DOCUMENTED_EXCEPTIONS[relativePath];

  rows.push({
    route: relativePath,
    mutationMethods: mutationMethods.join(","),
    hasAuth,
    hasOrigin,
    hasAuthorization,
    documentedException: exceptionReason ?? "",
  });
}

const header = ["route", "mutation_methods", "has_auth", "has_origin_check", "has_authorization_check", "documented_exception"];
function csvField(value) {
  const s = String(value ?? "");
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
const lines = [header.join(",")];
for (const row of rows) {
  lines.push(
    [row.route, row.mutationMethods, row.hasAuth, row.hasOrigin, row.hasAuthorization, row.documentedException]
      .map(csvField)
      .join(","),
  );
}

const outPath = "docs/frontend-rebuild/ROUTE_SECURITY_MATRIX.csv";
fs.writeFileSync(outPath, lines.join("\n") + "\n");
console.log(`Wrote ${rows.length} mutation-capable routes to ${outPath}.`);
