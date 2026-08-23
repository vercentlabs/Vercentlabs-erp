import { ProcurementResourceWorkspace } from "@/modules/procurement/components/procurement-workspace";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";

export const dynamic = "force-dynamic";
export default async function Page() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.procurementView)) return <section className="panel"><h1>Procurement access required</h1></section>;
  return <ProcurementResourceWorkspace resource="requisitions" mode="create" />;
}
