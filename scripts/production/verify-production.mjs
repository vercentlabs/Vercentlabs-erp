#!/usr/bin/env node
// pnpm verify:production — deterministic production-readiness checks (no
// cloud access, no database). CI additionally runs terraform fmt/validate,
// kubeconform and image builds (infrastructure-ci.yml); the real-database
// half is `pnpm test:production:db`.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { validateRuntimeEnvironment } from "../../packages/config/src/production.js";
import { DEFINER_FUNCTIONS, PUBLIC_TABLES, TABLE_CLASSES } from "../../packages/database/src/table-classification.js";
import { API_SCOPES } from "../../services/api/src/core/platform/integrations/api-keys/scopes.js";
import { buildMatrix } from "../qa/generate-route-security-matrix.mjs";
import { checkRendered, render, resolveValues, validateValues } from "../deploy/render-manifests.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const exists = (file) => fs.existsSync(path.join(root, file));
const results = [];

function check(name, run) {
  try {
    const problems = run() || [];
    results.push({ name, problems });
  } catch (error) {
    results.push({ name, problems: [error.message] });
  }
}

function walk(directory, filter, output = []) {
  const absolute = path.join(root, directory);
  if (!fs.existsSync(absolute)) return output;
  for (const entry of fs.readdirSync(absolute, { withFileTypes: true })) {
    if (["node_modules", ".next", ".terraform", ".turbo", "dist"].includes(entry.name)) continue;
    const relative = path.posix.join(directory, entry.name);
    if (entry.isDirectory()) walk(relative, filter, output);
    else if (filter(relative)) output.push(relative);
  }
  return output;
}

const tracked = execFileSync("git", ["ls-files"], { cwd: root, encoding: "utf8" }).split("\n").filter(Boolean);

// ------------------------------------------------------------ Google Cloud

check("production provider is Google Cloud (Terraform google provider, no AWS/Azure)", () => {
  const problems = [];
  const terraform = walk("infrastructure", (file) => file.endsWith(".tf"));
  const text = terraform.map(read).join("\n");
  if (!/source\s*=\s*"hashicorp\/google"/.test(text)) problems.push("Terraform does not use hashicorp/google");
  if (/hashicorp\/(aws|azurerm)|provider\s+"(aws|azurerm)"/.test(text)) problems.push("Terraform references AWS/Azure");
  for (const file of tracked.filter((name) => name.endsWith("package.json"))) {
    if (/"(@aws-sdk\/[^"]+|aws-sdk|@azure\/[^"]+)"\s*:/.test(read(file))) problems.push(`${file} depends on an AWS/Azure SDK`);
  }
  return problems;
});

check("Terraform covers the production platform with safe settings", () => {
  const problems = [];
  const required = ["versions", "providers", "variables", "outputs", "network", "gke", "sql", "storage", "secrets", "kms", "artifact-registry", "iam", "security", "monitoring"];
  for (const name of required) if (!exists(`infrastructure/terraform/${name}.tf`)) problems.push(`missing infrastructure/terraform/${name}.tf`);
  const all = walk("infrastructure/terraform", (file) => file.endsWith(".tf")).map(read).join("\n");
  const expect = [
    [/enable_autopilot\s*=\s*true/, "GKE Autopilot"],
    [/enable_private_nodes\s*=\s*true/, "private GKE nodes"],
    [/database_version\s*=\s*"POSTGRES_16"/, "Cloud SQL PostgreSQL 16"],
    [/availability_type\s*=\s*local\.production \? "REGIONAL"/, "regional HA Cloud SQL in production"],
    [/ipv4_enabled\s*=\s*false/, "no public Cloud SQL IP"],
    [/point_in_time_recovery_enabled\s*=\s*true/, "point-in-time recovery"],
    [/ssl_mode\s*=\s*"ENCRYPTED_ONLY"/, "TLS-only Cloud SQL"],
    [/public_access_prevention\s*=\s*"enforced"/, "bucket public access prevention"],
    [/immutable_tags\s*=\s*true/, "immutable Artifact Registry tags"],
    [/backend "gcs"/, "remote GCS state"],
    [/google_iam_workload_identity_pool_provider/, "GitHub OIDC federation"],
    [/google_compute_security_policy/, "Cloud Armor policy"],
    [/connection_budget/, "connection budget precondition"],
  ];
  for (const [pattern, label] of expect) if (!pattern.test(all)) problems.push(`Terraform lacks ${label}`);
  if (/google_service_account_key/.test(all)) problems.push("Terraform creates a service-account key");
  if (/"roles\/(editor|owner)"/.test(all)) problems.push("Terraform grants Editor/Owner");
  if (/secret_data\s*=/.test(all)) problems.push("Terraform stores a secret value (secret_data) in state");
  if (/google_sql_user/.test(all)) problems.push("Terraform creates a SQL user (password would land in state)");
  const committedState = tracked.filter((file) => /\.tfstate(\.|$)|\.tfplan$|(^|\/)\.terraform\/|\.tfvars$/.test(file));
  if (committedState.length) problems.push(`committed Terraform state/plan/vars: ${committedState.join(", ")}`);
  return problems;
});

// -------------------------------------------------------------- Kubernetes

check("Kubernetes manifests render for every target with the example values", () => {
  const problems = [];
  const values = resolveValues(JSON.parse(read("infrastructure/kubernetes/deploy-values.example.json")), {});
  problems.push(...validateValues(values));
  for (const target of [
    { target: "app", overlay: "staging" },
    { target: "app", overlay: "production" },
    { target: "migration" },
    { target: "operations", values: { OPERATION: "status", OPERATION_FLAGS: "" } },
    { target: "operations", values: { OPERATION: "secrets-migrate-legacy", OPERATION_FLAGS: "--dry-run" } },
  ]) {
    const result = render({ target: target.target, overlay: target.overlay, values: { ...values, ...(target.values || {}) } });
    problems.push(...result.problems.map((problem) => `${target.overlay || target.target}: ${problem}`));
  }
  return problems;
});

check("health/readiness routes exist and the manifests probe them", () => {
  const problems = [];
  for (const file of ["apps/web/src/app/api/health/route.ts", "apps/web/src/app/api/readiness/route.ts", "services/worker/src/health.js"]) if (!exists(file)) problems.push(`missing ${file}`);
  const web = read("infrastructure/kubernetes/base/web.yaml");
  const worker = read("infrastructure/kubernetes/base/worker.yaml");
  if (!/readinessProbe:\s*\n\s*httpGet: \{ path: \/api\/readiness/.test(web)) problems.push("web readinessProbe is not /api/readiness");
  if (!/livenessProbe:\s*\n\s*httpGet: \{ path: \/api\/health/.test(web)) problems.push("web livenessProbe is not /api/health");
  if (!/path: \/readyz/.test(worker) || !/path: \/livez/.test(worker)) problems.push("worker probes are not /livez and /readyz");
  if (!/\/readyz/.test(read("services/worker/src/health.js"))) problems.push("worker health server has no /readyz");
  return problems;
});

check("manifests hold no secret values, no Kubernetes Secrets, only digest-pinned images", () => {
  const problems = [];
  const files = walk("infrastructure/kubernetes", (file) => /\.(ya?ml|json)$/.test(file));
  for (const file of files) {
    const text = read(file);
    if (/^kind:\s*Secret\s*$/m.test(text)) problems.push(`${file} defines a Kubernetes Secret`);
    if (/-----BEGIN [A-Z ]*PRIVATE KEY-----|"private_key"\s*:|AKIA[0-9A-Z]{16}|rzp_live_[A-Za-z0-9]{8,}/.test(text)) problems.push(`${file} contains key material`);
    if (/postgres(ql)?:\/\/[^$\s"]+:[^@$\s"]+@/.test(text)) problems.push(`${file} contains a database connection string`);
    for (const match of text.matchAll(/^\s*image:\s*"?([^"\s]+)"?\s*$/gm)) {
      const image = match[1];
      if (!image.startsWith("${") && !/@sha256:[0-9a-f]{64}$/.test(image)) problems.push(`${file}: image ${image} is not pinned by digest`);
    }
  }
  const configMap = read("infrastructure/kubernetes/base/configmap.yaml");
  for (const match of configMap.matchAll(/^\s{2}([A-Z0-9_]+):/gm)) {
    if (/(PASSWORD|SECRET|TOKEN|ENCRYPTION_KEY|MASTER_KEY)$/.test(match[1])) problems.push(`ConfigMap key ${match[1]} is secret material (use ${match[1]}_FILE)`);
    if (/^CRM_OUTBOX_/.test(match[1])) problems.push(`ConfigMap holds retired ${match[1]}`);
  }
  for (const file of walk("infrastructure/docker", (name) => /Dockerfile\./.test(name))) {
    const text = read(file);
    for (const match of text.matchAll(/^ARG NODE_IMAGE=(\S+)/gm)) if (!/@sha256:[0-9a-f]{64}$/.test(match[1])) problems.push(`${file}: base image not pinned by digest`);
    if (/^FROM (?!\$\{NODE_IMAGE\})/m.test(text)) problems.push(`${file}: FROM does not use the pinned NODE_IMAGE`);
    if (!/^USER 10001/m.test(text)) problems.push(`${file}: runtime user is not the fixed non-root UID`);
    if (/MIGRATION_DATABASE_URL=|DATABASE_URL=/.test(text)) problems.push(`${file}: bakes a database URL`);
  }
  const dockerignore = read(".dockerignore");
  if (!/^\*\*\/\.env$/m.test(dockerignore) || !/^\*\*\/\.env\.\*$/m.test(dockerignore)) problems.push(".dockerignore does not exclude .env files at every depth");
  return problems;
});

// ------------------------------------------------------ runtime configuration

check("startup configuration validator enforces the production contract", () => {
  const problems = [];
  const valid = {
    NODE_ENV: "production",
    APP_URL: "https://erp.example.com",
    FORM_ALLOWED_ORIGINS: "https://erp.example.com",
    DATABASE_URL: "postgresql://web:password@127.0.0.1:5432/erp",
    ENFORCE_RESTRICTED_DB_ROLE: "true",
    BILLING_ENFORCEMENT_MODE: "enforce",
    FILE_STORAGE_DRIVER: "gcs",
    FILE_STORAGE_GCS_BUCKET: "example-files",
    ATTACHMENT_SCAN_MODE: "required",
    ATTACHMENT_SCAN_URL: "https://scanner.example.com/scan",
    ATTACHMENT_SCAN_TOKEN: "token",
    SECRETS_ENCRYPTION_PROVIDER: "gcp-kms",
    SECRETS_KMS_KEY_NAME: "projects/example-project/locations/asia-south1/keyRings/erp/cryptoKeys/secrets",
    SMTP_HOST: "smtp.example.com",
    SMTP_USER: "mailer",
    SMTP_PASSWORD: "password",
    AUTH_EMAIL_FROM: "noreply@example.com",
    TRUSTED_PROXY_IP_HEADER: "x-forwarded-for",
  };
  try {
    validateRuntimeEnvironment("web", { ...valid });
  } catch (error) {
    problems.push(`a complete production web configuration is refused: ${(error.issues || [error.message]).join("; ")}`);
  }
  const mustRefuse = {
    "local file storage": { FILE_STORAGE_DRIVER: "local" },
    "memory file storage": { FILE_STORAGE_DRIVER: "memory" },
    "local secrets provider": { SECRETS_ENCRYPTION_PROVIDER: "local" },
    "observe-only billing": { BILLING_ENFORCEMENT_MODE: "observe" },
    "migration authority in the web": { MIGRATION_DATABASE_URL: "postgresql://owner:password@127.0.0.1:5432/erp" },
    "disabled restricted-role enforcement": { ENFORCE_RESTRICTED_DB_ROLE: "false" },
    "test OAuth stand-in": { OAUTH_STANDIN_URL: "http://127.0.0.1:3197" },
    "test mail capture": { AUTH_EMAIL_CAPTURE_ENABLED: "true" },
    "Razorpay stand-in": { RAZORPAY_API_BASE: "http://127.0.0.1:1" },
    "missing trusted proxy header": { TRUSTED_PROXY_IP_HEADER: "" },
  };
  for (const [label, override] of Object.entries(mustRefuse)) {
    try {
      validateRuntimeEnvironment("web", { ...valid, ...override });
      problems.push(`production configuration accepts ${label}`);
    } catch {
      // refused as required
    }
  }
  try {
    validateRuntimeEnvironment("worker", { ...valid, DATABASE_URL: "", WORKER_DATABASE_URL: "" });
    problems.push("production worker starts without WORKER_DATABASE_URL");
  } catch {
    // refused as required
  }
  return problems;
});

// ---------------------------------------------------------------- database

check("every public table is classified; organisation tables are RLS protected", () => {
  const problems = [];
  const migrations = walk("database/platform/migrations", (file) => file.endsWith(".sql")).map(read).join("\n");
  const contracts = walk("database/platform/contracts", (file) => file.endsWith(".sql")).map(read).join("\n");
  const created = new Set([...migrations.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?"?([a-z_][a-z0-9_]*)"?\s*\(/gi)].map((match) => match[1].toLowerCase()));
  const dropped = new Set([...contracts.matchAll(/DROP TABLE (?:IF EXISTS )?(?:public\.)?([a-z_][a-z0-9_]*)/gi)].map((match) => match[1].toLowerCase()));
  for (const table of created) if (!PUBLIC_TABLES[table] && !dropped.has(table)) problems.push(`public.${table} is not classified in packages/database/src/table-classification.js`);
  for (const [table, entry] of Object.entries(PUBLIC_TABLES)) {
    if (entry.class !== TABLE_CLASSES.ORGANIZATION_SCOPED && entry.class !== TABLE_CLASSES.ORGANIZATION_CHILD) continue;
    const pattern = new RegExp(`ALTER TABLE (?:public\\.)?${table} (?:ENABLE|FORCE) ROW LEVEL SECURITY|ALTER TABLE (?:public\\.)?${table}\\s+ENABLE ROW LEVEL SECURITY|'${table}'`, "i");
    if (!pattern.test(migrations)) problems.push(`public.${table} (${entry.class}) has no row-level security in the platform migrations`);
  }
  // Replay function definitions in migration order: the latest CREATE decides
  // whether a function is SECURITY DEFINER; a later DROP removes it.
  const ordered = ["database/platform/migrations", "database/tenant/migrations", "database/platform/contracts", "database/tenant/contracts"].flatMap((directory) => walk(directory, (file) => file.endsWith(".sql")).sort());
  const definers = new Map();
  for (const file of ordered) {
    const text = read(file);
    const tokens = [...text.matchAll(/(CREATE (?:OR REPLACE )?FUNCTION|DROP FUNCTION (?:IF EXISTS )?)\s*((?:public|tenant)\.[a-z_0-9]+)/gi)];
    tokens.forEach((token, index) => {
      const name = token[2].toLowerCase();
      if (/^DROP/i.test(token[1])) return definers.delete(name);
      const body = text.slice(token.index, tokens[index + 1]?.index ?? text.length);
      if (/SECURITY DEFINER/i.test(body)) definers.set(name, file);
      else definers.delete(name);
    });
  }
  for (const [name, file] of definers) {
    const entry = DEFINER_FUNCTIONS[name];
    if (!entry) problems.push(`SECURITY DEFINER function ${name} (${file}) is not registered in DEFINER_FUNCTIONS`);
  }
  return problems;
});

check("no runtime writes to retired storage (legacy blobs, numbering_series, CRM outbox)", () => {
  const problems = [];
  const runtime = [...walk("services", (file) => /\.(m?js|ts)$/.test(file) && !/\/tests?\//.test(file)), ...walk("apps/web/src", (file) => /\.(ts|tsx)$/.test(file) && !/\.test\./.test(file))];
  for (const file of runtime) {
    const text = read(file);
    if (/INSERT INTO\s+(public\.)?attachments\s*\([^)]*\bcontent\b/i.test(text)) problems.push(`${file} writes attachment bytes to PostgreSQL`);
    if (/\b(INSERT INTO|UPDATE)\s+(public\.)?numbering_series\b/i.test(text)) problems.push(`${file} writes the retired numbering_series table`);
    if (/\b(INSERT INTO|UPDATE)\s+tenant\.crm_(outbox|webhook)/i.test(text)) problems.push(`${file} writes a retired CRM outbox/webhook table`);
  }
  return problems;
});

check("no dependency on recovered platform code", () => {
  const problems = [];
  if (exists("docs/frontend-rebuild/recovered-platform-code")) problems.push("docs/frontend-rebuild/recovered-platform-code still exists");
  for (const file of [...walk("apps", (name) => /\.(m?js|tsx?)$/.test(name)), ...walk("services", (name) => /\.(m?js|tsx?)$/.test(name)), ...walk("packages", (name) => /\.(m?js|tsx?)$/.test(name))]) {
    if (/recovered-platform-code/.test(read(file)) && !/\/(tests?)\//.test(file)) problems.push(`${file} references recovered-platform-code`);
  }
  return problems;
});

// ------------------------------------------------------------- application

check("API keys: registered, specific scopes only (no wildcards)", () => {
  const problems = [];
  if (!API_SCOPES.length) problems.push("no API scopes registered");
  for (const scope of API_SCOPES) {
    if (/[*]|^all$|:all$|\.all$/.test(scope.key)) problems.push(`wildcard scope ${scope.key}`);
    if (!scope.consumedBy?.length) problems.push(`scope ${scope.key} has no consuming endpoint`);
  }
  return problems;
});

check("every route handler is classified; no stale route exceptions", () => {
  const rows = buildMatrix();
  return rows.filter((row) => row.class === "UNKNOWN").map((row) => `${row.route} ${row.method} is unclassified`);
});

check("production CSP and security headers", () => {
  const problems = [];
  const config = read("apps/web/next.config.ts");
  const csp = config.match(/const contentSecurityPolicy = \[([\s\S]*?)\]\.join/)?.[1] ?? "";
  if (!csp) return ["apps/web/next.config.ts has no contentSecurityPolicy"];
  if (!/unsafe-eval'" \+ \(isProduction \? "" :|isProduction \? "" : " 'unsafe-eval'"/.test(csp) && /unsafe-eval/.test(csp)) problems.push("CSP allows unsafe-eval in production");
  for (const directive of ["default-src 'self'", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'self'", "form-action 'self'"]) if (!csp.includes(directive)) problems.push(`CSP lacks ${directive}`);
  for (const header of ["Strict-Transport-Security", "X-Content-Type-Options", "X-Frame-Options", "Referrer-Policy", "Permissions-Policy"]) if (!config.includes(header)) problems.push(`missing ${header}`);
  if (!/poweredByHeader:\s*false/.test(config)) problems.push("X-Powered-By is not disabled");
  if (!exists("apps/web/src/proxy.ts") || !/x-request-id/.test(read("apps/web/src/proxy.ts"))) problems.push("request-id proxy missing");
  return problems;
});

// ---------------------------------------------------------------- workflows

check("release and deployment workflow structure", () => {
  const problems = [];
  const deploy = read(".github/workflows/deploy.yml");
  const environment = read(".github/workflows/deploy-environment.yml");
  const infrastructure = read(".github/workflows/infrastructure-ci.yml");
  const plan = read(".github/workflows/terraform-plan.yml");
  if (/^\s*(pull_request|pull_request_target|push):/m.test(deploy)) problems.push("deploy.yml is triggered by pushes or pull requests");
  if (!/github\.ref != 'refs\/heads\/main'/.test(deploy) || !/github\.ref != 'refs\/heads\/main'/.test(environment)) problems.push("deploy workflows do not refuse non-main refs");
  if (!/uses: \.\/\.github\/workflows\/erp-ci\.yml/.test(deploy)) problems.push("deploy does not run ERP CI first");
  if (!/environment: \$\{\{ inputs\.environment \}\}/.test(environment)) problems.push("deploy job is not bound to a GitHub environment");
  if (!/google-github-actions\/auth@/.test(environment) || /credentials_json/.test(environment)) problems.push("deploy does not use Workload Identity Federation");
  const migrate = environment.indexOf("Expand migrations");
  const rollout = environment.indexOf("Roll out web");
  if (migrate < 0 || rollout < 0 || migrate > rollout) problems.push("the migration Job does not run before the rollout");
  if (/db:migrate:contract|--contract/.test(`${deploy}\n${environment}`)) problems.push("deploy runs contract migrations");
  for (const step of ["Record rollback target", "Smoke test", "Release manifest"]) if (!environment.includes(step)) problems.push(`deploy lacks step "${step}"`);
  if (/id-token:\s*write/.test(infrastructure)) problems.push("infrastructure CI (PRs) requests cloud credentials");
  if (/terraform\s+apply/.test(plan)) problems.push("terraform plan workflow applies");
  if (!exists("scripts/deploy/release-manifest.mjs") || !exists("scripts/deploy/smoke.mjs")) problems.push("release manifest / smoke scripts missing");
  return problems;
});

check("operations runbooks exist", () =>
  ["docs/operations/PRODUCTION_RUNBOOK.md", "docs/operations/DISASTER_RECOVERY_RUNBOOK.md", "docs/operations/RELEASE_RUNBOOK.md"].filter((file) => !exists(file)).map((file) => `missing ${file}`),
);

let failed = 0;
for (const { name, problems } of results) {
  if (problems.length) {
    failed += 1;
    console.log(`FAIL  ${name}`);
    for (const problem of problems) console.log(`      - ${problem}`);
  } else {
    console.log(`OK    ${name}`);
  }
}
console.log(`\n${results.length - failed}/${results.length} production readiness checks passed.`);
process.exit(failed ? 1 : 0);
