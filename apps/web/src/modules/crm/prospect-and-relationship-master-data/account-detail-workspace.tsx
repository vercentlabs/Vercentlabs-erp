"use client";

import { Record360Archetype } from "@/shared/design";
import Link from "next/link";
import { useRef, useState } from "react";
import { useRouter } from "next/navigation";

import AccountFormDrawer from "@/modules/crm/prospect-and-relationship-master-data/account-form-drawer";
import DuplicateReviewPanel from "@/modules/crm/prospect-and-relationship-master-data/duplicate-review-panel";
import AccountContactRelationshipsPanel from "@/modules/crm/prospect-and-relationship-master-data/account-contact-relationships-panel";
import AccountHierarchyPanel from "@/modules/crm/prospect-and-relationship-master-data/account-hierarchy-panel";
import TimelinePanel from "@/modules/crm/seller-activity-and-follow-up-workspace/timeline-panel";
import NotesPanel from "@/modules/crm/seller-activity-and-follow-up-workspace/notes-panel";
import AttachmentsPanel from "@/modules/crm/seller-activity-and-follow-up-workspace/attachments-panel";
import { requestJson } from "@/shared/http/client-request";

type Account = Record<string, unknown> & {
  id: string;
  displayName: string;
  status: string;
  sensitiveDataRestricted?: boolean;
  relationships?: { contacts?: number; opportunities?: number };
};

function display(value: unknown, fallback = "Not added") {
  return String(value || fallback);
}

function date(value: unknown) {
  if (!value) return "Not available";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(String(value)));
}

export default function AccountDetailWorkspace({
  account,
  canManage,
  canManageDuplicates,
  editing,
  currentUserId,
}: {
  account: Account;
  canManage: boolean;
  canManageDuplicates: boolean;
  editing: boolean;
  currentUserId: string;
}) {
  const router = useRouter();
  const archiveDialog = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const location = [account.city, account.state, account.countryCode]
    .filter(Boolean)
    .join(", ");

  async function archiveAccount() {
    setPending(true);
    setMessage("");
    const result = await requestJson(
      `/api/crm/accounts/${String(account.id)}?expectedUpdatedAt=${encodeURIComponent(String(account.updatedAt || ""))}`,
      {
        method: "DELETE",
      },
    );
    if (!result.ok) {
      setMessage(result.message || "The account could not be archived.");
      setPending(false);
      return;
    }
    archiveDialog.current?.close();
    router.replace(`/crm/accounts/${String(account.id)}`);
    router.refresh();
  }

  return (
    <Record360Archetype className="crm-account-detail">
      <Link className="crm-record-back" href="/crm/accounts">
        ← Accounts
      </Link>
      <header className="crm-account-detail-header">
        <div>
          <p className="eyebrow">CRM · Account</p>
          <h1>{String(account.displayName)}</h1>
          <p>
            {[account.industry, location].filter(Boolean).join(" · ") ||
              "Company information"}
          </p>
          <span className="crm-account-code">{String(account.code)}</span>
        </div>
        <div className="crm-account-detail-actions">
          <span
            className={`status-badge ${account.status === "active" ? "success" : "neutral"}`}
          >
            {account.status === "active" ? "Active" : "Archived"}
          </span>
          {canManage ? (
            <Link
              className="secondary-button"
              href={`/crm/accounts/${String(account.id)}?edit=1`}
            >
              Edit
            </Link>
          ) : null}
          {canManage && account.status === "active" ? (
            <button
              className="danger-button"
              type="button"
              onClick={() => archiveDialog.current?.showModal()}
            >
              Archive
            </button>
          ) : null}
        </div>
      </header>

      {message ? (
        <div className="notice error" role="alert">
          {message}
        </div>
      ) : null}

      {account.sensitiveDataRestricted ? (
        <div className="notice" role="status">
          <strong>Restricted account content.</strong> Statutory identifiers (GSTIN, PAN, MSME registration) are hidden by your role.
        </div>
      ) : null}

      <main className="crm-account-detail-grid">
        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Overview</p>
            <h2>Company information</h2>
          </div>
          <dl className="crm-account-facts">
            <div>
              <dt>Company name</dt>
              <dd>{display(account.displayName)}</dd>
            </div>
            <div>
              <dt>Legal name</dt>
              <dd>{display(account.legalName)}</dd>
            </div>
            <div>
              <dt>Account code</dt>
              <dd>{display(account.code)}</dd>
            </div>
            <div>
              <dt>Account type</dt>
              <dd>{display(account.partyType)}</dd>
            </div>
            <div>
              <dt>Industry</dt>
              <dd>{display(account.industry)}</dd>
            </div>
            <div>
              <dt>Website</dt>
              <dd>
                {account.website ? (
                  <a
                    href={String(account.website)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {String(account.website)}
                  </a>
                ) : (
                  "Not added"
                )}
              </dd>
            </div>
            <div>
              <dt>Phone</dt>
              <dd>
                {account.phone ? (
                  <a href={`tel:${String(account.phone)}`}>
                    {String(account.phone)}
                  </a>
                ) : (
                  "Not added"
                )}
              </dd>
            </div>
            <div>
              <dt>Email</dt>
              <dd>
                {account.email ? (
                  <a href={`mailto:${String(account.email)}`}>
                    {String(account.email)}
                  </a>
                ) : (
                  "Not added"
                )}
              </dd>
            </div>
          </dl>
        </section>

        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Location</p>
            <h2>Business address</h2>
          </div>
          {account.addressLine1 ? (
            <address className="crm-account-address">
              <strong>{String(account.addressLine1)}</strong>
              {account.addressLine2 ? (
                <span>{String(account.addressLine2)}</span>
              ) : null}
              <span>
                {[account.city, account.state, account.postalCode]
                  .filter(Boolean)
                  .join(", ")}
              </span>
              <span>{String(account.countryCode || "")}</span>
            </address>
          ) : (
            <p className="crm-account-muted">
              No business address has been added.
            </p>
          )}
        </section>

        {!account.sensitiveDataRestricted ? (
          <section className="panel crm-account-detail-section">
            <div className="crm-account-section-heading">
              <p className="eyebrow">Compliance</p>
              <h2>Statutory identifiers</h2>
            </div>
            <dl className="crm-account-facts">
              <div>
                <dt>GSTIN</dt>
                <dd>{display(account.gstin)}</dd>
              </div>
              <div>
                <dt>PAN</dt>
                <dd>{display(account.pan)}</dd>
              </div>
              <div>
                <dt>MSME registration</dt>
                <dd>{display(account.msmeNumber)}</dd>
              </div>
            </dl>
          </section>
        ) : null}

        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Governance</p>
            <h2>Record information</h2>
          </div>
          <dl className="crm-account-facts crm-account-facts--compact">
            <div>
              <dt>Company scope</dt>
              <dd>{display(account.companyScopeName, "Organisation-wide")}</dd>
            </div>
            <div>
              <dt>Currency</dt>
              <dd>{display(account.currencyCode)}</dd>
            </div>
            <div>
              <dt>Created</dt>
              <dd>{date(account.createdAt)}</dd>
            </div>
            <div>
              <dt>Last updated</dt>
              <dd>{date(account.updatedAt)}</dd>
            </div>
          </dl>
        </section>

        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Corporate structure</p>
            <h2>Account hierarchy</h2>
          </div>
          <AccountHierarchyPanel accountId={String(account.id)} canManage={canManageDuplicates} />
        </section>

        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Related CRM information</p>
            <h2>Related contacts</h2>
          </div>
          <AccountContactRelationshipsPanel accountId={String(account.id)} />
        </section>

        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Engagement</p>
            <h2>Timeline</h2>
          </div>
          <TimelinePanel endpoint={`/api/crm/accounts/${String(account.id)}/timeline`} />
        </section>

        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Engagement</p>
            <h2>Notes</h2>
          </div>
          <NotesPanel listEndpoint={`/api/crm/accounts/${String(account.id)}/notes`} currentUserId={currentUserId} canManage={canManage} />
        </section>

        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Engagement</p>
            <h2>Files</h2>
          </div>
          <AttachmentsPanel listEndpoint={`/api/crm/accounts/${String(account.id)}/attachments`} canManage={canManage} />
        </section>

        <section className="panel crm-account-detail-section">
          <div className="crm-account-section-heading">
            <p className="eyebrow">Related CRM information</p>
            <h2>Relationships</h2>
          </div>
          <div className="crm-account-related">
            <Link href={`/crm/contacts?accountId=${String(account.id)}`}>
              <span>Contacts</span>
              <strong>{Number(account.relationships?.contacts || 0)}</strong>
              <span aria-hidden="true">→</span>
            </Link>
            <Link href="/crm/opportunities">
              <span>Opportunities</span>
              <strong>
                {Number(account.relationships?.opportunities || 0)}
              </strong>
              <span aria-hidden="true">→</span>
            </Link>
          </div>
        </section>

        {canManageDuplicates ? (
          <section className="panel crm-account-detail-section">
            <div className="crm-account-section-heading">
              <p className="eyebrow">Duplicate management</p>
              <h2>Potential matching accounts</h2>
            </div>
            <DuplicateReviewPanel
              kind="account"
              currentId={String(account.id)}
              searchParams={{
                name: String(account.legalName || account.displayName || ""),
                gstin: String(account.gstin || ""),
                pan: String(account.pan || ""),
              }}
              canMerge={canManageDuplicates}
              onMerged={() => router.push("/crm/accounts")}
            />
          </section>
        ) : null}
      </main>

      <dialog
        className="crm-account-archive-dialog"
        ref={archiveDialog}
        aria-labelledby="archive-account-title"
      >
        <h2 id="archive-account-title">
          Archive {String(account.displayName)}?
        </h2>
        <p>
          The account will be removed from active CRM workspaces. Historical
          relationships and records will be preserved.
        </p>
        {message ? (
          <p className="field-error" role="alert">
            {message}
          </p>
        ) : null}
        <div>
          <button
            className="secondary-button"
            type="button"
            disabled={pending}
            onClick={() => archiveDialog.current?.close()}
          >
            Cancel
          </button>
          <button
            className="danger-button"
            type="button"
            disabled={pending}
            onClick={() => void archiveAccount()}
          >
            {pending ? "Archiving…" : "Archive account"}
          </button>
        </div>
      </dialog>

      {editing && canManage ? (
        <AccountFormDrawer
          account={account}
          closeHref={`/crm/accounts/${String(account.id)}`}
        />
      ) : null}
    </Record360Archetype>
  );
}
