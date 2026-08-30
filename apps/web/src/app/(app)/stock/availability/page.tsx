import AccessDenied from "@/shared/components/access-denied";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import StockAvailabilityWorkspace from "@/modules/stock/components/availability-workspace";
export const dynamic="force-dynamic";
export default async function Page(){const session=await requireWorkspace();if(!hasPermission(session,PERMISSIONS.stockView))return <AccessDenied area="Stock"/>;return <StockAvailabilityWorkspace/>}
