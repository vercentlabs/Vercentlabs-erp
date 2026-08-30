import AccessDenied from "@/shared/components/access-denied";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import StockOperationsWorkspace from "@/modules/stock/components/operations-workspace";

export const dynamic = "force-dynamic";

export default async function StockOperationsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.stockView)) return <AccessDenied area="Stock" />;
  return <StockOperationsWorkspace />;
}
