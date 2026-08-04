import fs from "node:fs";

import AccessDenied from "@/components/access-denied";
import CrmWorkspaceShell from "@/components/crm/crm-workspace-shell";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";

export const dynamic = "force-dynamic";

type LedgerRow = {
  module: string;
  registerStatus: string;
  acceptanceStatus: string;
  id: string;
  name?: string;
  implementationPaths?: string[];
  testPaths?: string[];
};

export default async function MobileReadiness() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.crmView)) {
    return <AccessDenied area="mobile CRM readiness" returnHref="/crm" />;
  }
  const ledger = JSON.parse(
    fs.readFileSync(
      "docs/implementation/four-module-feature-evidence.json",
      "utf8",
    ),
  ) as LedgerRow[];
  const crm = ledger.filter((row) => row.module === "CRM");
  const accepted = crm.filter(
    (row) =>
      row.registerStatus === "Implemented" &&
      row.acceptanceStatus === "verified",
  );
  const offline = crm.find((row) => row.id === "CRM-072");
  const missingPaths = crm.flatMap((row) =>
    [...(row.implementationPaths || []), ...(row.testPaths || [])]
      .filter((path) => !fs.existsSync(path))
      .map((path) => ({ capabilityId: row.id, path })),
  );

  return (
    <CrmWorkspaceShell
      actions={[
        { href: "/crm/leads", label: "Leads" },
        { href: "/crm/pipeline", label: "Pipeline" },
      ]}
      description="Inspect mobile parity, offline mutation evidence, change cursors, dead-letter recovery and declared test-path integrity."
      eyebrow="Mobile CRM readiness"
      metrics={[
        { label: "CRM capabilities", value: String(crm.length) },
        {
          label: "Accepted",
          value: String(accepted.length),
          tone: accepted.length === crm.length ? "success" : "warning",
        },
        {
          label: "Missing evidence paths",
          value: String(missingPaths.length),
          tone: missingPaths.length ? "danger" : "success",
        },
        {
          label: "Offline workflow",
          value: offline?.acceptanceStatus || "missing",
          tone:
            offline?.acceptanceStatus === "verified" ? "success" : "warning",
        },
      ]}
      status={
        missingPaths.length
          ? "Evidence attention required"
          : "Evidence paths valid"
      }
      statusTone={missingPaths.length ? "danger" : "success"}
      title="Offline workflows and mobile parity"
    >
      <div className="crm-product-data-grid">
        <section className="panel">
          <p className="eyebrow">Offline completion evidence</p>
          <h2>{offline?.name || "CRM-072"}</h2>
          <p>
            {offline?.implementationPaths?.length || 0} implementation paths ·{" "}
            {offline?.testPaths?.length || 0} test paths
          </p>
          <div className="crm-stage-summary">
            {(offline?.testPaths || []).map((path) => (
              <div key={path}>
                <span>
                  <strong>{path}</strong>
                </span>
                <b>{fs.existsSync(path) ? "present" : "missing"}</b>
              </div>
            ))}
          </div>
        </section>
        <section className="panel">
          <p className="eyebrow">Integrity blockers</p>
          <h2>
            {missingPaths.length ? `${missingPaths.length} missing` : "None"}
          </h2>
          <div className="crm-stage-summary">
            {missingPaths.length ? (
              missingPaths.map((item) => (
                <div key={`${item.capabilityId}-${item.path}`}>
                  <span>
                    <strong>{item.capabilityId}</strong>
                    <small>{item.path}</small>
                  </span>
                  <b>missing</b>
                </div>
              ))
            ) : (
              <p>
                Every CRM implementation and test path resolves in the
                repository.
              </p>
            )}
          </div>
        </section>
      </div>
    </CrmWorkspaceShell>
  );
}
