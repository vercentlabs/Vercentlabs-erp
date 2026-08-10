import Link from "next/link";
import { notFound } from "next/navigation";

import { listCrmRecords } from "@vercentlabs/api";

import AppIcon from "@/components/app-icon";
import GovernancePagination from "@/components/governance-pagination";
import { requireWorkspace } from "@/lib/auth";
import { hasPermission, PERMISSIONS } from "@/lib/authorization";
import { crmContext } from "@/lib/crm";
import { tenantTransaction } from "@/lib/db";

export const metadata = { title: "Privacy requests" };
export const dynamic = "force-dynamic";

type PrivacyRequestRow = {
  id: string;
  requestType: string;
  subjectType: string;
  subjectId: string;
  requesterName: string | null;
  requesterEmail: string | null;
  dueAt: string;
  status: string;
  assignedTo: string | null;
};

const STATUS_TONE: Record<string, string> = {
  received: "neutral",
  verification_pending: "warning",
  in_progress: "neutral",
  completed: "success",
  rejected: "danger",
  cancelled: "neutral",
};

export default async function CompliancePage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string; page?: string }>;
}) {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.complianceView)) notFound();

  const params = await searchParams;
  const status = params.status || "";
  const page = Number(params.page || 1);
  const pageSize = 50;

  const { rows, total } = (await tenantTransaction(session.organizationId as string, (client) =>
    listCrmRecords(client, crmContext(session), "privacy-requests", {
      status: status || "all",
      limit: pageSize,
      offset: (Math.max(1, page) - 1) * pageSize,
    }),
  )) as { rows: PrivacyRequestRow[]; total: number };

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Governance · Compliance</p>
          <h1>Privacy requests</h1>
          <p>
            Data-subject access, correction, deletion, restriction and
            consent-withdrawal requests for CRM leads, contacts and business
            partners. Open each request to review, verify and act — nothing
            here is deleted automatically.
          </p>
        </div>
      </section>

      <form className="filter-bar" aria-label="Filter privacy requests">
        <label>
          Status
          <select name="status" defaultValue={status}>
            <option value="">All open and closed</option>
            <option value="received">Received</option>
            <option value="verification_pending">Verification pending</option>
            <option value="in_progress">In progress</option>
            <option value="completed">Completed</option>
            <option value="rejected">Rejected</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </label>
        <button className="secondary-button" type="submit">
          Filter
        </button>
      </form>

      <div className="table-panel">
        <table>
          <thead>
            <tr>
              <th scope="col">Type</th>
              <th scope="col">Subject</th>
              <th scope="col">Requester</th>
              <th scope="col">Due</th>
              <th scope="col">Status</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id}>
                <td>{row.requestType.replaceAll("_", " ")}</td>
                <td>
                  {row.subjectType} · {row.subjectId}
                </td>
                <td>
                  {row.requesterName || "—"}
                  <br />
                  <small>{row.requesterEmail || ""}</small>
                </td>
                <td>
                  {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium" }).format(
                    new Date(row.dueAt),
                  )}
                </td>
                <td>
                  <span className={`status-badge ${STATUS_TONE[row.status] || "neutral"}`}>
                    {row.status.replaceAll("_", " ")}
                  </span>
                </td>
                <td>
                  <Link className="link-button" href={`/crm/privacy-requests/${row.id}`}>
                    Review <AppIcon name="arrow-right" size={14} />
                  </Link>
                </td>
              </tr>
            ))}
            {!rows.length ? (
              <tr>
                <td colSpan={6}>
                  <div className="empty-state compact">
                    <span className="empty-state-icon" aria-hidden="true">
                      <AppIcon name="check" size={20} />
                    </span>
                    <div>
                      <strong>No privacy requests match this filter</strong>
                      <p>Data-subject requests raised for CRM records will appear here.</p>
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
        basePath="/compliance/privacy-requests"
        extraParams={status ? { status } : {}}
      />
    </>
  );
}
