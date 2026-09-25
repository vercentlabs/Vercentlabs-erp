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
