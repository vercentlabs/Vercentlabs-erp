import { listStockReorderCandidates } from "@vercentlabs/api";

import { procurementRead } from "@/features/procurement/shared/route-helpers";

// Items at or below their reorder point. Stock has no web surface for a purchasing
// role, so Stock's read runs with a narrow stock.view-only context built here, after
// the caller's own Procurement permission (creating orders) has been checked.
export async function GET() {
  return procurementRead(
    async (client, context, session) => {
      const companyId = context.activeCompanyId;
      if (!companyId) return { candidates: [] };
      const stock = { organizationId: context.organizationId, companyId, userId: session.userId, permissions: ["stock.view"], roleSlugs: [] as string[] };
      return { candidates: await listStockReorderCandidates(client, stock, { limit: 100 }) };
    },
    "procurement.po.create",
  );
}
