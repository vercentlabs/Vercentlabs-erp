const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function setTenantContext(client, organizationId) {
  if (!UUID_PATTERN.test(String(organizationId || ""))) {
    throw new TypeError(
      "A valid organizationId is required for tenant context.",
    );
  }

  await client.query(
    "SELECT set_config('app.current_organization_id', $1, true)",
    [organizationId],
  );
}

// Identity context (transaction-local): set ONLY after a session token has
// been verified, so RLS lets that user read their own memberships across
// organisations (public.current_app_user_id()). Never from request input.
export async function setUserContext(client, userId) {
  if (!UUID_PATTERN.test(String(userId || ""))) {
    throw new TypeError("A valid userId is required for identity context.");
  }
  await client.query("SELECT set_config('app.current_user_id', $1, true)", [userId]);
}

// Organisation context for a whole checked-out connection, for work that
// manages its own short transactions (billing sagas commit before calling a
// payment provider, so a request-wide transaction is impossible). The context
// is a session setting (survives each COMMIT) and is ALWAYS reset before the
// connection returns to the pool.
export async function runWithOrganizationConnection(client, organizationId, work) {
  if (!UUID_PATTERN.test(String(organizationId || ""))) {
    throw new TypeError("A valid organizationId is required for tenant context.");
  }
  await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organizationId]);
  try {
    return await work(client);
  } finally {
    // A failed saga step may leave an aborted transaction: end it first.
    await client.query("ROLLBACK").catch(() => undefined);
    await client.query("SELECT set_config('app.current_organization_id', '', false)");
  }
}

// The one tenant transaction sequence (docs/01-standards/
// TENANT_TRANSACTION_RLS_STANDARD.md): on ONE checked-out client,
// BEGIN -> transaction-local tenant context (parameterized) -> work ->
// COMMIT, or ROLLBACK on any failure. set_config(..., true) is
// transaction-local, so the context can never leak to the next user of the
// pooled connection. The caller owns checkout/release of `client`, and must
// pass an organizationId taken from authenticated server context (session
// principal or durable job record) — never from request input.
export async function runTenantTransaction(client, organizationId, work) {
  if (!UUID_PATTERN.test(String(organizationId || ""))) {
    throw new TypeError(
      "A valid organizationId is required for tenant context.",
    );
  }
  await client.query("BEGIN");
  try {
    await setTenantContext(client, organizationId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  }
}

export { readMigrationStatus, restrictedRoleRequired, RuntimeCheckError, verifyRestrictedRuntimeRole } from "./runtime-checks.js";
export { EXPECTED_MIGRATIONS } from "./migration-manifest.js";

// Database TLS policy (web and worker). Off unless DATABASE_SSL=true: in GKE
// the app talks plaintext to the Cloud SQL Auth Proxy sidecar on loopback and
// the proxy owns the encrypted, IAM-authenticated connection. Certificate
// verification is always on in production; DATABASE_SSL_INSECURE only relaxes
// it for local development and test.
export function resolveDbSsl(env = process.env) {
  if (env.DATABASE_SSL !== "true") return undefined;
  const production = env.NODE_ENV === "production";
  const insecure = env.DATABASE_SSL_INSECURE === "true";
  if (production && insecure) throw new Error("DATABASE_SSL_INSECURE is not allowed in production. Provide DATABASE_SSL_CA instead.");
  const ca = env.DATABASE_SSL_CA ? env.DATABASE_SSL_CA.replace(/\\n/g, "\n") : undefined;
  return { rejectUnauthorized: !insecure, ...(ca ? { ca } : {}) };
}
export { classifyPublicTable, DEFINER_FUNCTIONS, organizationScopedTables, PUBLIC_TABLES, runtimePrivileges, TABLE_CLASSES } from "./table-classification.js";
