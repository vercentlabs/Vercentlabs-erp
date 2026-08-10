import { notFound } from "next/navigation";

import { listCrmRecords } from "@vercentlabs/api";

import AppIcon from "@/components/app-icon";
import GovernancePagination from "@/components/governance-pagination";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const metadata = { title: "Consent" };
export const dynamic = "force-dynamic";

type ConsentEventRow = {
  id: string;
  channel: string;
  purpose: string;
  action: string;
  lawfulBasis: string;
  source: string;
  occurredAt: string;
  expiresAt: string | null;
  leadId: string | null;
  contactId: string | null;
  partyId: string | null;
};

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.complianceView)) notFound();

  const params = await searchParams;
  const page = Number(params.page || 1);
  const pageSize = 50;

  const { rows, total } = (await tenantTransaction(session.organizationId as string, (client) =>
    listCrmRecords(client, crmContext(session), "consent-events", {
      limit: pageSize,
      offset: (Math.max(1, page) - 1) * pageSize,
    }),
  )) as { rows: ConsentEventRow[]; total: number };

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance · Compliance</p>
          <h1>Consent</h1>
          <p>
            The immutable consent evidence log for CRM leads, contacts and
            business partners — channel, purpose, lawful basis and source for
            every grant, withdrawal or suppression on record.
          </p>
        </div>
      </section>

      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th scope="col">Subject</th>
              <th scope="col">Channel</th>
              <th scope="col">Purpose</th>
              <th scope="col">Action</th>
              <th scope="col">Lawful basis</th>
              <th scope="col">Source</th>
              <th scope="col">Occurred</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>
                  {row.leadId
                    ? `Lead ${row.leadId}`
                    : row.contactId
                      ? `Contact ${row.contactId}`
                      : row.partyId
                        ? `Party ${row.partyId}`
                        : "—"}
                </td>
                <td>{row.channel}</td>
                <td>{row.purpose}</td>
                <td>
                  <span
                    className={`status-badge ${row.action === "withdrawn" || row.action === "suppressed" ? "danger" : "success"}`}
                  >
                    {row.action}
                  </span>
                </td>
                <td>{row.lawfulBasis}</td>
                <td>{row.source}</td>
                <td>
                  {new Intl.DateTimeFormat("en-IN", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  }).format(new Date(row.occurredAt))}
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={7}>
                  <div className="empty-state compact">
                    <span className="empty-state-icon" aria-hidden="true">
                      <AppIcon name="audit" size={20} />
                    </span>
                    <div>
                      <strong>No consent events recorded yet</strong>
                      <p>Consent grants, withdrawals and suppressions will appear here.</p>
                    </div>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      <GovernancePagination
        page={page}
        pageSize={pageSize}
        total={total}
        basePath="/compliance/consent"
      />
    </>
  );
}
