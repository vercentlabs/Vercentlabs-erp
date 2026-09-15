import Link from "next/link";
import { notFound } from "next/navigation";

import AppIcon from "@/shared/components/app-icon";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { IntegrationDeveloperManager } from "@/core/components/integration-developer-manager";
import { listDeveloperApiKeys, listOAuthConnections } from "@/core/shared-platform";
import {
  getOutboxQueueStatus,
  isSystemEmailConfigured,
  listRecentWebhookDeliveries,
  listWebhookSubscriptions,
} from "@/orchestration/integrations";

export const metadata = { title: "Integrations" };
export const dynamic = "force-dynamic";

const OUTBOX_STATUS_LABEL: Record<string, string> = {
  pending: "Queued",
  processing: "Processing",
  delivered: "Delivered",
  failed: "Failed",
  dead_letter: "Dead-lettered",
};

export default async function IntegrationsPage() {
  const session = await requireWorkspace();
  if (!hasPermission(session, PERMISSIONS.integrationsView)) notFound();

  const canManagePlatformIntegrations = hasPermission(session, PERMISSIONS.integrationsManage);
  const [webhooks, outboxStatus, email, recentDeliveries, apiKeys, oauthConnections] = await Promise.all([
    listWebhookSubscriptions(session),
    getOutboxQueueStatus(session),
    Promise.resolve(isSystemEmailConfigured()),
    listRecentWebhookDeliveries(session, { limit: 15 }),
    canManagePlatformIntegrations ? listDeveloperApiKeys(session.organizationId) : Promise.resolve([]),
    canManagePlatformIntegrations ? listOAuthConnections(session.organizationId) : Promise.resolve([]),
  ]);

  const canManageCrmIntegrations = hasPermission(session, PERMISSIONS.crmIntegrationsManage);
  const undeliveredCount = outboxStatus
    .filter((row) => row.status === "pending" || row.status === "processing")
    .reduce((sum, row) => sum + row.count, 0);
  const deadLetterCount = outboxStatus.find((row) => row.status === "dead_letter")?.count ?? 0;

  return (
    <>
      <section className="page-heading">
        <div>
          <p className="eyebrow">Administration · Integrations</p>
          <h1>Integrations</h1>
          <p>
            Only integrations with real backing are shown here. Tenant API keys,
            encrypted Google/Microsoft OAuth connections, outbound webhooks and
            system email are governed here; unsupported provider families remain
            explicitly listed below.
          </p>
        </div>
      </section>

      <section className="dashboard-section" aria-labelledby="integrations-payments-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Payments</p>
            <h2 id="integrations-payments-title">Razorpay</h2>
          </div>
          <Link href="/billing">
            Open Billing <AppIcon name="arrow-right" size={16} />
          </Link>
        </div>
        <p className="billing-commercial-note">
          Subscription checkout, invoices, payments and webhook processing
          are real and live in Billing — managed there, not duplicated here.
        </p>
      </section>

      <section className="dashboard-section" aria-labelledby="integrations-communication-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Communication</p>
            <h2 id="integrations-communication-title">Outbound webhooks &amp; system email</h2>
          </div>
          {canManageCrmIntegrations ? (
            <Link href="/crm/settings">
              Manage in CRM settings <AppIcon name="arrow-right" size={16} />
            </Link>
          ) : null}
        </div>

        <div className="table-panel">
          <table>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">Endpoint</th>
                <th scope="col">Events</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {webhooks.map((webhook) => (
                <tr key={webhook.id}>
                  <td>{webhook.name}</td>
                  <td>{webhook.endpointUrl}</td>
                  <td>{webhook.eventTypes.join(", ") || "—"}</td>
                  <td>
                    <span
                      className={`status-badge ${webhook.status === "active" ? "success" : "neutral"}`}
                    >
                      {webhook.status === "active" ? "Active — delivery is automated" : webhook.status}
                    </span>
                  </td>
                </tr>
              ))}
              {!webhooks.length ? (
                <tr>
                  <td colSpan={4}>No outbound webhook subscriptions configured.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        <p className="billing-commercial-note">
          A real background worker process (services/worker) now delivers
          queued events to every active subscription whose event types
          match — {undeliveredCount} currently queued or in flight
          {deadLetterCount > 0 ? `, ${deadLetterCount} dead-lettered after exhausting retries` : ""}.
          Delivery only actually happens while the worker process is
          running (<code>pnpm start:worker</code> in production) — if the
          queue below stops draining, check the worker&apos;s own logs, not
          this page.
        </p>

        <div className="metric-grid metric-grid-spaced" aria-label="Outbound event queue">
          {outboxStatus.map((row) => (
            <article className="metric-card static" key={row.status}>
              <span className="metric-icon" aria-hidden="true">
                <AppIcon name="notifications" size={21} />
              </span>
              <span className="metric-copy">
                <small>{OUTBOX_STATUS_LABEL[row.status] || row.status}</small>
                <strong>{row.count}</strong>
              </span>
            </article>
          ))}
          {!outboxStatus.length ? (
            <article className="metric-card static">
              <span className="metric-copy">
                <small>Outbound event queue</small>
                <strong>Empty</strong>
              </span>
            </article>
          ) : null}
        </div>

        <div className="table-panel metric-grid-spaced">
          <table>
            <thead>
              <tr>
                <th scope="col">Event</th>
                <th scope="col">Status</th>
                <th scope="col">Attempts</th>
                <th scope="col">Delivered / next attempt</th>
                <th scope="col">Detail</th>
              </tr>
            </thead>
            <tbody>
              {recentDeliveries.map((delivery) => (
                <tr key={delivery.id}>
                  <td>{delivery.event_type}</td>
                  <td>
                    <span className={`status-badge ${delivery.status === "delivered" ? "success" : delivery.status === "dead_letter" ? "danger" : "neutral"}`}>
                      {OUTBOX_STATUS_LABEL[delivery.status] || delivery.status}
                    </span>
                  </td>
                  <td>{delivery.attempt_count}</td>
                  <td>
                    {delivery.delivered_at
                      ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(delivery.delivered_at))
                      : delivery.next_attempt_at
                        ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(delivery.next_attempt_at))
                        : "—"}
                  </td>
                  <td>
                    {delivery.last_error ? (
                      <details className="audit-event-detail">
                        <summary>View</summary>
                        <pre>{JSON.stringify(delivery.last_error, null, 2)}</pre>
                      </details>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
              {!recentDeliveries.length ? (
                <tr>
                  <td colSpan={5}>No webhook events have been queued yet.</td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>

        <p className="billing-commercial-note metric-grid-spaced">
          System email (verification, password reset, invitations):{" "}
          {email.transport === "smtp"
            ? "configured via SMTP."
            : email.transport === "webhook"
              ? "configured via outbound webhook fallback."
              : "not configured — delivery will fail until an operator sets SMTP or a delivery webhook."}
        </p>
      </section>


      {canManagePlatformIntegrations ? (
        <section className="dashboard-section" aria-labelledby="integrations-developer-title">
          <div className="section-title-row">
            <div>
              <p className="eyebrow">Developer platform</p>
              <h2 id="integrations-developer-title">API keys &amp; OAuth</h2>
            </div>
          </div>
          <p className="billing-commercial-note">
            API-key secrets are stored only as SHA-256 hashes and shown once at creation. OAuth credentials are encrypted with AES-256-GCM using the operator-managed integration key.
          </p>
          <IntegrationDeveloperManager
            keys={apiKeys.map((key) => ({
              id: key.id, name: key.name, prefix: key.key_prefix, scopes: key.scopes, status: key.status,
              expiresAt: key.expires_at?.toISOString() || null, lastUsedAt: key.last_used_at?.toISOString() || null, createdAt: key.created_at.toISOString(),
            }))}
            connections={oauthConnections.map((item) => ({
              ...item, expires_at: item.expires_at?.toISOString() || null, updated_at: item.updated_at.toISOString(),
            }))}
          />
        </section>
      ) : null}

      <section className="dashboard-section" aria-labelledby="integrations-gaps-title">
        <div className="section-title-row">
          <div>
            <p className="eyebrow">Not yet implemented</p>
            <h2 id="integrations-gaps-title">Confirmed absent</h2>
          </div>
        </div>
        <div className="metric-grid">
          {[
            "WhatsApp/SMS sending (consent tracking exists; no provider is wired)",
            "E-commerce, marketplace, shipping/logistics connectors",
            "Identity provider / SSO",
            "Live bank-feed connector (bank statements are manual/CSV import today)",
          ].map((item) => (
            <article className="metric-card static" key={item}>
              <span className="metric-copy">
                <strong>{item}</strong>
              </span>
            </article>
          ))}
        </div>
      </section>
    </>
  );
}
