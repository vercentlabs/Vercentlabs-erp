import "server-only";

// Receiving posts real stock, and a clean invoice match imports a vendor bill.
// Neither Stock nor Accounting has a web surface for a Procurement user's role,
// so the orchestrations get a narrow, purpose-built context: the caller's
// organisation and user, the RECEIPT'S / MATCH'S own company, and only the exact
// permissions those two operations need.
export function stockContextForReceiving(session: { organizationId: string; userId: string }, companyId: string) {
  return { organizationId: session.organizationId, companyId, userId: session.userId, permissions: ["stock.view", "stock.receive", "stock.issue"], roleSlugs: [] as string[] };
}

export function accountingContextForVendorBill(session: { organizationId: string; userId: string; activeBranchId?: string | null }, companyId: string) {
  return {
    organizationId: session.organizationId,
    userId: session.userId,
    activeCompanyId: companyId,
    activeBranchId: session.activeBranchId ?? null,
    allowAllCompanies: false,
    permissions: ["accounting.view", "accounting.payables.manage"],
    roleSlugs: [] as string[],
  };
}
