import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, randomUUID, scrypt as scryptCallback } from "node:crypto";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const landingDirectory = path.resolve(scriptDirectory, "..");
const repositoryRoot = path.resolve(landingDirectory, "../..");
const webDirectory = path.join(repositoryRoot, "apps", "web");
const landingRequire = createRequire(import.meta.url);
const webRequire = createRequire(path.join(webDirectory, "package.json"));
const { chromium } = landingRequire("@playwright/test");
const dotenv = webRequire("dotenv");
const pg = webRequire("pg");
const nextBinary = webRequire.resolve("next/dist/bin/next");
const scrypt = promisify(scryptCallback);

dotenv.config({ path: path.join(webDirectory, ".env.local"), quiet: true });
dotenv.config({ path: path.join(webDirectory, ".env"), quiet: true });

const migrationDatabaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
const runtimeDatabaseUrl = process.env.DATABASE_URL;
if (!migrationDatabaseUrl || !runtimeDatabaseUrl) {
  throw new Error(
    "MIGRATION_DATABASE_URL and DATABASE_URL are required for the Stage 1 live platform test.",
  );
}

function assertSafeDatabaseUrl(value, label) {
  const url = new URL(value);
  const localHosts = new Set(["localhost", "127.0.0.1", "::1"]);
  if (
    !localHosts.has(url.hostname) &&
    process.env.ALLOW_PLATFORM_E2E_NONLOCAL !== "true"
  ) {
    throw new Error(
      `${label} must target a local disposable database. Set ALLOW_PLATFORM_E2E_NONLOCAL=true only in an isolated CI environment.`,
    );
  }
  if (!/vercentlabs/i.test(url.pathname)) {
    throw new Error(`${label} does not look like a Vercentlabs test database.`);
  }
}

assertSafeDatabaseUrl(migrationDatabaseUrl, "MIGRATION_DATABASE_URL");
assertSafeDatabaseUrl(runtimeDatabaseUrl, "DATABASE_URL");

const fixture = {
  organizationId: "10000000-0000-4000-8000-000000000201",
  companyId: "10000000-0000-4000-8000-000000000301",
  branchId: "10000000-0000-4000-8000-000000000401",
  ownerUserId: "10000000-0000-4000-8000-000000000101",
  restrictedUserId: "10000000-0000-4000-8000-000000000102",
  ownerRoleId: "10000000-0000-4000-8000-000000000501",
  restrictedRoleId: "10000000-0000-4000-8000-000000000502",
  ownerEmail: "stage1-owner@vercentlabs.invalid",
  restrictedEmail: "stage1-restricted@vercentlabs.invalid",
  ownerPassword: "Stage1-Owner-Password!2026",
  restrictedPassword: "Stage1-Restricted-Password!2026",
};

const migrationPool = new pg.Pool({
  connectionString: migrationDatabaseUrl,
  max: 20,
  application_name: "vercentlabs-stage1-live-fixture",
});

async function passwordHash(password) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString("hex")}$${Buffer.from(derived).toString("hex")}`;
}

async function cleanupFixture() {
  await migrationPool.query(
    `DELETE FROM auth_rate_limits
      WHERE key LIKE 'stage1-live:%'
         OR key LIKE 'login-ip:198.51.100.%'
         OR key LIKE 'login-credential:198.51.100.%'`,
  );
  await migrationPool.query(
    `DELETE FROM login_events WHERE email = ANY($1::text[])`,
    [[fixture.ownerEmail, fixture.restrictedEmail]],
  );
  await migrationPool.query(
    `DELETE FROM organizations WHERE id = $1 OR slug = 'stage-one-verification'`,
    [fixture.organizationId],
  );
  await migrationPool.query(
    `DELETE FROM users
      WHERE id = ANY($1::uuid[]) OR email = ANY($2::text[])`,
    [
      [fixture.ownerUserId, fixture.restrictedUserId],
      [fixture.ownerEmail, fixture.restrictedEmail],
    ],
  );
}

async function seedFixture() {
  await cleanupFixture();
  const [ownerHash, restrictedHash] = await Promise.all([
    passwordHash(fixture.ownerPassword),
    passwordHash(fixture.restrictedPassword),
  ]);

  const client = await migrationPool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO users (
         id,email,full_name,password_hash,email_verified_at,status,
         failed_login_attempts,locked_until,password_changed_at
       ) VALUES
         ($1,$2,'Stage One Owner',$3,now(),'active',0,NULL,now()),
         ($4,$5,'Stage One Restricted',$6,now(),'active',0,NULL,now())`,
      [
        fixture.ownerUserId,
        fixture.ownerEmail,
        ownerHash,
        fixture.restrictedUserId,
        fixture.restrictedEmail,
        restrictedHash,
      ],
    );
    await client.query(
      `INSERT INTO organizations (
         id,name,slug,country_code,timezone,base_currency,
         fiscal_year_start_month,created_by,status,onboarding_completed_at
       ) VALUES ($1,'Stage One Verification','stage-one-verification','IN',
                 'Asia/Kolkata','INR',4,$2,'active',now())`,
      [fixture.organizationId, fixture.ownerUserId],
    );
    await client.query(
      `INSERT INTO companies (
         id,organization_id,name,legal_name,country_code,base_currency,
         is_primary,code,status
       ) VALUES ($1,$2,'Stage One Company','Stage One Company Private Limited',
                 'IN','INR',true,'S1C','active')`,
      [fixture.companyId, fixture.organizationId],
    );
    await client.query(
      `INSERT INTO branches (
         id,organization_id,company_id,name,code,timezone,is_primary,status
       ) VALUES ($1,$2,$3,'Head Office','HO','Asia/Kolkata',true,'active')`,
      [fixture.branchId, fixture.organizationId, fixture.companyId],
    );
    await client.query(
      `INSERT INTO organization_memberships (organization_id,user_id,role,status)
       VALUES ($1,$2,'owner','active'),($1,$3,'member','active')`,
      [fixture.organizationId, fixture.ownerUserId, fixture.restrictedUserId],
    );
    await client.query(
      `INSERT INTO roles (
         id,organization_id,name,slug,description,is_system,status
       ) VALUES
         ($1,$2,'Stage One Owner','organization_owner',
          'Stage 1 live verification owner role.',true,'active'),
         ($3,$2,'Stage One Restricted','stage_one_restricted',
          'Stage 1 direct-route authorization verification role.',false,'active')`,
      [fixture.ownerRoleId, fixture.organizationId, fixture.restrictedRoleId],
    );
    await client.query(
      `INSERT INTO role_permissions (role_id,permission_key)
       SELECT $1,key FROM permissions`,
      [fixture.ownerRoleId],
    );
    await client.query(
      `INSERT INTO role_permissions (role_id,permission_key)
       VALUES ($1,'workspace.view'),($1,'notifications.view'),($1,'profile.manage')`,
      [fixture.restrictedRoleId],
    );
    await client.query(
      `INSERT INTO user_role_assignments (
         organization_id,user_id,role_id,assigned_by
       ) VALUES ($1,$2,$3,$2),($1,$4,$5,$2)`,
      [
        fixture.organizationId,
        fixture.ownerUserId,
        fixture.ownerRoleId,
        fixture.restrictedUserId,
        fixture.restrictedRoleId,
      ],
    );
    await client.query(
      `INSERT INTO user_preferences (
         organization_id,user_id,active_company_id,active_branch_id,
         locale,timezone,theme
       ) VALUES
         ($1,$2,$3,$4,'en-IN','Asia/Kolkata','system'),
         ($1,$5,$3,$4,'en-IN','Asia/Kolkata','system')`,
      [
        fixture.organizationId,
        fixture.ownerUserId,
        fixture.companyId,
        fixture.branchId,
        fixture.restrictedUserId,
      ],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function verifyDatabaseConcurrencyAndIdempotency() {
  const rateKey = `stage1-live:rate:${randomUUID()}`;
  const attempts = 24;
  const results = await Promise.all(
    Array.from({ length: attempts }, () =>
      migrationPool.query(
        `INSERT INTO auth_rate_limits (key,window_started_at,attempts)
         VALUES ($1,now(),1)
         ON CONFLICT (key) DO UPDATE SET attempts=auth_rate_limits.attempts+1
         RETURNING attempts`,
        [rateKey],
      ),
    ),
  );
  const maximum = Math.max(
    ...results.map((result) => Number(result.rows[0]?.attempts || 0)),
  );
  const stored = await migrationPool.query(
    `SELECT attempts FROM auth_rate_limits WHERE key=$1`,
    [rateKey],
  );
  assert.equal(maximum, attempts);
  assert.equal(Number(stored.rows[0]?.attempts), attempts);

  const idempotencyKey = `stage1-${randomUUID()}`;
  const requestHash = "stage1-request-hash";
  const inserts = await Promise.all(
    Array.from({ length: 12 }, () =>
      migrationPool.query(
        `INSERT INTO mobile_idempotency_keys (
           id,user_id,organization_id,idempotency_key,
           request_method,request_path,request_hash
         ) VALUES ($1,$2,$3,$4,'POST','/api/mobile/v1/stage1',$5)
         ON CONFLICT (user_id,idempotency_key) DO NOTHING
         RETURNING id`,
        [
          randomUUID(),
          fixture.ownerUserId,
          fixture.organizationId,
          idempotencyKey,
          requestHash,
        ],
      ),
    ),
  );
  assert.equal(
    inserts.filter((result) => result.rowCount === 1).length,
    1,
    "exactly one concurrent idempotency claim must win",
  );
  const storedClaim = await migrationPool.query(
    `SELECT request_method,request_path,request_hash
       FROM mobile_idempotency_keys
      WHERE user_id=$1 AND idempotency_key=$2`,
    [fixture.ownerUserId, idempotencyKey],
  );
  assert.deepEqual(storedClaim.rows[0], {
    request_method: "POST",
    request_path: "/api/mobile/v1/stage1",
    request_hash: requestHash,
  });
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("Could not allocate a Stage 1 web port."));
        return;
      }
      resolve(address.port);
    });
  });
}

async function freePort() {
  const server = net.createServer();
  const port = await listen(server);
  await new Promise((resolve) => server.close(resolve));
  return port;
}

async function stopProcess(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function waitUntilReady(child, origin, output) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`ERP web server exited before readiness.\n${output()}`);
    }
    try {
      const response = await fetch(`${origin}/api/health`, {
        cache: "no-store",
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) return;
    } catch {
      // Continue while Next.js compiles the first route.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`ERP web server did not become ready.\n${output()}`);
}

async function wrongMobilePassword(origin, attempt) {
  const response = await fetch(`${origin}/api/mobile/v1/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-vercentlabs-test-client-ip": "198.51.100.31",
    },
    body: JSON.stringify({
      email: fixture.ownerEmail,
      password: `incorrect-password-${attempt}`,
      device: {
        deviceId: "10000000-0000-4000-8000-000000000601",
        platform: "android",
        deviceName: "Stage One Android",
        appVersion: "1.0.0-stage1",
      },
    }),
  });
  assert.equal(response.status, 401);
}

async function signIn(page, origin, email, password) {
  await page.goto(`${origin}/login`, {
    waitUntil: "networkidle",
  });
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL(/\/dashboard$/, { timeout: 30_000 });
}

let webServer;
let browser;
try {
  await seedFixture();
  await verifyDatabaseConcurrencyAndIdempotency();

  const port = await freePort();
  const origin = `http://127.0.0.1:${port}`;
  let serverOutput = "";
  webServer = spawn(
    process.execPath,
    [nextBinary, "dev", "-H", "127.0.0.1", "-p", String(port)],
    {
      cwd: webDirectory,
      env: {
        ...process.env,
        APP_URL: origin,
        FORM_ALLOWED_ORIGINS: origin,
        TRUSTED_PROXY_IP_HEADER: "x-vercentlabs-test-client-ip",
        TRUSTED_PROXY_CLIENT_INDEX: "0",
        DATABASE_URL: runtimeDatabaseUrl,
        MIGRATION_DATABASE_URL: migrationDatabaseUrl,
        ENFORCE_RESTRICTED_DB_ROLE:
          process.env.ENFORCE_RESTRICTED_DB_ROLE || "true",
        BILLING_CHECKOUT_ENABLED: "false",
        BILLING_ENFORCEMENT_MODE: "observe",
      },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  webServer.stdout.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });
  webServer.stderr.on("data", (chunk) => {
    serverOutput += chunk.toString();
  });

  await waitUntilReady(webServer, origin, () => serverOutput);

  for (let attempt = 1; attempt <= 6; attempt += 1) {
    await wrongMobilePassword(origin, attempt);
  }
  const failureState = await migrationPool.query(
    `SELECT failed_login_attempts,locked_until FROM users WHERE id=$1`,
    [fixture.ownerUserId],
  );
  assert.equal(Number(failureState.rows[0]?.failed_login_attempts), 6);
  assert.equal(
    failureState.rows[0]?.locked_until,
    null,
    "anonymous mobile failures must not globally lock the account",
  );

  browser = await chromium.launch({ headless: true });
  const ownerContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1440, height: 900 },
    extraHTTPHeaders: {
      "x-vercentlabs-test-client-ip": "198.51.100.41",
    },
  });
  const ownerPage = await ownerContext.newPage();
  await signIn(ownerPage, origin, fixture.ownerEmail, fixture.ownerPassword);
  await ownerPage
    .getByRole("heading", { name: /Welcome back, Stage\./ })
    .waitFor();
  await ownerPage.goto(`${origin}/sales/orders`, { waitUntil: "networkidle" });
  await ownerPage
    .getByRole("heading", { name: "Customer commitments" })
    .waitFor();
  await ownerContext.close();

  const resetState = await migrationPool.query(
    `SELECT failed_login_attempts,locked_until FROM users WHERE id=$1`,
    [fixture.ownerUserId],
  );
  assert.equal(Number(resetState.rows[0]?.failed_login_attempts), 0);
  assert.equal(resetState.rows[0]?.locked_until, null);

  const restrictedContext = await browser.newContext({
    baseURL: origin,
    viewport: { width: 1280, height: 820 },
    extraHTTPHeaders: {
      "x-vercentlabs-test-client-ip": "198.51.100.42",
    },
  });
  const restrictedPage = await restrictedContext.newPage();
  await signIn(
    restrictedPage,
    origin,
    fixture.restrictedEmail,
    fixture.restrictedPassword,
  );
  await restrictedPage.goto(`${origin}/sales/orders`, {
    waitUntil: "networkidle",
  });
  await restrictedPage
    .getByRole("heading", { name: "Access denied" })
    .waitFor();
  await restrictedPage
    .getByText(/current role cannot view Sales orders/i)
    .waitFor();
  await restrictedContext.close();

  console.log(
    "Stage 1 live platform verification passed: shared login policy, real PostgreSQL concurrency/idempotency, authenticated browser access and direct-route denial.",
  );
} finally {
  if (browser) await browser.close().catch(() => undefined);
  await stopProcess(webServer);
  await cleanupFixture().catch((error) => {
    console.error("Stage 1 fixture cleanup failed:", error);
  });
  await migrationPool.end();
}
