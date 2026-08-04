import fs from "node:fs";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
export const dynamic = "force-dynamic";
export default async function MobileReadiness() {
  const s = await requireWorkspace();
  if (!hasPermission(s, PERMISSIONS.crmView)) return null;
  const ledger = JSON.parse(
    fs.readFileSync(
      "docs/implementation/four-module-feature-evidence.json",
      "utf8",
    ),
  ) as Array<{
    module: string;
    registerStatus: string;
    acceptanceStatus: string;
  }>;
  const crm = ledger.filter((x) => x.module === "CRM");
  const implemented = crm.filter(
    (x) => x.registerStatus === "Implemented",
  ).length;
  const accepted = crm.filter((x) => x.acceptanceStatus === "verified").length;
  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">CRM-12 · Final acceptance</p>
          <h1>Offline mobile and 83-capability readiness</h1>
          <p>
            Encrypted queue, idempotent server application, conflict evidence,
            pull cursors and complete CRM evidence.
          </p>
        </div>
        <span
          className={`status-badge ${implemented === 83 && accepted === 83 ? "success" : "neutral"}`}
        >
          {implemented}/83 implemented
        </span>
      </section>
      <div className="crm-dashboard-grid">
        <section className="panel">
          <p className="eyebrow">Implemented</p>
          <h2>{implemented}</h2>
        </section>
        <section className="panel">
          <p className="eyebrow">Accepted</p>
          <h2>{accepted}</h2>
        </section>
        <section className="panel">
          <p className="eyebrow">Remaining</p>
          <h2>{83 - implemented}</h2>
        </section>
      </div>
    </>
  );
}
