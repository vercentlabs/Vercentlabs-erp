import AccessDenied from "@/shared/components/access-denied";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import ProcurementPass1OperationsWorkspace from "@/modules/procurement/components/pass1-operations-workspace";
export const dynamic="force-dynamic";
export default async function Page(){const session=await requireWorkspace();if(!hasPermission(session,PERMISSIONS.procurementView))return <AccessDenied area="Procurement"/>;return <ProcurementPass1OperationsWorkspace/>;}
