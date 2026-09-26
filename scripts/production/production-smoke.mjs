#!/usr/bin/env node
// Production-configuration smoke test (pnpm test:production:smoke): the real
// production images in NODE_ENV=production against local stand-ins only —
// no Google, Razorpay or mail credentials.
//
//   1. A throwaway database is created and migrated by the MIGRATION IMAGE
//      (expand migrations + restricted web/worker role provisioning), from
//      Secret-Manager-style files (NAME_FILE).
//   2. fake-gcs-server stands in for Cloud Storage over TLS (a throwaway
//      certificate the containers trust through NODE_EXTRA_CA_CERTS); the web
//      and worker use the production GCS adapter against it
//      (FILE_STORAGE_GCS_API_ENDPOINT, HTTPS as production requires).
//   3. The WEB IMAGE runs with the strict restricted role, enforced billing,
//      gcp-kms envelope configuration, trusted-proxy settings; the WORKER
//      IMAGE with its own worker role.
//   4. Checks: /api/health, /api/readiness (role, migrations, storage probe
//      object written to the bucket), security headers and CSP, request-id
//      propagation, anonymous API access refused, worker /livez + /readyz.
//   5. Negative: the web refuses to start with MIGRATION_DATABASE_URL present,
//      and readiness fails when the web is given the owner role.
//   6. Everything is removed afterwards (containers, network, database).
//
// Images: PRODUCTION_SMOKE_WEB_IMAGE / _WORKER_IMAGE / _MIGRATION_IMAGE
// (default vercent-erp-{web,worker,migration}:test). Database: the
// MIGRATION_DATABASE_URL / DATABASE_URL / WORKER_DATABASE_URL roles (the
// owner needs CREATEDB).
import { execFileSync, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import pg from "pg";

import { loadSuiteEnvironment } from "../lib/run-db-suite.mjs";

loadSuiteEnvironment();

const images = {
  web: process.env.PRODUCTION_SMOKE_WEB_IMAGE || "vercent-erp-web:test",
  worker: process.env.PRODUCTION_SMOKE_WORKER_IMAGE || "vercent-erp-worker:test",
  migration: process.env.PRODUCTION_SMOKE_MIGRATION_IMAGE || "vercent-erp-migration:test",
};
// Cloud Storage stand-in (TLS, preloaded bucket).
const FAKE_GCS = "fsouza/fake-gcs-server:1.52.2@sha256:d47b4cf8b87006cab8fbbecfa5f06a2a3c5722e464abddc0d107729663d40ec4";
const suffix = randomBytes(4).toString("hex");
const network = `vercent-smoke-${suffix}`;
const database = `vercent_smoke_${suffix}`;
const bucket = `vercent-smoke-${suffix}`;
const ports = { web: 13401, worker: 13481, negativeWeb: 13402 };
const containers = [];
const checks = [];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function docker(args, { allowFailure = false, timeoutMilliseconds = 600_000 } = {}) {
  const result = spawnSync("docker", args, { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, timeout: timeoutMilliseconds });
  if (result.status !== 0 && !allowFailure) throw new Error(`docker ${args.slice(0, 3).join(" ")} failed: ${(result.stderr || result.stdout).trim().slice(0, 800)}`);
  return result;
}

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

// Container view of a local database URL: same roles, the smoke database, the
// Docker host gateway.
function containerUrl(raw) {
  const url = new URL(raw);
  if (["localhost", "127.0.0.1", "::1"].includes(url.hostname)) url.hostname = "host.docker.internal";
  url.pathname = `/${database}`;
  return url.toString();
}

async function check(name, run) {
  try {
    const detail = await run();
    checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
  } catch (error) {
    checks.push({ name, ok: false, error: error.message });
  }
}

async function until(run, { timeoutMilliseconds = 90_000, intervalMilliseconds = 2_000 } = {}) {
  const deadline = Date.now() + timeoutMilliseconds;
  let last;
  while (Date.now() < deadline) {
    try {
      return await run();
    } catch (error) {
      last = error;
      await sleep(intervalMilliseconds);
    }
  }
  throw last ?? new Error("timed out");
}

const request = (url, init = {}) => fetch(url, { redirect: "manual", signal: AbortSignal.timeout(10_000), ...init });

function envArgs(values) {
  return Object.entries(values).flatMap(([key, value]) => ["-e", `${key}=${value}`]);
}

function productionEnvironment(extra = {}) {
  return {
    NODE_ENV: "production",
    DEPLOYMENT_ENVIRONMENT: "production-smoke",
    APP_URL: "https://erp.smoke.test",
    FORM_ALLOWED_ORIGINS: "https://erp.smoke.test",
    ENFORCE_RESTRICTED_DB_ROLE: "true",
    DATABASE_SSL: "false",
    BILLING_ENFORCEMENT_MODE: "enforce",
    BILLING_CHECKOUT_ENABLED: "false",
    RAZORPAY_MODE: "test",
    FILE_STORAGE_DRIVER: "gcs",
    FILE_STORAGE_GCS_BUCKET: bucket,
    FILE_STORAGE_GCS_API_ENDPOINT: "https://fake-gcs:4443",
    NODE_EXTRA_CA_CERTS: "/run/certs/cert.pem",
    GOOGLE_CLOUD_PROJECT: "smoke-project",
    ATTACHMENT_SCAN_MODE: "local",
    SECRETS_ENCRYPTION_PROVIDER: "gcp-kms",
    SECRETS_KMS_KEY_NAME: "projects/smoke-project/locations/asia-south1/keyRings/smoke/cryptoKeys/integration-secrets",
    SMTP_HOST: "smtp.smoke.test",
    SMTP_PORT: "587",
    SMTP_USER: "smoke",
    SMTP_PASSWORD_FILE: "/run/secrets/vercentlabs/SMTP_PASSWORD",
    AUTH_EMAIL_FROM: "noreply@smoke.test",
    TRUSTED_PROXY_IP_HEADER: "x-forwarded-for",
    TRUSTED_PROXY_CLIENT_INDEX: "-2",
    ...extra,
  };
}

const secretsDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vercent-smoke-"));
const hostGateway = process.platform === "linux" ? ["--add-host", "host.docker.internal:host-gateway"] : [];
const secretMount = ["-v", `${secretsDirectory}:/run/secrets/vercentlabs:ro`];
const certificateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vercent-smoke-tls-"));
const dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "vercent-smoke-gcs-"));
const certificateMount = ["-v", `${certificateDirectory}:/run/certs:ro`];
let admin;

try {
  const migrationUrl = required("MIGRATION_DATABASE_URL");
  const webUrl = required("DATABASE_URL");
  const workerUrl = required("WORKER_DATABASE_URL");
  for (const image of Object.values(images)) docker(["image", "inspect", image]);

  admin = new pg.Client({ connectionString: migrationUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${database}`);

  const secretFiles = {
    MIGRATION_DATABASE_URL: containerUrl(migrationUrl),
    DATABASE_URL: containerUrl(webUrl),
    WORKER_DATABASE_URL: containerUrl(workerUrl),
    SMTP_PASSWORD: "smoke-not-a-real-password",
  };
  for (const [name, value] of Object.entries(secretFiles)) fs.writeFileSync(path.join(secretsDirectory, name), value, { mode: 0o644 });

  await check("migration image: expand migrations + restricted role provisioning (NAME_FILE secrets)", async () => {
    const result = docker(
      ["run", "--rm", ...hostGateway, ...secretMount, ...envArgs({ MIGRATION_DATABASE_URL_FILE: "/run/secrets/vercentlabs/MIGRATION_DATABASE_URL", DATABASE_URL_FILE: "/run/secrets/vercentlabs/DATABASE_URL", WORKER_DATABASE_URL_FILE: "/run/secrets/vercentlabs/WORKER_DATABASE_URL" }), images.migration],
      { allowFailure: true },
    );
    if (result.status !== 0) throw new Error((result.stderr || result.stdout).trim().split("\n").slice(-5).join(" | "));
    return (result.stdout.match(/Restricted (web|worker) role ready/g) || []).join(", ");
  });

  // Throwaway TLS identity for the storage stand-in (valid one day).
  execFileSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "1", "-subj", "/CN=fake-gcs", "-addext", "subjectAltName=DNS:fake-gcs", "-keyout", path.join(certificateDirectory, "key.pem"), "-out", path.join(certificateDirectory, "cert.pem")], { stdio: "ignore" });
  for (const file of ["key.pem", "cert.pem"]) fs.chmodSync(path.join(certificateDirectory, file), 0o644);
  fs.mkdirSync(path.join(dataDirectory, bucket));
  docker(["network", "create", network]);
  containers.push(docker(["run", "-d", "--name", `fake-gcs-${suffix}`, "--network", network, "--network-alias", "fake-gcs", ...certificateMount, "-v", `${dataDirectory}:/data:ro`, FAKE_GCS, "-scheme", "https", "-port", "4443", "-public-host", "fake-gcs:4443", "-backend", "memory", "-data", "/data", "-cert-location", "/run/certs/cert.pem", "-private-key-location", "/run/certs/key.pem"]).stdout.trim());

  const common = ["--network", network, ...hostGateway, ...secretMount, ...certificateMount, "--read-only", "--tmpfs", "/tmp", "--cap-drop", "ALL", "--security-opt", "no-new-privileges"];
  containers.push(docker(["run", "-d", "--name", `web-${suffix}`, ...common, "--tmpfs", "/app/apps/web/.next/cache", "-p", `127.0.0.1:${ports.web}:3001`, ...envArgs(productionEnvironment({ DATABASE_URL_FILE: "/run/secrets/vercentlabs/DATABASE_URL", DATABASE_POOL_MAX: "5" })), images.web]).stdout.trim());
  containers.push(docker(["run", "-d", "--name", `worker-${suffix}`, ...common, "-p", `127.0.0.1:${ports.worker}:8081`, ...envArgs(productionEnvironment({ WORKER_DATABASE_URL_FILE: "/run/secrets/vercentlabs/WORKER_DATABASE_URL", DATABASE_POOL_MAX: "6", WORKER_CONCURRENCY: "2", WORKER_POLL_INTERVAL_MS: "1000" })), images.worker]).stdout.trim());
  const web = `http://127.0.0.1:${ports.web}`;

  await check("web /api/health", () =>
    until(async () => {
      const response = await request(`${web}/api/health`);
      if (response.status !== 200) throw new Error(`health -> ${response.status}`);
    }),
  );

  await check("web /api/readiness: restricted role, migrations current, Cloud Storage adapter", () =>
    until(async () => {
      const response = await request(`${web}/api/readiness`);
      const body = await response.json().catch(() => ({}));
      if (response.status !== 200) throw new Error(`readiness -> ${response.status} ${JSON.stringify(body.checks || body)}`);
      return body.checks;
    }, { timeoutMilliseconds: 60_000 }),
  );

  await check("production GCS adapter writes, reads and deletes an object (inside the worker image)", async () => {
    const script = [
      "const { resolveObjectStorage } = await import('/app/services/api/src/core/platform/files/storage.js');",
      "const store = await resolveObjectStorage(process.env);",
      "const bytes = Buffer.from('production-smoke');",
      "await store.put('smoke/object.txt', bytes, { contentType: 'text/plain' });",
      "const back = await store.get('smoke/object.txt');",
      "if (!Buffer.from(back).equals(bytes)) throw new Error('read-back mismatch');",
      "await store.remove('smoke/object.txt');",
      "if (await store.head('smoke/object.txt')) throw new Error('object still present after delete');",
      "console.log('roundtrip-ok');",
    ].join(" ");
    const result = docker(["exec", `worker-${suffix}`, "node", "--input-type=module", "-e", script], { allowFailure: true, timeoutMilliseconds: 60_000 });
    if (!/roundtrip-ok/.test(result.stdout)) throw new Error((result.stderr || result.stdout).trim().slice(-500));
    return "put/get/remove over TLS";
  });

  await check("production security headers (CSP without unsafe-eval, HSTS, nosniff, frame protection)", async () => {
    const response = await request(`${web}/login`);
    if (response.status !== 200) throw new Error(`/login -> ${response.status}`);
    const header = (name) => response.headers.get(name) || "";
    const csp = header("content-security-policy");
    const problems = [];
    if (!csp) problems.push("CSP missing");
    if (/unsafe-eval/.test(csp)) problems.push("CSP allows unsafe-eval");
    if (!/max-age=\d{7,}/.test(header("strict-transport-security"))) problems.push("HSTS missing");
    if (header("x-content-type-options") !== "nosniff") problems.push("nosniff missing");
    if (!/frame-ancestors/.test(csp) && !header("x-frame-options")) problems.push("frame protection missing");
    if (problems.length) throw new Error(problems.join("; "));
  });

  await check("request id generated, validated and echoed", async () => {
    const generated = (await request(`${web}/api/health`)).headers.get("x-request-id") || "";
    if (!/^[0-9a-f-]{36}$/.test(generated)) throw new Error(`no generated request id (${generated})`);
    const echoed = (await request(`${web}/api/health`, { headers: { "x-request-id": "smoke-request-0001" } })).headers.get("x-request-id");
    if (echoed !== "smoke-request-0001") throw new Error(`valid id not echoed (${echoed})`);
    const replaced = (await request(`${web}/api/health`, { headers: { "x-request-id": "x".repeat(400) } })).headers.get("x-request-id") || "";
    if (replaced.length > 128) throw new Error("oversized request id accepted");
  });

  await check("anonymous workspace API refused (401/403, never 5xx)", async () => {
    const response = await request(`${web}/api/workspace/companies`);
    if (![401, 403].includes(response.status)) throw new Error(`/api/workspace/companies -> ${response.status}`);
  });

  await check("worker /livez and /readyz", () =>
    until(async () => {
      const live = await request(`http://127.0.0.1:${ports.worker}/livez`);
      const ready = await request(`http://127.0.0.1:${ports.worker}/readyz`);
      if (live.status !== 200 || ready.status !== 200) throw new Error(`livez ${live.status} readyz ${ready.status} ${await ready.text()}`);
    }),
  );

  await check("web refuses to start with the migration authority present", async () => {
    const result = docker(["run", "--rm", "--name", `web-refuse-${suffix}`, ...common, ...envArgs(productionEnvironment({ DATABASE_URL_FILE: "/run/secrets/vercentlabs/DATABASE_URL", MIGRATION_DATABASE_URL_FILE: "/run/secrets/vercentlabs/MIGRATION_DATABASE_URL" })), "--entrypoint", "node", images.web, "-e", "import('./apps/web/server.js')"], { allowFailure: true, timeoutMilliseconds: 90_000 });
    if (result.error || result.status === null) throw new Error("the web kept running with the migration authority (did not exit)");
    if (result.status === 0) throw new Error("the web exited successfully with the migration authority");
    const output = `${result.stdout}\n${result.stderr}`;
    if (!/MIGRATION_DATABASE_URL must not be available/.test(output)) throw new Error(`no refusal in output (exit ${result.status}): ${output.trim().slice(-400)}`);
  });

  await check("readiness fails when the web runs as the owner role", async () => {
    const name = `web-owner-${suffix}`;
    containers.push(docker(["run", "-d", "--name", name, ...common, "--tmpfs", "/app/apps/web/.next/cache", "-p", `127.0.0.1:${ports.negativeWeb}:3001`, ...envArgs(productionEnvironment({ DATABASE_URL_FILE: "/run/secrets/vercentlabs/MIGRATION_DATABASE_URL", DATABASE_POOL_MAX: "2" })), images.web]).stdout.trim());
    return until(async () => {
      const response = await request(`http://127.0.0.1:${ports.negativeWeb}/api/readiness`).catch(() => null);
      if (!response) throw new Error("not up");
      const body = await response.json().catch(() => ({}));
      if (response.status !== 503 || body.checks?.databaseRole !== "failed") throw new Error(`readiness -> ${response.status} ${JSON.stringify(body.checks)}`);
      return body.checks;
    }, { timeoutMilliseconds: 60_000 });
  });
} catch (error) {
  checks.push({ name: "setup", ok: false, error: error.message });
} finally {
  for (const id of [...containers.reverse(), `web-refuse-${suffix}`]) docker(["rm", "-f", id], { allowFailure: true });
  docker(["network", "rm", network], { allowFailure: true });
  if (admin) {
    await admin.query(`DROP DATABASE IF EXISTS ${database} WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  }
  for (const directory of [secretsDirectory, certificateDirectory, dataDirectory]) fs.rmSync(directory, { recursive: true, force: true });
}

const failed = checks.filter((entry) => !entry.ok);
console.log(JSON.stringify({ productionSmoke: images, passed: checks.length - failed.length, failed: failed.length, checks }, null, 2));
process.exit(failed.length ? 1 : 0);
