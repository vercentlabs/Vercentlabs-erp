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
