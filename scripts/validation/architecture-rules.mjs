// Deterministic architecture + Shared Access rules, as pure functions over
// `{ path, source }` records so each rule is unit-tested
// (architecture-rules.test.mjs) and the drivers (verify-architecture.mjs,
// verify-access-architecture.mjs) stay thin.
//
// Every rule exists to stop a specific kind of drift coding agents have
// introduced before. Exceptions are explicit, named and carry a reason;
// shrinking an exception list is always welcome, growing one needs review.
// See docs/01-standards/SHARED_PLATFORM_ARCHITECTURE.md.

import { posix as posixPath } from "node:path";

// ---------------------------------------------------------------- frontend

export const WEB_SRC_ENTRIES = Object.freeze(["app", "core", "features", "shell", "shared"]);
// Files Next.js only recognises at the src root (framework entry points).
export const WEB_SRC_FRAMEWORK_FILES = Object.freeze(["instrumentation.ts", "proxy.ts"]);
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

// ------------------------------------------------------- CRM self boundary
// services/api/src/modules/crm/index.js is CRM's public boundary for code
// OUTSIDE the module. CRM's own runtime implementation must import the owning
// capability file directly; calling back through the boundary creates
// implementation -> index.js -> implementation cycles. Declaration (.d.ts)
// type imports are not runtime edges and are not checked here.

export const CRM_MODULE_ROOT = "services/api/src/modules/crm";
const CRM_BOUNDARY_TARGETS = new Set([CRM_MODULE_ROOT, `${CRM_MODULE_ROOT}/index`, `${CRM_MODULE_ROOT}/index.js`]);

export function checkCrmSelfBoundaryImports(files) {
  const problems = [];
  for (const { path: file, source } of files) {
    if (!file.startsWith(`${CRM_MODULE_ROOT}/`) || !/\.(js|mjs)$/.test(file)) continue;
    if (posixPath.dirname(file) === CRM_MODULE_ROOT) continue; // the boundary itself
    const specifiers = [
      ...source.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gs),
      ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const target = posixPath.normalize(posixPath.join(posixPath.dirname(file), specifier));
      if (!CRM_BOUNDARY_TARGETS.has(target)) continue;
      problems.push(
        `${file} imports the CRM public boundary ("${specifier}" -> ${CRM_MODULE_ROOT}/index.js); ` +
          "CRM implementation must import the owning capability file directly — the boundary is only for code outside the CRM module",
      );
    }
  }
  return problems;
}

// Capability edges that must stay one-way inside CRM. The key may not import
// any listed capability at runtime. Each ban carries its reason.
export const CRM_CAPABILITY_IMPORT_BANS = Object.freeze({
  "data-management": Object.freeze({
    conversions: "conversion uses the CRM record kernel, never the other way round; shared helpers belong in data-management (e.g. condition-matching.js)",
  }),
});

export function checkCrmCapabilityImportBans(files) {
  const problems = [];
  for (const { path: file, source } of files) {
    if (!file.startsWith(`${CRM_MODULE_ROOT}/`) || !/\.(js|mjs)$/.test(file)) continue;
    const capability = file.slice(CRM_MODULE_ROOT.length + 1).split("/")[0];
    const bans = CRM_CAPABILITY_IMPORT_BANS[capability];
    if (!bans) continue;
    const specifiers = [
      ...source.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gs),
      ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
    ].map((match) => match[1]);
    for (const specifier of specifiers) {
      if (!specifier.startsWith(".")) continue;
      const target = posixPath.normalize(posixPath.join(posixPath.dirname(file), specifier));
      if (!target.startsWith(`${CRM_MODULE_ROOT}/`)) continue;
      const targetCapability = target.slice(CRM_MODULE_ROOT.length + 1).split("/")[0];
      if (bans[targetCapability])
        problems.push(`${file} imports ${targetCapability} ("${specifier}"); ${capability} must not depend on ${targetCapability}: ${bans[targetCapability]}`);
    }
  }
  return problems;
}

function crmRelativeImportTargets(file, source) {
  return [
    ...source.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gs),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ]
    .map((match) => match[1])
    .filter((specifier) => specifier.startsWith("."))
    .map((specifier) => ({ specifier, target: posixPath.normalize(posixPath.join(posixPath.dirname(file), specifier)) }));
}

// File-level dependency directions inside CRM. Paths are relative to the CRM
// module root; a path ending in "/" covers the whole directory.
export const CRM_KERNEL_IMPORT_BANS = Object.freeze([
  Object.freeze({
    from: "data-management/",
    to: "activities/",
    except: Object.freeze(["data-management/offline-sync.js"]),
    reason: "entity access, communication access and activity predicates belong to the record kernel (entity-access.js, communication-access.js, activity-query-rules.js); only offline sync orchestrates activity commands",
  }),
  Object.freeze({
    from: "data-management/record-policy.js",
    to: "data-management/resource-query-service.js",
    except: Object.freeze([]),
    reason: "record scope and projection sit below the record queries; checks that need a scoped read belong in resource-validation.js",
  }),
]);

export function checkCrmKernelImportBans(files) {
  const problems = [];
  const covers = (pattern, path) => (pattern.endsWith("/") ? path.startsWith(pattern) : path === pattern);
  for (const { path: file, source } of files) {
    if (!file.startsWith(`${CRM_MODULE_ROOT}/`) || !/\.(js|mjs)$/.test(file)) continue;
    const local = file.slice(CRM_MODULE_ROOT.length + 1);
    for (const ban of CRM_KERNEL_IMPORT_BANS) {
      if (!covers(ban.from, local) || ban.except.includes(local)) continue;
      for (const { specifier, target } of crmRelativeImportTargets(file, source)) {
        if (target.startsWith(`${CRM_MODULE_ROOT}/`) && covers(ban.to, target.slice(CRM_MODULE_ROOT.length + 1)))
          problems.push(`${file} imports "${specifier}"; ${ban.from} must not depend on ${ban.to}: ${ban.reason}`);
      }
    }
  }
  return problems;
}

// The only import cycles allowed among CRM runtime files, each a genuine
// mutual recursion rather than a misplaced helper. Any other strongly
// connected group of files is reported.
export const CRM_ALLOWED_RUNTIME_CYCLES = Object.freeze([
  // Automation actions create/update records through the generic mutation
  // path, and that path runs automation after each write.
  Object.freeze(["data-management/automation/automation-engine.js", "data-management/resource-mutation-service.js"]),
  // Lead stage catalogue, stage migration jobs and the transition engine
  // (pre-existing; outside the record-kernel cleanup).
  Object.freeze(["lead-management/lifecycle/stage-catalog.js", "lead-management/lifecycle/stage-migration.js", "lead-management/lifecycle/transition-engine.js"]),
]);

export function checkCrmRuntimeCycles(files) {
  const runtime = files.filter(({ path: file }) => file.startsWith(`${CRM_MODULE_ROOT}/`) && /\.(js|mjs)$/.test(file));
  const graph = new Map(runtime.map(({ path: file }) => [file, new Set()]));
  for (const { path: file, source } of runtime)
    for (const { target } of crmRelativeImportTargets(file, source)) if (graph.has(target) && target !== file) graph.get(file).add(target);
  // Tarjan's strongly connected components.
  let counter = 0;
  const index = new Map(), low = new Map(), stack = [], onStack = new Set(), components = [];
  const visit = (node) => {
    index.set(node, counter); low.set(node, counter); counter += 1; stack.push(node); onStack.add(node);
    for (const next of graph.get(node)) {
      if (!index.has(next)) { visit(next); low.set(node, Math.min(low.get(node), low.get(next))); }
      else if (onStack.has(next)) low.set(node, Math.min(low.get(node), index.get(next)));
    }
    if (low.get(node) !== index.get(node)) return;
    const component = [];
    let member;
    do { member = stack.pop(); onStack.delete(member); component.push(member.slice(CRM_MODULE_ROOT.length + 1)); } while (member !== node);
    if (component.length > 1) components.push(component.sort());
  };
  for (const node of graph.keys()) if (!index.has(node)) visit(node);
  const allowed = new Set(CRM_ALLOWED_RUNTIME_CYCLES.map((cycle) => [...cycle].sort().join("|")));
  return components
    .filter((component) => !allowed.has(component.join("|")))
    .map((component) => `CRM runtime import cycle across ${component.length} files: ${component.join(", ")}; move the shared rule or primitive below its users instead of importing back`);
}

// The package root (services/api/src/index.js and index.d.ts) reaches CRM only
// through the CRM module boundary and the legacy root compatibility barrel;
// that barrel only re-exports CRM files. New CRM contracts go on the module
// boundary (@vercentlabs/api/crm), never straight onto the package root.
export const API_ROOT_INDEX_FILES = Object.freeze(["services/api/src/index.js", "services/api/src/index.d.ts"]);
export const CRM_ROOT_LEGACY_BARRELS = Object.freeze(["services/api/src/compat/crm-root-legacy.js", "services/api/src/compat/crm-root-legacy.d.ts"]);
const API_ROOT_CRM_ALLOWED = Object.freeze(["./modules/crm/index.js", "./compat/crm-root-legacy.js"]);

export function checkApiRootCrmBoundary(files) {
  const problems = [];
  const specifiers = (source) => [
    ...source.matchAll(/\b(?:import|export)\b[^;]*?\bfrom\s*["']([^"']+)["']/gs),
    ...source.matchAll(/\bimport\(\s*["']([^"']+)["']\s*\)/g),
  ].map((match) => match[1]);
  for (const { path: file, source } of files) {
    if (API_ROOT_INDEX_FILES.includes(file)) {
      for (const specifier of specifiers(source))
        if (/^\.\/modules\/crm\//.test(specifier) && !API_ROOT_CRM_ALLOWED.includes(specifier))
          problems.push(`${file} reaches into CRM through "${specifier}"; export CRM contracts from modules/crm/index.js (@vercentlabs/api/crm) instead of the package root`);
    }
    if (CRM_ROOT_LEGACY_BARRELS.includes(file)) {
      const remainder = source
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\bexport\s*(?:type\s*)?(?:\*|\{[^}]*\})\s*from\s*["'][^"']+["']\s*;/g, "")
        .trim();
      if (remainder)
        problems.push(`${file} is the legacy root CRM compatibility barrel; it may only re-export, found "${remainder.split("\n")[0].slice(0, 80)}"`);
      for (const specifier of specifiers(source))
        if (!/^\.\.\/modules\/crm\//.test(specifier) && !(file.endsWith(".d.ts") && specifier === "../index.js"))
          problems.push(`${file} re-exports "${specifier}"; the legacy root CRM barrel may only re-export CRM files`);
    }
  }
  return problems;
}

// CRM browser clients (apps/web/src/features/crm) share one response/error
// model in features/crm/shared/http: responses are decoded there
// (parseCrmResponse / crmRequest), feature error classes extend CrmApiError
// instead of re-implementing status/code/details, and every TanStack Query key
// is workspace-scoped through scopedQueryKey (or spreads a key built by it).
export const CRM_WEB_ROOT = "apps/web/src/features/crm";
export const CRM_WEB_HTTP_DIR = `${CRM_WEB_ROOT}/shared/http/`;
// Files allowed to decode a response body themselves. Empty today: uploads,
// import/export and public booking all parse through parseCrmResponse.
export const CRM_WEB_CUSTOM_RESPONSE_PARSERS = Object.freeze([]);

export function checkCrmBrowserClients(files) {
  const problems = [];
  for (const { path: file, source } of files) {
    if (!file.startsWith(`${CRM_WEB_ROOT}/`) || !/\.tsx?$/.test(file) || /\.test\.tsx?$/.test(file)) continue;
    const inHttp = file.startsWith(CRM_WEB_HTTP_DIR);
    if (/^\s*\(?\s*["']use client["']\s*\)?\s*;?\s*$/m.test(source) && !/^["']use client["'];?\s*$/.test(source.split("\n")[0]))
      problems.push(`${file} has a "use client" directive that is not the first statement, so Next.js ignores it`);
    if (!inHttp && !CRM_WEB_CUSTOM_RESPONSE_PARSERS.includes(file) && /\.json\(\s*\)/.test(source))
      problems.push(`${file} decodes a response body itself; use parseCrmResponse/crmRequest from features/crm/shared/http (or list a genuinely special client in CRM_WEB_CUSTOM_RESPONSE_PARSERS)`);
    if (!inHttp)
      for (const match of source.matchAll(/class\s+([A-Za-z_$][\w$]*)\s+extends\s+Error\b/g))
        problems.push(`${file} declares ${match[1]} extends Error; CRM API errors extend CrmApiError (features/crm/shared/http/crm-api-error.ts)`);
    for (const match of source.matchAll(/queryKey:\s*\[(?!\s*\.\.\.)/g)) {
      const line = source.slice(0, match.index).split("\n").length;
      problems.push(`${file}:${line} builds an unscoped query key; use scopedQueryKey(workspace, ...) so caches never cross organizations or companies`);
    }
  }
  return problems;
}

// CRM frontend ownership (apps/web/src/features/crm): one directory per
// product area, plus `shared` for Record-360 panels, HTTP and other
// cross-area primitives. Route URLs live separately under app/(workspace)/crm.
// The old parallel buckets (leads, accounts, settings, forecast, ...) must not
// come back beside these areas; `index.ts` is CRM's public surface for other
// web features.
export const CRM_WEB_AREAS = Object.freeze(["customers", "data", "home", "inbox", "insights", "pipeline", "public", "setup", "shared", "work"]);
export const CRM_WEB_ROOT_FILES = Object.freeze(["index.ts"]);

export function checkCrmWebOwnership(entries) {
  const problems = [];
  for (const { name, isDirectory } of entries) {
    if (isDirectory && !CRM_WEB_AREAS.includes(name))
      problems.push(`${CRM_WEB_ROOT}/${name}/ is not a CRM product area (${CRM_WEB_AREAS.join(", ")}); put it under the owning area or shared`);
    if (!isDirectory && !CRM_WEB_ROOT_FILES.includes(name))
      problems.push(`${CRM_WEB_ROOT}/${name} is a loose file; CRM code belongs in a product area or shared`);
  }
  for (const area of CRM_WEB_AREAS)
    if (!entries.some((entry) => entry.isDirectory && entry.name === area)) problems.push(`${CRM_WEB_ROOT}/${area}/ is missing`);
  return problems;
}

// CRM files kept only as compatibility re-export boundaries after their code
// moved to owning files. They may contain comments and `export { ... } from`
// statements, nothing else, so they cannot grow back into implementations.
export const CRM_COMPATIBILITY_BARRELS = Object.freeze([
  `${CRM_MODULE_ROOT}/activities/communications.js`,
  `${CRM_MODULE_ROOT}/master-data/account-intelligence.js`,
]);

export function checkCrmCompatibilityBarrels(files) {
  const problems = [];
  for (const { path: file, source } of files) {
    if (!CRM_COMPATIBILITY_BARRELS.includes(file)) continue;
    const remainder = source
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\bexport\s*\{[^}]*\}\s*from\s*["'][^"']+["']\s*;/g, "")
      .trim();
    if (remainder)
      problems.push(`${file} is a compatibility re-export boundary; move "${remainder.split("\n")[0].slice(0, 80)}" into the owning implementation file`);
  }
  return problems;
}

// ------------------------------------------------------------- api layout

export const API_CORE_DOMAINS = Object.freeze(["access", "auth", "organization", "billing", "platform", "security", "release"]);

// Generic cross-module helpers that intentionally stay flat in core/ (no
// owning Shared Platform domain): money/decimal maths, idempotency keys,
// inventory row locks, master-data lookups, document references, tags and
// the tax engine. Auth, organisation, security and access implementations
// live behind their domain directories. New core code goes in a domain.
export const LEGACY_FLAT_CORE_FILES = Object.freeze([
  "decimal", "idempotency", "inventory-lock", "master-data", "references", "tags", "tax-engine",
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
  resolveSessionContext: "services/api/src/core/auth/session.js",
  tokenHash: "services/api/src/core/auth/session.js",
  hashPassword: "services/api/src/core/auth/session.js",
  verifyPassword: "services/api/src/core/auth/session.js",
  hasSessionPermission: "services/api/src/core/access/control-runtime.js",
  requireSessionPermission: "services/api/src/core/access/control-runtime.js",
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
  setUserAccessScope: "services/api/src/core/access/administration-service.js",
  listGrantableRolesForActor: "services/api/src/core/access/administration-service.js",
  listGrantableScope: "services/api/src/core/access/administration-service.js",
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
  "services/api/src/modules/crm/master-data/lead-capture.js":
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
  "packages/permissions/src/field-security.js": "per-module field-security audit keyed by the catalogue (not a catalogue); verify-field-security checks every catalogue module is covered",
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
// (services/api/src/core/access/administration-service.js also writes the
// membership_* tables through setUserAccessScope's table map.)
export const ACCESS_STATE_WRITERS = Object.freeze({
  organization_modules: ["services/api/src/core/platform/module-administration.js"],
  membership_company_access: ["services/api/src/core/access/administration-service.js", "services/api/src/core/auth/lifecycle.js"],
  membership_branch_access: [
    "services/api/src/core/access/administration-service.js",
    "services/api/src/core/auth/lifecycle.js",
    // createBranch grants the delegated creator the branch it just created.
    "services/api/src/core/organization/administration.js",
  ],
  organization_invitations: ["services/api/src/core/auth/lifecycle.js"],
  organization_invitation_roles: ["services/api/src/core/auth/lifecycle.js"],
  organization_invitation_company_access: ["services/api/src/core/auth/lifecycle.js"],
  organization_invitation_branch_access: ["services/api/src/core/auth/lifecycle.js"],
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
