import "server-only";

export { salesOrderCompanyId as orderCompanyId, salesFulfillmentRequestCompanyId as requestCompanyId } from "@vercentlabs/api";

export type StockAction = "availability" | "reserve" | "issue" | "receive";
const PERMISSIONS: Record<StockAction, string[]> = {
  availability: ["stock.view"],
  reserve: ["stock.view", "stock.reserve"],
  issue: ["stock.view", "stock.issue", "stock.reserve"],
  receive: ["stock.view", "stock.receive"],
};

export function stockContextFor(session: { organizationId: string; userId: string }, companyId: string, action: StockAction) {
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: PERMISSIONS[action], roleSlugs: [] as string[] };
}
