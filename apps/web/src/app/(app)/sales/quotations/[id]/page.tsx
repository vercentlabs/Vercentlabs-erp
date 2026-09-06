import {
  EnterpriseDataGrid,
  PageHeader,
  StatusBadge,
  Surface,
  TransactionDocumentArchetype,
  type DataGridColumn,
} from "@/shared/design";
import { getQuotation } from "@vercentlabs/api";
import { notFound } from "next/navigation";

import SalesDocumentActions from "@/modules/sales/components/document-actions";
import { requireWorkspace } from "@/core/auth";
import { hasPermission, PERMISSIONS } from "@/core/authorization";
import { tenantTransaction } from "@/core/db";
import { salesContext } from "@/modules/sales";

export const dynamic = "force-dynamic";

type QuotationLineView = {
  id: string;
  item_code_snapshot: string | null;
  item_name_snapshot: string | null;
  quantity: string | number;
  uom_snapshot: string | null;
  unit_price: string | number;
  tax_amount: string | number;
  line_total: string | number;
};

type QuotationVersionView = {
  id: string;
  version_number: string | number;
  revision_reason: string | null;
  currency_code: string;
  grand_total: string | number;
};

type QuotationEventView = {
  event_type: string;
  from_status: string | null;
  to_status: string | null;
  occurred_at: string | Date;
};

const money = (code: string, value: unknown) => `${code} ${String(value ?? "0")}`;

export default async function QuotationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await requireWorkspace();

  if (!hasPermission(session, PERMISSIONS.salesView)) {
    return notFound();
  }

  const context = salesContext(session);
  let data: Awaited<ReturnType<typeof getQuotation>>;

  try {
    data = await tenantTransaction(context.organizationId, (client) =>
      getQuotation(client, context, id),
    );
  } catch {
    return notFound();
  }

  const quotation = data.quotation;

  return (
    <TransactionDocumentArchetype aria-label="Transaction document">
      <PageHeader
        eyebrow={`Quotation · Revision ${quotation.version_number}`}
        title={quotation.quotation_number}
        description={`${quotation.customer_snapshot?.displayName || "Customer"} · Valid until ${String(quotation.valid_until).slice(0, 10)}`}
        context={<StatusBadge tone="neutral">{quotation.lifecycle_status}</StatusBadge>}
      />

      <SalesDocumentActions
        type="quotation"
        id={id}
        status={quotation.lifecycle_status}
      />

      <div className="sales-two-column">
        <Surface as="section">
          <p className="eyebrow">Commercial lines</p>
          <h2>Products and services</h2>
          {(() => {
            const columns: DataGridColumn<QuotationLineView>[] = [
              {
                id: "item",
                header: "Item",
                cell: (line) => (
                  <>
                    <strong>{line.item_code_snapshot}</strong>
                    <small> {line.item_name_snapshot}</small>
                  </>
                ),
              },
              {
                id: "quantity",
                header: "Quantity",
                cell: (line) => `${line.quantity} ${line.uom_snapshot}`,
              },
              {
                id: "unitPrice",
                header: "Unit price",
                cell: (line) => money(quotation.currency_code, line.unit_price),
              },
              {
                id: "tax",
                header: "Tax",
                cell: (line) => money(quotation.currency_code, line.tax_amount),
              },
              {
                id: "total",
                header: "Total",
                cell: (line) => money(quotation.currency_code, line.line_total),
              },
            ];
            return (
              <EnterpriseDataGrid
                caption="Products and services"
                rows={data.lines}
                rowKey={(line) => line.id}
                columns={columns}
              />
            );
          })()}
        </Surface>

        <aside className="panel sales-summary">
          <p className="eyebrow">Totals</p>
          <dl>
            <div>
              <dt>Subtotal</dt>
              <dd>{money(quotation.currency_code, quotation.subtotal)}</dd>
            </div>
            <div>
              <dt>Discount</dt>
              <dd>{money(quotation.currency_code, quotation.discount_total)}</dd>
            </div>
            <div>
              <dt>Charges</dt>
              <dd>{money(quotation.currency_code, quotation.charge_total)}</dd>
            </div>
            <div>
              <dt>Tax</dt>
              <dd>{money(quotation.currency_code, quotation.tax_total)}</dd>
            </div>
            <div>
              <dt>Grand total</dt>
              <dd>
                <strong>{money(quotation.currency_code, quotation.grand_total)}</strong>
              </dd>
            </div>
            {quotation.margin_percent !== undefined ? (
              <div>
                <dt>Margin</dt>
                <dd>{quotation.margin_percent}%</dd>
              </div>
            ) : null}
          </dl>
        </aside>
      </div>

      <div className="sales-two-column">
        <Surface as="section">
          <p className="eyebrow">Revision history</p>
          <h2>Immutable commercial versions</h2>
          <div className="sales-document-list">
            {data.versions.map((version: QuotationVersionView) => (
              <div key={version.id}>
                <span>
                  <strong>Revision {version.version_number}</strong>
                  <small>{version.revision_reason || "Initial version"}</small>
                </span>
                <b>
                  {version.currency_code} {version.grand_total}
                </b>
              </div>
            ))}
          </div>
        </Surface>

        <Surface as="section">
          <p className="eyebrow">Document events</p>
          <h2>Audit trail</h2>
          <div className="sales-document-list">
            {data.events.map((event: QuotationEventView, index: number) => (
              <div key={`${String(event.occurred_at)}-${index}`}>
                <span>
                  <strong>{event.event_type}</strong>
                  <small>
                    {event.from_status || "Created"} →{" "}
                    {event.to_status || event.from_status || "Recorded"}
                  </small>
                </span>
                <time>{new Date(event.occurred_at).toLocaleString("en-IN")}</time>
              </div>
            ))}
          </div>
        </Surface>
      </div>
    </TransactionDocumentArchetype>
  );
}
