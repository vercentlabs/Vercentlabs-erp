import "server-only";

// Receiving posts real stock, and a clean invoice match imports a vendor bill.
// Neither Stock nor Accounting has a web surface for a Procurement user's role,
// so the orchestrations get a narrow, purpose-built context: the caller's
// organisation and user, and only the exact permissions those two operations
// need.
export function stockContextForReceiving(session: {
  organizationId: string;
  userId: string;
}) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    permissions: ["stock.view", "stock.receive", "stock.issue"],
    roleSlugs: [] as string[],
  };
}

export function accountingContextForVendorBill(session: {
  organizationId: string;
  userId: string;
}) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    permissions: ["accounting.view", "accounting.payables.manage"],
    roleSlugs: [] as string[],
  };
}
