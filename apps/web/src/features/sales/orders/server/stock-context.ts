import "server-only";

import { HttpError } from "@/core/http";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type QueryClient = { query(text: string, values?: unknown[]): Promise<{ rows: any[] }> };

export type StockAction = "availability" | "reserve" | "issue";
const PERMISSIONS: Record<StockAction, string[]> = {
  availability: ["stock.view"],
  reserve: ["stock.view", "stock.reserve"],
  issue: ["stock.view", "stock.issue"],
};

export function stockContextFor(session: { organizationId: string; userId: string }, companyId: string, action: StockAction) {
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: PERMISSIONS[action], roleSlugs: [] as string[] };
}

export async function orderCompanyId(client: QueryClient, organizationId: string, orderId: string) {
  const result = await client.query(`SELECT company_id FROM tenant.sales_orders WHERE organization_id=$1 AND id=$2`, [organizationId, orderId]);
  if (!result.rows[0]) throw new HttpError(404, "Sales order not found.");
  return result.rows[0].company_id as string;
}

export async function requestCompanyId(client: QueryClient, organizationId: string, requestId: string) {
  const result = await client.query(
    `SELECT sales_order.company_id FROM tenant.sales_fulfillment_requests request JOIN tenant.sales_orders sales_order ON sales_order.id=request.sales_order_id WHERE request.organization_id=$1 AND request.id=$2`,
    [organizationId, requestId],
  );
  if (!result.rows[0]) throw new HttpError(404, "Fulfilment request not found.");
  return result.rows[0].company_id as string;
}
