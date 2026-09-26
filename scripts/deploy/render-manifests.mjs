#!/usr/bin/env node
// Renders the Kubernetes manifests for one environment:
//
//   node scripts/deploy/render-manifests.mjs --overlay production \
//     --values deploy-values.json --out rendered.yaml [--target app|migration|operations]
//
//   --target operations also needs OPERATION (and optionally
//   OPERATION_FLAGS=--dry-run) in the environment.
//
// 1. `kubectl kustomize` the overlay (app), the migration Job or an
//    operations Job.
// 2. Substitute ${NAME} placeholders from the values file (+ environment
//    variables of the same name, which win: the workflow passes image digests
//    and the release SHA that way). Every value must match its declared
//    pattern; a placeholder that is a whole YAML scalar is emitted as a
//    quoted string, so "10" stays a string in a ConfigMap.
// 3. Refuse the output if any placeholder is left, any image is not pinned by
//    digest, a Secret object or secret-looking ConfigMap value appears, or a
//    production value points at a test stand-in.
//
// Deterministic and offline (kubectl kustomize only); CI renders
// infrastructure/kubernetes/deploy-values.example.json on every PR.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

const HOST = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
const IMAGE = /^[a-z0-9.-]+(:[0-9]+)?\/[a-z0-9._/-]+(:[A-Za-z0-9._-]+)?@sha256:[0-9a-f]{64}$/;
const GSA = /^[a-z][a-z0-9-]{4,28}[a-z0-9]@[a-z][a-z0-9-]{4,28}[a-z0-9]\.iam\.gserviceaccount\.com$/;
const NAME = /^[a-z]([-a-z0-9]{0,61}[a-z0-9])?$/;
const INT = /^[0-9]{1,4}$/;
const BOOL = /^(true|false)$/;
const HTTPS_URL = /^https:\/\/[A-Za-z0-9.-]+(:[0-9]+)?(\/[A-Za-z0-9._~\/-]*)?$/;
const OPTIONAL = (pattern) => new RegExp(`^$|${pattern.source}`);

// Every placeholder the manifests may use, with its format.
export const PLACEHOLDERS = Object.freeze({
  ENVIRONMENT: /^(staging|production)$/,
  GCP_PROJECT_ID: /^[a-z][a-z0-9-]{4,28}[a-z0-9]$/,
  SECRET_PREFIX: NAME,
  SQL_CONNECTION_NAME: /^[a-z][a-z0-9-]{4,28}[a-z0-9]:[a-z0-9-]+:[a-z][a-z0-9-]{0,97}$/,
  PRIVATE_SERVICES_CIDR: /^(10|172|192)\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\/[0-9]{1,2}$/,
  FILES_BUCKET: /^[a-z0-9][a-z0-9._-]{1,61}[a-z0-9]$/,
  SECRETS_KMS_KEY_NAME: /^projects\/[a-z][a-z0-9-]{4,28}[a-z0-9]\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]{1,63}\/cryptoKeys\/[A-Za-z0-9_-]{1,63}$/,
  WEB_GSA: GSA,
  WORKER_GSA: GSA,
  MIGRATION_GSA: GSA,
  LANDING_GSA: GSA,
  INGRESS_IP_NAME: NAME,
  EDGE_POLICY: NAME,
  SSL_POLICY: NAME,
  APP_HOST: HOST,
  LANDING_HOST: HOST,
  APP_URL: HTTPS_URL,
  FORM_ALLOWED_ORIGINS: /^https:\/\/[A-Za-z0-9.-]+(,https:\/\/[A-Za-z0-9.-]+)*$/,
  WEB_POOL_MAX: INT,
  WORKER_POOL_MAX: INT,
  WORKER_CONCURRENCY: INT,
  BILLING_CHECKOUT_ENABLED: BOOL,
  RAZORPAY_MODE: /^(live|test)$/,
  RAZORPAY_KEY_ID: OPTIONAL(/^rzp_(live|test)_[A-Za-z0-9]{6,40}$/),
  ATTACHMENT_SCAN_URL: HTTPS_URL,
  SMTP_HOST: HOST,
  SMTP_PORT: /^(465|587)$/,
  SMTP_SECURE: BOOL,
  SMTP_USER: /^[A-Za-z0-9._%+@-]{1,254}$/,
  AUTH_EMAIL_FROM: /^[^\s<>"'`$\\]{3,254}$/,
  AUTH_EMAIL_REPLY_TO: /^[^\s<>"'`$\\]{3,254}$/,
  GOOGLE_OAUTH_CLIENT_ID: /^[A-Za-z0-9._-]{10,200}$/,
  MICROSOFT_OAUTH_CLIENT_ID: /^[A-Za-z0-9-]{10,100}$/,
  CRM_CAPTURE_FORM_KEY: /^[0-9a-f]{24,64}$/i,
  WEB_IMAGE: IMAGE,
  WORKER_IMAGE: IMAGE,
  LANDING_IMAGE: IMAGE,
  MIGRATION_IMAGE: IMAGE,
  RELEASE_SHA: /^[0-9a-f]{7,40}$/,
  RELEASE_ID: /^[a-z0-9]([-a-z0-9]{0,40}[a-z0-9])?$/,
  OPERATION: /^(status|files-migrate-legacy|files-reconcile|secrets-reencrypt|secrets-migrate-legacy|restore-verify|contract-plan|contract-apply)$/,
  OPERATION_FLAGS: /^(|--dry-run)$/,
});

function parseArgs(argv) {
  const args = { target: "app" };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument ${key}`);
    args[key.slice(2)] = argv[index + 1];
    index += 1;
  }
  if (!["app", "migration", "operations"].includes(args.target)) throw new Error("--target must be app, migration or operations");
  if (args.target === "app" && !["staging", "production"].includes(args.overlay)) throw new Error("--overlay must be staging or production");
  if (!args.values) throw new Error("--values <file> is required");
  return args;
}

export function resolveValues(fileValues, environment = process.env) {
  const values = {};
  for (const name of Object.keys(PLACEHOLDERS)) {
    const fromEnvironment = environment[name];
    const value = fromEnvironment !== undefined && fromEnvironment !== "" ? fromEnvironment : fileValues[name];
    if (value !== undefined) values[name] = String(value);
  }
  if (values.OPERATION && values.OPERATION_FLAGS === undefined) values.OPERATION_FLAGS = "";
  if (values.RELEASE_SHA && !values.RELEASE_ID) values.RELEASE_ID = values.RELEASE_SHA.slice(0, 12);
  return values;
}

export function validateValues(values) {
  const problems = [];
  for (const [name, value] of Object.entries(values)) {
    if (!PLACEHOLDERS[name].test(value)) problems.push(`${name} has an invalid value (${JSON.stringify(value.length > 80 ? `${value.slice(0, 80)}...` : value)}).`);
  }
  const pool = Number(values.WORKER_POOL_MAX);
  const concurrency = Number(values.WORKER_CONCURRENCY);
  if (Number.isFinite(pool) && Number.isFinite(concurrency) && pool < concurrency + 3) problems.push("WORKER_POOL_MAX must be at least WORKER_CONCURRENCY + 3.");
  if (values.APP_URL && values.APP_HOST && new URL(values.APP_URL).host !== values.APP_HOST) problems.push("APP_URL must be https://APP_HOST.");
  if (values.ENVIRONMENT === "production") {
    if (values.BILLING_CHECKOUT_ENABLED === "true" && values.RAZORPAY_MODE !== "live") problems.push("Production checkout requires RAZORPAY_MODE=live.");
    if (values.RAZORPAY_MODE === "live" && values.RAZORPAY_KEY_ID && !values.RAZORPAY_KEY_ID.startsWith("rzp_live_")) problems.push("RAZORPAY_MODE=live requires a rzp_live_ key id.");
    if (/example|stand-?in|localhost/i.test(`${values.APP_HOST} ${values.ATTACHMENT_SCAN_URL} ${values.SMTP_HOST}`)) problems.push("Production values point at an example or stand-in host.");
  }
  return problems;
}

// Whole-scalar placeholders become JSON (YAML double-quoted) strings; embedded
// ones are substituted raw (values are pattern-checked above).
export function substitute(text, values) {
  const missing = new Set();
  const lookup = (name) => {
    if (!(name in values)) {
      missing.add(name);
      return `\${${name}}`;
    }
    return values[name];
  };
  let output = text.replace(/^(\s*(?:-\s+|[A-Za-z0-9_.\/-]+:\s+))\$\{([A-Z0-9_]+)\}\s*$/gm, (whole, prefix, name) => {
    const value = lookup(name);
    return value.startsWith("${") ? whole : `${prefix}${JSON.stringify(value)}`;
  });
  output = output.replace(/\$\{([A-Z0-9_]+)\}/g, (whole, name) => lookup(name));
  return { output, missing: [...missing] };
}

export function checkRendered(output) {
  const problems = [];
  const leftover = output.match(/\$\{[A-Z0-9_]+\}/g);
  if (leftover) problems.push(`Unrendered placeholders: ${[...new Set(leftover)].join(", ")}`);
  for (const match of output.matchAll(/^\s*image:\s*"?([^"\s]+)"?\s*$/gm)) {
    if (!/@sha256:[0-9a-f]{64}$/.test(match[1])) problems.push(`Image not pinned by digest: ${match[1]}`);
    if (/:latest(@|$)/.test(match[1])) problems.push(`Mutable :latest tag: ${match[1]}`);
  }
  if (/^kind:\s*Secret\s*$/m.test(output)) problems.push("Rendered manifests contain a Kubernetes Secret: secrets come from Secret Manager files only.");
  for (const document of output.split(/^---\s*$/m)) {
    if (!/^kind:\s*ConfigMap\s*$/m.test(document)) continue;
    for (const match of document.matchAll(/^\s{2}([A-Z0-9_]+):\s*(.*)$/gm)) {
      const [, key, value] = match;
      if (/(PASSWORD|SECRET|TOKEN|PRIVATE_KEY|MASTER_KEY|ENCRYPTION_KEY)$/.test(key) && value.trim() !== "") problems.push(`ConfigMap holds secret material in ${key}; mount it from Secret Manager and pass ${key}_FILE.`);
      if (/^(DATABASE_URL|WORKER_DATABASE_URL|MIGRATION_DATABASE_URL)$/.test(key)) problems.push(`ConfigMap holds a connection string in ${key}.`);
      if (/^(AUTH_EMAIL_CAPTURE_ENABLED|OAUTH_STANDIN_URL|RAZORPAY_API_BASE)$/.test(key)) problems.push(`ConfigMap sets the test-only ${key}.`);
    }
  }
  return problems;
}

export function render({ target, overlay, values }) {
  const directory =
    target === "migration"
      ? "infrastructure/kubernetes/jobs/migration"
      : target === "operations"
        ? `infrastructure/kubernetes/jobs/${values.OPERATION === "secrets-migrate-legacy" ? "operations-legacy" : "operations"}`
        : `infrastructure/kubernetes/overlays/${overlay}`;
  const kustomized = execFileSync("kubectl", ["kustomize", path.join(root, directory)], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  const { output, missing } = substitute(kustomized, values);
  const problems = [...missing.map((name) => `No value for placeholder ${name}.`), ...checkRendered(output)];
  return { output, problems };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const fileValues = JSON.parse(fs.readFileSync(path.resolve(args.values), "utf8"));
    const values = resolveValues(fileValues);
    const valueProblems = validateValues(values);
    const { output, problems } = render({ target: args.target, overlay: args.overlay, values });
    const all = [...valueProblems, ...problems];
    if (all.length) {
      console.error(`Refusing to render:\n${all.map((problem) => `  - ${problem}`).join("\n")}`);
      process.exit(1);
    }
    if (args.out) fs.writeFileSync(path.resolve(args.out), output);
    else process.stdout.write(output);
    console.error(`Rendered ${args.target === "app" ? `overlay ${args.overlay}` : `${args.target} Job`}: ${(output.match(/^kind:/gm) || []).length} objects, all images pinned by digest.`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
