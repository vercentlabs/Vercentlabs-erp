import StockDashboard from "@/modules/stock/components/stock-dashboard";
import AccessDenied from "@/shared/components/access-denied";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
export const dynamic = "force-dynamic";
export default async function Page() {
  const s = await requireWorkspace();
  if (!hasPermission(s, PERMISSIONS.stockView))
    return <AccessDenied area="Stock" />;
  return <StockDashboard />;
}
