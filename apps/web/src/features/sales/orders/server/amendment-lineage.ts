import "server-only";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

// An order version is an *amendment* if an amendment row points at it. In that
// case approving/rejecting it must go through the amendment functions, with the
// version being replaced and the status to resume taken from server records --
// never from the request -- so a caller cannot forge lineage.
export async function amendmentLineage(client: QueryClient, organizationId: string, orderId: string, orderVersionId: string) {
  const amendment = await client.query(
    `SELECT from_version_id FROM tenant.sales_order_amendments WHERE organization_id=$1 AND sales_order_id=$2 AND to_version_id=$3`,
    [organizationId, orderId, orderVersionId],
  );
  const from = amendment.rows[0]?.from_version_id as string | undefined;
  if (!from) return null;
  const submitted = await client.query(
    `SELECT metadata->>'resumeStatus' AS resume_status FROM tenant.sales_document_events WHERE organization_id=$1 AND entity_type='sales_order' AND entity_id=$2 AND event_type='sales_order.amendment_submitted' AND metadata->>'toVersionId'=$3 ORDER BY occurred_at DESC LIMIT 1`,
    [organizationId, orderId, orderVersionId],
  );
  const resumeStatus: "confirmed" | "on_hold" = submitted.rows[0]?.resume_status === "on_hold" ? "on_hold" : "confirmed";
  return { previousVersionId: from, resumeStatus };
}
