import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");
const exists = (relative) => fs.existsSync(path.join(root, relative));

const profile = JSON.parse(
  read("docs/implementation/crm-product-acceptance-profile.json"),
);
const ledger = JSON.parse(
  read("docs/implementation/four-module-feature-evidence.json"),
);
const crm = ledger.filter((row) => row.module === "CRM");

assert.equal(
  crm.length,
  profile.capabilityCount,
  "CRM register must contain 83 capabilities.",
);

const missingPaths = [];
for (const row of crm) {
  assert.equal(
    row.registerStatus,
    "Implemented",
    `${row.id} is not implemented.`,
  );
  assert.equal(
    row.acceptanceStatus,
    "verified",
    `${row.id} lacks verified internal acceptance.`,
  );
  assert.ok(
    row.implementationPaths?.length,
    `${row.id} has no implementation paths.`,
  );
  assert.ok(row.testPaths?.length, `${row.id} has no test paths.`);
  for (const candidate of [...row.implementationPaths, ...row.testPaths]) {
    if (!exists(candidate)) missingPaths.push({ id: row.id, path: candidate });
  }
}
assert.deepEqual(
  missingPaths,
  [],
  `CRM evidence contains missing paths:\n${JSON.stringify(missingPaths, null, 2)}`,
);

const actionWorkspaceRoutes = profile.operationalWorkspaceRoutes.filter(
  (route) => route !== "/crm/mobile-readiness",
);
for (const route of profile.operationalWorkspaceRoutes) {
  const relative = `apps/web/src/app/(app)${route}/page.tsx`;
  assert.ok(exists(relative), `${route} has no workspace page.`);
  const source = read(relative);
  assert.match(
    source,
    /CrmWorkspaceShell/,
    `${route} does not use the canonical CRM shell.`,
  );
  assert.match(
    source,
    /AccessDenied/,
    `${route} does not render an access-denied state.`,
  );
  assert.doesNotMatch(
    source,
    /return null;/,
    `${route} can render a blank permission state.`,
  );
  assert.doesNotMatch(
    source,
    /return notFound\(\)/,
    `${route} hides permission errors as 404s.`,
  );
  if (actionWorkspaceRoutes.includes(route)) {
    assert.match(
      source,
      /CrmActionWorkbench/,
      `${route} has no operational action workspace.`,
    );
  }
}

const layout = read("apps/web/src/app/layout.tsx");
assert.match(layout, /import "\.\/crm-product\.css";/);
assert.ok(
  layout.indexOf('import "./crm-product.css";') >
    layout.indexOf('import "./enterprise-modules.css";'),
  "CRM product CSS must be imported after legacy module styles.",
);
const css = read("apps/web/src/app/crm-product.css");
assert.match(css, /\.crm-product-shell/);
assert.doesNotMatch(css, /^:root\s*\{/m, "CRM product CSS must remain scoped.");

const rootPackage = JSON.parse(read("package.json"));
const webPackage = JSON.parse(read("apps/web/package.json"));
assert.equal(
  rootPackage.scripts["verify:crm-product"],
  "node scripts/validation/verify-crm-product-completion.mjs",
);
assert.match(
  rootPackage.scripts["verify:crm-product-complete"],
  /crm:product:live/,
);
assert.equal(
  webPackage.scripts["crm:provider-jobs"],
  "node scripts/process-crm-provider-jobs.mjs",
);
assert.equal(
  webPackage.scripts["crm:product:live"],
  "node scripts/verify-crm-product-live.mjs",
);

const worker = read("apps/web/scripts/process-crm-provider-jobs.mjs");
for (const queue of [
  "crm_telephony_commands",
  "crm_transcription_jobs",
  "crm_provider_sync_jobs",
]) {
  assert.match(worker, new RegExp(queue));
}
assert.match(worker, /Mock telephony is forbidden in production/);
assert.match(worker, /Mock transcription is forbidden in production/);
assert.match(worker, /crm_provider_execution_receipts/);

const aiRoute = read("apps/web/src/app/api/crm/ai-intelligence/route.ts");
const aiProvider = read("apps/web/src/lib/crm-ai-provider.ts");
assert.match(aiRoute, /draft-provider/);
assert.match(aiProvider, /CRM_AI_PROVIDER_URL/);
assert.match(aiProvider, /humanApprovalRequired/);
assert.match(aiProvider, /must use HTTPS|must use HTTPS|must use HTTPS/i);

const migrations = fs
  .readdirSync(path.join(root, "database/tenant/migrations"))
  .filter((name) => /^\d{3}_.+\.sql$/.test(name))
  .sort();
const prefixes = new Map();
for (const migration of migrations) {
  const prefix = migration.slice(0, 3);
  prefixes.set(prefix, [...(prefixes.get(prefix) || []), migration]);
}
const duplicates = [...prefixes.entries()]
  .filter(([, names]) => names.length > 1)
  .map(([prefix, names]) => ({ prefix, names }));
assert.deepEqual(
  duplicates.map((entry) => entry.prefix),
  ["039"],
  `Unexpected duplicate migration prefixes: ${JSON.stringify(duplicates)}`,
);
assert.ok(exists("database/tenant/migrations/042_crm_product_acceptance.sql"));
const migration = read(
  "database/tenant/migrations/042_crm_product_acceptance.sql",
);
assert.match(migration, /crm_product_acceptance_runs/);
assert.match(migration, /crm_provider_execution_receipts/);
assert.match(migration, /FORCE ROW LEVEL SECURITY/);

for (const id of [
  ...profile.mobileRequiredCapabilities,
  ...profile.externalProviderRequiredCapabilities,
  ...profile.optionalModelProviderCapabilities,
]) {
  assert.ok(
    crm.some((row) => row.id === id),
    `Acceptance profile references unknown ${id}.`,
  );
}

const tier = String(process.env.CRM_ACCEPTANCE_TIER || "local").toLowerCase();
assert.ok(
  profile.acceptanceTiers.includes(tier),
  `Unsupported CRM_ACCEPTANCE_TIER ${tier}.`,
);
let productionProviderBlockers = profile.externalProviderRequiredCapabilities;
if (tier === "production") {
  const evidenceFile = process.env.CRM_PROVIDER_ACCEPTANCE_FILE;
  assert.ok(
    evidenceFile,
    "CRM_PROVIDER_ACCEPTANCE_FILE is required for production acceptance.",
  );
  const absolute = path.isAbsolute(evidenceFile)
    ? evidenceFile
    : path.join(root, evidenceFile);
  assert.ok(
    fs.existsSync(absolute),
    `Provider acceptance file not found: ${absolute}`,
  );
  const evidence = JSON.parse(fs.readFileSync(absolute, "utf8"));
  const passed = new Set(
    (evidence.capabilities || [])
      .filter(
        (row) =>
          row.tier === "production" &&
          row.status === "passed" &&
          row.receiptHash,
      )
      .map((row) => row.id),
  );
  productionProviderBlockers =
    profile.externalProviderRequiredCapabilities.filter(
      (id) => !passed.has(id),
    );
  assert.deepEqual(
    productionProviderBlockers,
    [],
    `Production provider acceptance is incomplete: ${productionProviderBlockers.join(", ")}`,
  );
}

console.log(
  `CRM product completion contract verified: ${crm.length} capabilities, ${profile.operationalWorkspaceRoutes.length} canonical workspaces, evidence paths present, provider worker present and acceptance tier ${tier}.`,
);
if (tier !== "production") {
  console.log(
    `Production provider promotion remains blocked for ${productionProviderBlockers.length} capability records until real receipts are supplied.`,
  );
}
