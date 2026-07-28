import { ProcurementResourceWorkspace } from "@/components/procurement/procurement-workspace";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";

export const dynamic = "force-dynamic";
export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.procurementView)) return <section className="panel"><h1>Procurement access required</h1></section>;
  const { id } = await params;
  return <ProcurementResourceWorkspace resource="sourcing-events" mode="detail" recordId={id} />;
}
