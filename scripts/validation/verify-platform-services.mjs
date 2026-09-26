#!/usr/bin/env node
// `pnpm verify:platform-services` (static half): Shared Platform services
// ownership invariants from Prompt 5 (integrations, files, data exchange,
// documents, numbering, configuration, privacy, AI, workflows, reporting).
// Reads source (and the registries themselves); the unit tests it is paired
// with run the pure rules.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));
const load = (relative) => import(pathToFileURL(path.join(root, relative)).href);
const code = (source) => source.replace(/\/\*[\s\S]*?\*\//g, "").split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");

function walk(relative, filter, out = []) {
  const full = path.join(root, relative);
  if (!fs.existsSync(full)) return out;
  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    if ([".next", "node_modules", "e2e", "tests", "dist"].includes(entry.name) || entry.name.startsWith(".next")) continue;
    const child = path.join(relative, entry.name).replaceAll("\\", "/");
    if (entry.isDirectory()) walk(child, filter, out);
    else if (filter(child)) out.push(child);
  }
  return out;
}

const problems = [];
const section = (label, found) => {
  if (found.length) for (const problem of found) console.error(`FAIL  ${label}: ${problem}`);
  else console.log(`OK    ${label}`);
  problems.push(...found);
};

const P = "services/api/src/core/platform";
const serverFiles = [...walk("services", (f) => /\.(js|mjs)$/.test(f) && !f.endsWith(".d.ts")), ...walk("packages", (f) => /\.(js|mjs)$/.test(f))];
const webFiles = walk("apps/web/src", (f) => /\.(ts|tsx)$/.test(f));
const allFiles = [...serverFiles, ...webFiles];
const matching = (pattern, allowed = []) => allFiles.filter((file) => !allowed.includes(file) && pattern.test(code(read(file))));

// 1. Flat modules replaced by the platform domains.
section(
  "legacy flat platform modules are removed",
  ["api-keys", "oauth", "inbound-mail", "configuration", "privacy", "ai-governance", "document-numbering"]
    .flatMap((name) => [`services/api/src/core/${name}.js`, `services/api/src/core/${name}.d.ts`])
    .filter(exists)
    .map((file) => `${file} must not exist (moved under ${P}/)`),
);

// 2. Developer API.
const { API_SCOPES } = await load(`${P}/integrations/api-keys/scopes.js`);
const v1Routes = walk("apps/web/src/app/api/v1", (f) => f.endsWith("/route.ts"));
const consumedScopes = new Set(v1Routes.flatMap((file) => [...read(file).matchAll(/scope:\s*"([^"]+)"/g)].map((match) => match[1])));
section("API scopes: registered, described and consumed by a real /api/v1 route", [
  ...[...consumedScopes].filter((scope) => !API_SCOPES.some((entry) => entry.key === scope)).map((scope) => `route uses unregistered scope ${scope}`),
  ...API_SCOPES.filter((scope) => !consumedScopes.has(scope.key)).map((scope) => `scope ${scope.key} is registered but no /api/v1 route consumes it`),
  ...API_SCOPES.filter((scope) => !scope.displayName || !scope.description || !scope.risk).map((scope) => `scope ${scope.key} is not fully described`),
]);
section("no wildcard API scopes", [
  ...(/includes\("\*"\)/.test(code(read(`${P}/integrations/api-keys/service.js`))) ? ["api-keys service grants '*'"] : []),
  ...(read("database/platform/migrations/064_developer_apps_and_api_scopes.sql").includes("api_keys_no_wildcard_scope") ? [] : ["the no-wildcard constraint is missing"]),
]);
section(
  "/api/v1 routes authenticate only with API keys",
  v1Routes.flatMap((file) => {
    const source = read(file);
    return [
      ...(!/\bapiKeyRoute\(/.test(source) ? [`${file} does not use apiKeyRoute`] : []),
      ...(/workspaceRoute|requireWorkspace|requireApiWorkspace|cookies\(/.test(source) ? [`${file} uses session authentication`] : []),
    ];
  }),
);

// 3. OAuth.
const oauth = code(read(`${P}/integrations/oauth/service.js`));
section("OAuth callback is server-owned; PKCE S256; profiles only", [
  ...(/input\??\.redirectUri|input\??\.scopes/.test(oauth) ? ["the OAuth service reads a browser-supplied redirect URI or scopes"] : []),
  ...(!/code_challenge_method", "S256"/.test(oauth) ? ["PKCE S256 is not requested"] : []),
  ...walk("apps/web/src/app/api/settings/integrations/oauth", (f) => f.endsWith("/route.ts"))
    .filter((file) => /redirectUris*:s*z.|scopess*:s*z.|searchParams.get("redirect_?uri")/i.test(read(file)))
    .map((file) => `${file} accepts a redirect URI or scopes`),
]);

// 4. One webhook/outbox implementation.
section("one webhook delivery implementation", [
  ...["services/worker/src/ssrf.js", "services/worker/src/webhook-delivery.js", "services/worker/src/outbox.js", "services/worker/src/handlers/crm-webhook-deliver.js"].filter(exists).map((file) => `${file} must not exist`),
  ...matching(/\bundici\b/, [`${P}/integrations/webhooks/transport.js`]).map((file) => `${file} makes its own undici requests`),
  ...matching(/\b(crm_outbox_events|crm_webhook_subscriptions)\b/).map((file) => `${file} still uses the retired CRM outbox/webhook tables`),
  ...matching(/INSERT\s+INTO\s+tenant\.platform_events/i, [`${P}/events/service.js`]).map((file) => `${file} writes platform_events directly (use publishDomainEvent)`),
  ...matching(/(INSERT\s+INTO|UPDATE)\s+tenant\.webhook_(deliveries|subscriptions)/i, [`${P}/integrations/webhooks/service.js`]).map((file) => `${file} writes webhook tables directly`),
]);

// 5. One mail transport.
section("one outbound mail transport", matching(/from\s+["']nodemailer["']/, [`${P}/mail/transport.js`]).map((file) => `${file} creates its own SMTP transport`));

// 6. Files.
section("files: metadata via the platform service, bytes in object storage", [
  ...matching(/INSERT\s+INTO\s+(public\.)?attachments\b/i, [`${P}/files/service.js`]).map((file) => `${file} inserts file rows directly`),
  ...(read(`${P}/files/service.js`).includes("'object'") ? [] : ["new files are not written with storage_mode 'object'"]),
  ...(read("database/platform/migrations/063_shared_files_object_storage.sql").includes("attachments_object_has_no_content") ? [] : ["the object-row-has-no-bytes constraint is missing"]),
]);

// 7. Exports and imports.
section("export files are artifacts, not job JSON", [
  ...matching(/result_manifest[^;]*\bcsv\b/).map((file) => `${file} writes CSV content into a job manifest`),
  ...(exists("apps/web/src/features/crm/import-export/csv.ts") ? ["the browser still parses CSV authoritatively"] : []),
  ...(/parseCsvUpload/.test(read("apps/web/src/app/api/crm/leads/import/preview/route.ts")) ? [] : ["lead import preview does not parse the upload server-side"]),
]);

// 8. One numbering system.
section("one numbering implementation", [
  ...matching(/\bnumbering_series\b/, ["services/api/src/core/organization/registration.js"]).filter((file) => file.startsWith("services/") || file.startsWith("apps/")).map((file) => `${file} still uses public.numbering_series`),
  ...matching(/INSERT\s+INTO\s+tenant\.document_sequences/i, [`${P}/numbering/service.js`]).map((file) => `${file} allocates numbers outside the numbering service`),
]);

// 9. Registries.
const { CONFIGURATION_DEFINITIONS } = await load(`${P}/configuration/registry.js`);
const configurationCalls = allFiles.flatMap((file) => [...code(read(file)).matchAll(/(?:getConfigurationValue|isFeatureFlagEnabled)\([^,]+,\s*[^,]+,\s*"([^"]+)",\s*"([^"]+)"/g)].map((match) => ({ file, namespace: match[1], key: match[2] })));
section("configuration keys used in code are registered", configurationCalls.filter((call) => !CONFIGURATION_DEFINITIONS.some((definition) => definition.namespace === call.namespace && definition.key === call.key)).map((call) => `${call.file} reads unregistered ${call.namespace}.${call.key}`));
const { DOMAIN_EVENTS } = await load(`${P}/events/registry.js`);
const { WORKFLOW_ACTIONS } = await load(`${P}/workflows/registry.js`);
section("event and workflow action registries are well-formed", [
  ...DOMAIN_EVENTS.filter((event) => typeof event.project !== "function" || !event.label).map((event) => `${event.key} has no projection or label`),
  ...(WORKFLOW_ACTIONS.map((action) => action.key).join(",") === "notify" ? [] : ["workflow actions beyond 'notify' need a reviewed command contract first"]),
]);
const { REPORT_DATASETS } = await load("services/api/src/orchestration/reporting/datasets.js");
section("report datasets are real, permissioned and PII-free", REPORT_DATASETS.flatMap((dataset) => [
  ...(!dataset.requiredPermissions?.length ? [`${dataset.key} has no permission`] : []),
  ...(typeof dataset.execute !== "function" ? [`${dataset.key} has no provider`] : []),
  // Word tokens of the column key (camelCase / snake_case), so "companyName" is not "pan".
  ...dataset.columns
    .filter((column) => column.key.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase().split("_").some((token) => ["email", "phone", "mobile", "gstin", "pan"].includes(token)))
    .map((column) => `${dataset.key} exports ${column.key}`),
]));

// 10. verify:t01 no longer reads the parked snapshot.
section("verify:t01 reads only live code", /recovered-platform-code\/apps/.test(code(read("scripts/validation/verify-t01-shared-platform.mjs"))) ? ["verify-t01 still reads the parked recovered snapshot"] : []);

// 11. Route ownership.
const PERMISSIONS = [
  ["apps/web/src/app/api/settings/integrations", /CORE_PERMISSIONS\.integrations(View|Manage)\b/],
  ["apps/web/src/app/api/settings/numbering", /CORE_PERMISSIONS\.numberingManage\b/],
  ["apps/web/src/app/api/settings/feature-configuration", /CORE_PERMISSIONS\.platformConfigurationManage\b/],
  ["apps/web/src/app/api/settings/ai-governance", /CORE_PERMISSIONS\.platformAiManage\b/],
  ["apps/web/src/app/api/settings/automations", /CORE_PERMISSIONS\.platformWorkflowsManage\b/],
  ["apps/web/src/app/api/privacy", /CORE_PERMISSIONS\.platformPrivacyManage\b/],
];
section(
  "Prompt 5 settings routes: workspaceRoute, exact permission, never billing-gated",
  PERMISSIONS.flatMap(([dir, permission]) =>
    walk(dir, (f) => f.endsWith("/route.ts")).flatMap((file) => {
      const source = read(file);
      if (file.includes("/oauth/callback/")) return /\bworkspaceRoute\(/.test(source) ? [] : [`${file} does not use workspaceRoute`];
      return [
        ...(!/\bworkspaceRoute\(/.test(source) ? [`${file} does not use workspaceRoute`] : []),
        ...(!permission.test(source) ? [`${file} does not require its permission`] : []),
        ...(/billingWrite\s*:\s*true/.test(source) ? [`${file} is billing-gated`] : []),
      ];
    }),
  ),
);
section(
  "reports and documents routes use workspaceRoute",
  [...walk("apps/web/src/app/api/reports", (f) => f.endsWith("/route.ts")), ...walk("apps/web/src/app/api/documents", (f) => f.endsWith("/route.ts"))].filter((file) => !/\bworkspaceRoute\(/.test(read(file))).map((file) => `${file} does not use workspaceRoute`),
);
section("public inbound mail route is signature-authenticated, not session", (() => {
  const source = read("apps/web/src/app/api/platform/mail/inbound/[routeKey]/route.ts");
  return [...(/requireWorkspace|workspaceRoute|cookies\(/.test(source) ? ["uses a session"] : []), ...(!/x-inbound-signature/.test(source) ? ["does not pass the signature header"] : [])];
})());
section("every numbered document type belongs to a catalogue module", await (async () => {
  const { DOCUMENT_TYPES } = await load(`${P}/numbering/registry.js`);
  const { ERP_MODULE_CATALOG } = await load("packages/shared-types/src/modules.js");
  const known = new Set(ERP_MODULE_CATALOG.map((module) => module.key));
  return DOCUMENT_TYPES.filter((type) => !known.has(type.moduleKey)).map((type) => `${type.key} names unknown module "${type.moduleKey}"`);
})());
section("Settings navigation lists the platform pages as available (and they exist)", (() => {
  const nav = read("apps/web/src/shell/navigation/settings-navigation-registry.ts");
  return ["integrations", "privacy", "feature-configuration", "automations", "ai-governance", "numbering"].flatMap((id) => [
    ...(!new RegExp(`id: "${id}"[^\\n]*status: "AVAILABLE"`).test(nav) ? [`settings item "${id}" is not AVAILABLE`] : []),
    ...(!exists(`apps/web/src/app/(workspace)/settings/${id}/page.tsx`) ? [`settings page /settings/${id} is missing`] : []),
  ]);
})());
section("CI runs the platform services checks", (() => {
  const ci = read(".github/workflows/erp-ci.yml");
  return ["pnpm verify:platform-services", "pnpm test:platform-services:db"].filter((command) => !ci.includes(`run: ${command}`)).map((command) => `CI does not run ${command}`);
})());

if (problems.length) {
  console.error(`\n${problems.length} platform services architecture problem(s).`);
  process.exit(1);
}
console.log("\nShared Platform services architecture: OK");
