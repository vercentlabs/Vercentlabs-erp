import AccessDenied from "@/shared/components/access-denied";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import SalesPass1OperationsWorkspace from "@/modules/sales/components/pass1-operations-workspace";
export const dynamic="force-dynamic";
export default async function Page(){const session=await requireWorkspace();if(!hasPermission(session,PERMISSIONS.salesView))return <AccessDenied area="Sales"/>;return <SalesPass1OperationsWorkspace/>;}
