import StockDashboard from "@/components/stock/stock-dashboard";
import AccessDenied from "@/components/access-denied";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
export const dynamic = "force-dynamic";
export default async function Page() {
  const s = await requireWorkspace();
  if (!hasPermission(s, PERMISSIONS.stockView))
    return <AccessDenied area="Stock" />;
  return <StockDashboard />;
}
