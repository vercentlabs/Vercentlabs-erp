import { ConvergenceBoundary } from "@/shared/design";
import Link from "next/link";
import { ProcurementDashboard } from "@/modules/procurement/components/procurement-workspace";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";

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
    <ConvergenceBoundary area="module">
      <ProcurementDashboard />
      <section className="panel">
        <p className="eyebrow">Stage 10 governance</p>
        <h2>Supplier and source-to-pay control tower</h2>
        <p>
          Review qualification evidence, sourcing competition, approval SLAs,
          delivery risk, receipt variance and owned Procurement exceptions.
        </p>
        <Link className="secondary-button" href="/procurement/governance">
          Open Procurement governance
        </Link>
      </section>
    </ConvergenceBoundary>
  );
}
