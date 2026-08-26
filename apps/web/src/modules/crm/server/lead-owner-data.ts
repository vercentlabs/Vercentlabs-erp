import "server-only";

type QueryClient = {
  query(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: Array<Record<string, unknown>> }>;
};

export async function enrichLeadOwnerIdentity(
  client: QueryClient,
  organizationId: string,
  rows: Array<Record<string, unknown>>,
) {
  const ownerIds = [
    ...new Set(
      rows.map((row) => String(row.ownerUserId || "")).filter(Boolean),
    ),
  ];
  if (!ownerIds.length)
    return rows.map((row) => ({
      ...row,
      ownerName: null,
      ownerEmail: null,
      ownerStatus: null,
    }));
  const identities = await client.query(
    `SELECT user_account.id,user_account.full_name AS name,user_account.email,
            CASE WHEN user_account.status='active' AND membership.status='active'
                 THEN 'active' ELSE 'inactive' END AS status
       FROM public.users user_account
       LEFT JOIN public.organization_memberships membership
         ON membership.organization_id=$1 AND membership.user_id=user_account.id
      WHERE user_account.id=ANY($2::uuid[])`,
    [organizationId, ownerIds],
  );
  const byId = new Map(
    identities.rows.map((identity) => [String(identity.id), identity]),
  );
  return rows.map((row) => {
    const identity = byId.get(String(row.ownerUserId || ""));
    return {
      ...row,
      ownerName: identity?.name || null,
      ownerEmail: identity?.email || null,
      ownerStatus: row.ownerUserId ? identity?.status || "inactive" : null,
    };
  });
}
