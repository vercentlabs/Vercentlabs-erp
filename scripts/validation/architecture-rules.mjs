// Deterministic architecture + Shared Access rules, as pure functions over
// `{ path, source }` records so each rule is unit-tested
// (architecture-rules.test.mjs) and the drivers (verify-architecture.mjs,
// verify-access-architecture.mjs) stay thin.
//
// Every rule exists to stop a specific kind of drift coding agents have
// introduced before. Exceptions are explicit, named and carry a reason;
// shrinking an exception list is always welcome, growing one needs review.
// See docs/01-standards/SHARED_PLATFORM_ARCHITECTURE.md.

// ---------------------------------------------------------------- frontend

export const WEB_SRC_ENTRIES = Object.freeze(["app", "core", "features", "shell", "shared"]);
// Files Next.js only recognises at the src root (framework entry points).
export const WEB_SRC_FRAMEWORK_FILES = Object.freeze(["instrumentation.ts"]);
const RETIRED_WEB_ENTRIES = Object.freeze({
  components: "reusable UI belongs in @vercentlabs/design-system or apps/web/src/shared",
  lib: "helpers belong in apps/web/src/core (protected runtime) or apps/web/src/shared (generic)",
  modules: "business modules live in apps/web/src/features/<module>",
  server: "server helpers live in apps/web/src/core or features/<module>/server",
  platform: "Shared Platform UX lives in apps/web/src/features/settings (and features/platform)",
  orchestration: "cross-module business logic belongs in services/api/src/orchestration",
});

export function checkWebTopLevel(entries) {
  const problems = [];
  for (const entry of entries) {
    if (WEB_SRC_ENTRIES.includes(entry) || WEB_SRC_FRAMEWORK_FILES.includes(entry)) continue;
    const hint = RETIRED_WEB_ENTRIES[entry];
    problems.push(`apps/web/src/${entry} is not part of the frontend architecture${hint ? ` — ${hint}` : ` (allowed: ${WEB_SRC_ENTRIES.join(", ")})`}`);
  }
  for (const required of WEB_SRC_ENTRIES) if (!entries.includes(required)) problems.push(`apps/web/src/${required} is missing`);
  return problems;
}

export function checkWebRetiredAliases(files) {
  const problems = [];
  for (const { path, source } of files) {
    const match = source.match(/from\s+["']@\/(lib|components|modules|server|platform|orchestration)\//);
    if (match) problems.push(`${path} imports retired alias @/${match[1]}/`);
  }
  return problems;
}

// A feature may import another feature only through its public index
// ("@/features/<name>") — never its internals. No exceptions.

export function checkCrossFeatureImports(files) {
  const problems = [];
  for (const { path, source } of files) {
    const own = path.match(/^apps\/web\/src\/features\/([^/]+)\//)?.[1];
    if (!own) continue;
    for (const match of source.matchAll(/from\s+["']@\/features\/([^/"']+)(\/[^"']*)?["']/g)) {
      const [, target, rest] = match;
      if (target === own || !rest) continue;
      problems.push(`${path} imports private ${target} code (@/features/${target}${rest}); import the feature's public index instead`);
    }
  }
  return problems;
}

// ------------------------------------------------------------- api layout

export const API_CORE_DOMAINS = Object.freeze(["access", "auth", "organization", "billing", "platform", "security", "release"]);

// Flat files that predate the domain boundaries. They stay importable (the
// domain index.js files re-export them) and move behind their boundary
// incrementally. New core code must be created inside a domain directory.
export const LEGACY_FLAT_CORE_FILES = Object.freeze([
  "access-administration", "access-control-runtime", "ai-governance", "api-keys", "attachment-security",
  "audit-redaction", "auth-lifecycle", "auth-mailer", "configuration", "decimal",
  "field-visibility", "idempotency", "inbound-mail", "inventory-lock",
  "master-data", "mfa", "module-entitlements", "oauth",
  "organization-administration", "organization-registration", "password-policy", "privacy",
  "references", "security", "session", "tags", "tax-engine",
]);

export function checkApiCoreLayout(entries) {
  const problems = [];
  for (const { name, isDirectory } of entries) {
    if (isDirectory) {
      if (!API_CORE_DOMAINS.includes(name)) problems.push(`services/api/src/core/${name}/ is not a Shared Platform domain (${API_CORE_DOMAINS.join(", ")})`);
      continue;
    }
    const base = name.replace(/\.d\.ts$/, "").replace(/\.(m?js|ts)$/, "");
    if (!LEGACY_FLAT_CORE_FILES.includes(base)) {
      problems.push(`services/api/src/core/${name}: new core code must live inside a domain directory (${API_CORE_DOMAINS.join(", ")}), not as a flat file`);
    }
  }
  for (const domain of API_CORE_DOMAINS.filter((entry) => entry !== "release")) {
    if (!entries.some((entry) => entry.isDirectory && entry.name === domain)) problems.push(`services/api/src/core/${domain}/ boundary is missing`);
  }
  return problems;
}

// ------------------------------------------------------------ Shared Access

// Security primitives with exactly one definition in the repository.
export const CANONICAL_DEFINITIONS = Object.freeze({
  // SaaS billing: one implementation of each rule, behind core/billing/.
  hasWriteAccess: "services/api/src/core/billing/state.js",
  calculateSeatCharge: "services/api/src/core/billing/catalogue.js",
  getSeatStatus: "services/api/src/core/billing/seats.js",
  getBillingSummary: "services/api/src/core/billing/entitlements.js",
  requireBillingWriteAccess: "services/api/src/core/billing/entitlements.js",
  verifyWebhookSignature: "services/api/src/core/billing/providers/razorpay.js",
  verifyCheckoutSignature: "services/api/src/core/billing/providers/razorpay.js",
  createRazorpayProvider: "services/api/src/core/billing/providers/razorpay.js",
  reconcileSubscription: "services/api/src/core/billing/reconciliation.js",
  resolveSessionContext: "services/api/src/core/session.js",
  tokenHash: "services/api/src/core/session.js",
  hashPassword: "services/api/src/core/session.js",
  verifyPassword: "services/api/src/core/session.js",
  hasSessionPermission: "services/api/src/core/access-control-runtime.js",
  requireSessionPermission: "services/api/src/core/access-control-runtime.js",
  createAccessPrincipal: "services/api/src/core/access/principal.js",
  principalHasPermission: "services/api/src/core/access/principal.js",
  buildWorkspaceAccessSnapshot: "services/api/src/core/access/access-snapshot.js",
  authorize: "services/api/src/core/access/authorization.js",
  setTenantContext: "packages/database/src/index.js",
  runTenantTransaction: "packages/database/src/index.js",
  tenantTransaction: "apps/web/src/core/db.ts",
  workspaceTransaction: "apps/web/src/core/db.ts",
  getSessionContext: "apps/web/src/core/session.ts",
  requireWorkspace: "apps/web/src/core/session.ts",
  requireApiWorkspace: "apps/web/src/core/session.ts",
  requireApiUser: "apps/web/src/core/session.ts",
  workspaceRoute: "apps/web/src/core/workspace-route.ts",
  // Shared Access administration: one implementation each.
  setUserAccessScope: "services/api/src/core/access-administration.js",
  listGrantableRolesForActor: "services/api/src/core/access-administration.js",
  listGrantableScope: "services/api/src/core/access-administration.js",
  setOrganizationModuleEnabled: "services/api/src/core/platform/module-administration.js",
  recordAccessAssignmentEvent: "services/api/src/core/access/audit.js",
  COMPANY_ADMINISTRATOR_PERMISSIONS: "packages/permissions/src/roles.js",
  // Canonical registries: exactly one role/permission/module catalogue.
  ROLE_TEMPLATES: "packages/permissions/src/roles.js",
  ALL_PERMISSIONS: "packages/permissions/src/catalog.js",
  SOD_CONFLICTS: "packages/permissions/src/roles.js",
  CURRENT_MODULE_KEYS: "packages/permissions/src/roles.js",
  MODULE_ACCESS_PERMISSIONS: "packages/permissions/src/module-access.js",
  MODULE_VIEW_PERMISSIONS: "packages/permissions/src/module-access.js",
  ERP_MODULE_CATALOG: "packages/shared-types/src/modules.js",
  // Shared Runtime: one authoritative service per capability (see
  // scripts/validation/verify-shared-runtime.mjs for the writer/reader rules).
  createNotification: "services/api/src/core/platform/notifications/service.js",
  NOTIFICATION_CATEGORIES: "services/api/src/core/platform/notifications/categories.js",
  createApprovalRequest: "services/api/src/core/platform/approvals/repository.js",
  finalizeApprovalRequest: "services/api/src/core/platform/approvals/repository.js",
  recordApprovalDecision: "services/api/src/core/platform/approvals/repository.js",
  APPROVAL_COMMANDS: "services/api/src/core/platform/approvals/catalog.js",
  APPROVAL_COMMAND_REGISTRY: "services/api/src/orchestration/approvals/registry.js",
  decideApproval: "services/api/src/orchestration/approvals/inbox.js",
  queryAuditEvents: "services/api/src/core/platform/audit/reader.js",
  SEARCH_PROVIDERS: "services/api/src/orchestration/search/providers.js",
  searchRecords: "services/api/src/orchestration/search/service.js",
  JOB_TYPE_PRESENTATION: "services/api/src/core/platform/jobs/presentation.js",
  listJobsForViewer: "services/api/src/core/platform/jobs/service.js",
});

export function checkCanonicalDefinitions(files) {
  const problems = [];
  for (const { path, source } of files) {
    if (path.endsWith(".d.ts") || /\.test\.|\/tests?\//.test(path)) continue;
    for (const [name, owner] of Object.entries(CANONICAL_DEFINITIONS)) {
      // Module-scope declarations only (no indentation): a local variable
      // that happens to share a name is not a second implementation.
      const pattern = new RegExp(`(?:^|\\n)(?:export\\s+)?(?:async\\s+)?(?:function\\s+${name}\\b|(?:const|let|var)\\s+${name}\\s*=)`);
      if (pattern.test(source) && path !== owner) problems.push(`${path} defines ${name}; the one canonical definition is ${owner} — import it instead`);
    }
  }
  return problems;
}

export const TENANT_CONTEXT_EXCEPTIONS = Object.freeze({
  "services/api/src/modules/crm/prospect-and-relationship-master-data/lead-capture.js":
    "Public web-to-lead capture resolves the tenant from a verified capture-form token (no session exists); sets the same transaction-local parameterized context.",
});

export function checkTenantContextSetters(files) {
  const problems = [];
  for (const { path, source } of files) {
    if (/\/tests?\/|\.test\./.test(path) || path.startsWith("database/")) continue;
    if (!/set_config\(\s*'app\.current_organization_id'/.test(source)) continue;
    if (path === "packages/database/src/index.js" || TENANT_CONTEXT_EXCEPTIONS[path]) continue;
    problems.push(`${path} sets app.current_organization_id directly; use runTenantTransaction/setTenantContext from @vercentlabs/database`);
  }
  return problems;
}

export function checkWebDatabaseAccess(files) {
  const problems = [];
  for (const { path, source } of files) {
    if (!path.startsWith("apps/web/src/") || /\.test\.tsx?$/.test(path)) continue;
    if (path === "apps/web/src/core/db.ts") continue;
    if (/import\s+(?!type\b)[^;]*from\s+["']pg["']/.test(source)) problems.push(`${path} imports pg; only apps/web/src/core/db.ts owns database connections`);
    const rawSql = /\.query\s*\(/.test(source) || /import\s*\{[^}]*\bquery\b[^}]*\}\s*from\s*["']@\/core\/db["']/.test(source);
    if (rawSql) {
      problems.push(`${path} issues SQL directly; put queries in an @vercentlabs/api domain service and call it inside workspaceRoute/tenantTransaction`);
    }
  }
  return problems;
}

const PERMISSION_LITERAL =
  /\b(?:requireSessionPermission|hasSessionPermission|principalHasPermission|requirePermission|assertPermission|require[A-Z]\w*Access)\s*\([^()]*?["'`]([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)["'`]|\bpermissions?:\s*["']([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)["']|\bpermissions?\.includes\(\s*["']([a-z][a-z0-9_]*(?:\.[a-z0-9_-]+)+)["']/g;

export function checkPermissionLiterals(files, knownPermissions) {
  const known = new Set(knownPermissions);
  const problems = [];
  for (const { path, source } of files) {
    if (/\.test\.|\/tests?\//.test(path)) continue;
    for (const match of source.matchAll(PERMISSION_LITERAL)) {
      const key = match[1] || match[2] || match[3];
      if (!known.has(key)) problems.push(`${path} checks unregistered permission "${key}" — add it to @vercentlabs/permissions (and a platform migration) first`);
    }
  }
  return problems;
}

const CLIENT_TENANT_READ =
  /\b(?:body|input|payload|json|data|parsed|params|query|values|form)\??\.(?:organizationId|organization_id|orgId|tenantId|tenant_id)\b|searchParams\.get\(\s*["'](?:organizationId|organization_id|orgId|tenantId|tenant_id)["']\s*\)|\b(?:organizationId|organization_id|orgId|tenantId|tenant_id)\s*:\s*z\./;

export function checkClientTenantIdentity(files) {
  const problems = [];
  for (const { path, source } of files) {
    if (!/^apps\/web\/src\/(app\/api|features\/[^/]+\/server|core)\//.test(path) || /\.test\./.test(path)) continue;
    if (/\[(organizationId|orgId|tenantId)\]/.test(path)) problems.push(`${path}: tenant identity must never be a URL segment`);
    if (CLIENT_TENANT_READ.test(source)) problems.push(`${path} reads a tenant identity from request input; organizationId comes only from the authenticated session/principal`);
  }
  return problems;
}

// Only these legacy per-module context helpers may call the module-access
// primitives directly; new server code uses workspaceRoute() or the
// request's WorkspaceAccessSnapshot (apps/web/src/core/access.ts).
export function checkAccessBoundaryUse(files) {
  const problems = [];
  for (const { path, source } of files) {
    if (/\.test\./.test(path)) continue;
    if (/from\s+["']@vercentlabs\/api\/(?!access["'])[^"']+["']/.test(source)) problems.push(`${path} deep-imports @vercentlabs/api internals; use "@vercentlabs/api" or "@vercentlabs/api/access"`);
    if (path.startsWith("apps/") && /from\s+["'](?:\.\.\/)+services\/api\//.test(source)) problems.push(`${path} imports services/api by relative path; use the package boundary`);
    if (
      path.startsWith("services/api/src/") &&
      !path.startsWith("services/api/src/core/access/") &&
      /from\s+["'][./]*core\/access\/(?!index\.js)[^"']+["']|from\s+["']\.\/access\/(?!index\.js)[^"']+["']|from\s+["']\.\.\/access\/(?!index\.js)[^"']+["']/.test(source)
    ) {
      problems.push(`${path} imports a private Shared Access file; import core/access/index.js`);
    }
    if (path.startsWith("apps/web/src/") && /\b(?:assertModuleAccessible|resolveModuleAccess|getAccessibleModules)\s*\(/.test(source)) {
      problems.push(`${path} calls a module-access primitive directly; use workspaceRoute({ module }) or getWorkspaceAccessSnapshot()`);
    }
  }
  return problems;
}

// Files allowed to hold a literal list of (nearly) every ERP module key.
export const MODULE_LIST_EXCEPTIONS = Object.freeze({
  "packages/shared-types/src/modules.js": "the module catalogue itself",
  "packages/permissions/src/roles.js": "CURRENT_MODULE_KEYS + per-module role templates",
  "packages/permissions/src/roles.d.ts": "types for CURRENT_MODULE_KEYS",
  "packages/permissions/src/module-access.js": "canonical module → view permission map",
  "apps/web/src/shell/navigation/module-navigation-registry.ts": "per-module navigation config keyed by the catalogue (UI, not a catalogue)",
  "services/api/src/core/platform/numbering/registry.js": "document types and their owning module (not a catalogue); verify:platform-services checks every key against ERP_MODULE_CATALOG",
});

export function checkModuleCatalogueCopies(files, moduleKeys) {
  const problems = [];
  const threshold = Math.max(6, moduleKeys.length - 3);
  for (const { path, source } of files) {
    if (/\.test\.|\/tests?\/|^packages\/landing-content\/|^apps\/landing\//.test(path) || MODULE_LIST_EXCEPTIONS[path]) continue;
    const hits = moduleKeys.filter((key) => new RegExp(`["'\`]${key.replace(/[-]/g, "\\-")}["'\`]`).test(source)).length;
    if (hits >= threshold) problems.push(`${path} hard-codes ${hits} module keys — derive from ERP_MODULE_CATALOG (@vercentlabs/shared-types) instead of creating another module catalogue`);
  }
  return problems;
}

// ------------------------------------------------- Shared Access administration

// Functions that were superseded and must not come back under the same name.
export const RETIRED_DEFINITIONS = Object.freeze({
  setUserCompanyAccess: "use setUserAccessScope (one atomic company + branch mutation)",
  setUserBranchAccess: "use setUserAccessScope (one atomic company + branch mutation)",
  createInAppNotification: "use createNotification (the one platform notification writer, category-registered)",
});

export function checkRetiredDefinitions(files) {
  const problems = [];
  for (const { path, source } of files) {
    for (const [name, replacement] of Object.entries(RETIRED_DEFINITIONS)) {
      if (new RegExp(String.raw`(?:^|\n)(?:export\s+)?(?:async\s+)?(?:function\s+${name}\b|(?:const|let)\s+${name}\s*=)`).test(source)) {
        problems.push(`${path} reintroduces ${name}: ${replacement}`);
      }
    }
  }
  return problems;
}

// Tables holding access state, and the ONLY files allowed to write them.
// (services/api/src/core/access-administration.js also writes the
// membership_* tables through setUserAccessScope's table map.)
export const ACCESS_STATE_WRITERS = Object.freeze({
  organization_modules: ["services/api/src/core/platform/module-administration.js"],
  membership_company_access: ["services/api/src/core/access-administration.js", "services/api/src/core/auth-lifecycle.js"],
  membership_branch_access: [
    "services/api/src/core/access-administration.js",
    "services/api/src/core/auth-lifecycle.js",
    // createBranch grants the delegated creator the branch it just created.
    "services/api/src/core/organization-administration.js",
  ],
  organization_invitations: ["services/api/src/core/auth-lifecycle.js"],
  organization_invitation_roles: ["services/api/src/core/auth-lifecycle.js"],
  organization_invitation_company_access: ["services/api/src/core/auth-lifecycle.js"],
  organization_invitation_branch_access: ["services/api/src/core/auth-lifecycle.js"],
});

export function checkAccessStateWriters(files) {
  const problems = [];
  for (const { path, source } of files) {
    if (/\.test\.|\/tests?\//.test(path) || path.endsWith(".d.ts")) continue;
    for (const [table, owners] of Object.entries(ACCESS_STATE_WRITERS)) {
      const writes = new RegExp(String.raw`(INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+(public\.)?${table}\b`, "i").test(source);
      if (writes && !owners.includes(path)) problems.push(`${path} writes ${table}; only ${owners.join(", ")} may (one canonical implementation)`);
    }
  }
  return problems;
}

// Normalized invitation access is canonical: any code that creates an
// invitation must write organization_invitation_roles too, never only the
// deprecated organization_invitations.role_id/company_ids/branch_ids columns.
export function checkInvitationWrites(files) {
  const problems = [];
  for (const { path, source } of files) {
    if (/\.test\.|\/tests?\//.test(path)) continue;
    if (/INSERT\s+INTO\s+(public\.)?organization_invitations\b/i.test(source) && !/INSERT\s+INTO\s+(public\.)?organization_invitation_roles\b/i.test(source)) {
      problems.push(`${path} creates invitations without writing the canonical organization_invitation_roles`);
    }
  }
  return problems;
}

// Shared Access administration routes must use the workspaceRoute
// composition. The caller's own sessions are self-service (Auth), not
// administration, and are listed explicitly.
export const ADMIN_ROUTE_PREFIXES = Object.freeze(["apps/web/src/app/api/settings/", "apps/web/src/app/api/auth/invitations/manage/"]);
export const ADMIN_ROUTE_FILES = Object.freeze(["apps/web/src/app/api/auth/invitations/route.ts"]);
export const ADMIN_ROUTE_EXCEPTIONS = Object.freeze({
  "apps/web/src/app/api/settings/sessions/route.ts": "Self-service: the caller's own sessions (Auth), not administration.",
  "apps/web/src/app/api/settings/sessions/[id]/route.ts": "Self-service: the caller's own sessions (Auth), not administration.",
});

export function checkAdminRoutesUseWorkspaceRoute(files) {
  const problems = [];
  for (const { path, source } of files) {
    if (!path.endsWith("/route.ts")) continue;
    const isAdmin = ADMIN_ROUTE_FILES.includes(path) || ADMIN_ROUTE_PREFIXES.some((prefix) => path.startsWith(prefix));
    if (!isAdmin || ADMIN_ROUTE_EXCEPTIONS[path]) continue;
    if (!/\bworkspaceRoute\s*\(/.test(source)) problems.push(`${path} is a Shared Access administration route but does not use workspaceRoute()`);
    if (/\brequire(Api)?Workspace\s*\(/.test(source)) problems.push(`${path} resolves the session itself; let workspaceRoute() do it`);
  }
  return problems;
}

// Company Administrator must stay an explicit least-privilege allow-list.
export function checkCompanyAdministratorTemplate(rolesSource) {
  const start = rolesSource.indexOf('slug: "company_administrator"');
  if (start === -1) return ["packages/permissions/src/roles.js: company_administrator template not found"];
  const block = rolesSource.slice(start, rolesSource.indexOf("\n  },", start));
  const problems = [];
  if (!/permissions:\s*COMPANY_ADMINISTRATOR_PERMISSIONS\b/.test(block)) {
    problems.push("company_administrator must use the explicit COMPANY_ADMINISTRATOR_PERMISSIONS allow-list");
  }
  const listStart = rolesSource.indexOf("export const COMPANY_ADMINISTRATOR_PERMISSIONS");
  const list = rolesSource.slice(listStart, rolesSource.indexOf("]);", listStart));
  if (/ALL_PERMISSIONS|\.filter\(|\.\.\./.test(list)) problems.push("COMPANY_ADMINISTRATOR_PERMISSIONS must be literal keys, not derived from ALL_PERMISSIONS");
  return problems;
}
