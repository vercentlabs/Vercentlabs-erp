import Link from "next/link";
import { ProcurementDashboard } from "@/components/procurement/procurement-workspace";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";

export const dynamic = "force-dynamic";

export default async function Page() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.procurementView)) {
    return (
      <section className="panel">
        <h1>Procurement access required</h1>
      </section>
    );
  }
  return (
    <>
      <ProcurementDashboard />
      <section className="panel">
        <p className="eyebrow">Stage 10 governance</p>
        <h2>Supplier and source-to-pay control tower</h2>
        <p>
          Review qualification evidence, sourcing competition, approval SLAs,
          delivery risk, receipt variance and owned Procurement exceptions.
        </p>
        <Link className="button secondary" href="/procurement/governance">
          Open Procurement governance
        </Link>
      </section>
    </>
  );
}
