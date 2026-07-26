import { createHash } from "node:crypto";

import { resolvePublicQuoteToken } from "@vercent/api";
import { notFound } from "next/navigation";

import PublicQuoteDecision from "@/components/public-quote-decision";
import { query, tenantTransaction } from "@/lib/db";

export const dynamic = "force-dynamic";

type PublicQuotationLineView = {
  id: string;
  item_name_snapshot: string | null;
  description_snapshot: string | null;
  quantity: string | number;
  uom_snapshot: string | null;
  unit_price: string | number;
  tax_amount: string | number;
  line_total: string | number;
};

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const rows = await query<{ organization_id: string }>(
    `SELECT organization_id
       FROM sales_public_quote_tokens
      WHERE token_hash = $1
        AND revoked_at IS NULL
        AND expires_at > now()`,
    [tokenHash],
  );

  if (!rows[0]) {
    return notFound();
  }

  const context = {
    organizationId: rows[0].organization_id,
    userId: null,
    activeCompanyId: null,
    activeBranchId: null,
    allowAllCompanies: false,
    permissions: [],
    roleSlugs: [],
  };

  let data: Awaited<ReturnType<typeof resolvePublicQuoteToken>>["quotation"];

  try {
    data = (
      await tenantTransaction(context.organizationId, (client) =>
        resolvePublicQuoteToken(client, context, tokenHash, true),
      )
    ).quotation;
  } catch {
    return notFound();
  }

  const quotation = data.quotation;

  return (
    <main className="public-quote-shell">
      <header>
        <strong>Vercent ERP</strong>
        <span>Secure quotation</span>
      </header>

      <section className="public-quote-hero">
        <div>
          <p>Quotation {quotation.quotation_number}</p>
          <h1>{quotation.customer_snapshot?.displayName || "Commercial proposal"}</h1>
          <span>
            Revision {quotation.version_number} · Valid until{" "}
            {String(quotation.valid_until).slice(0, 10)}
          </span>
        </div>
        <strong>
          {quotation.currency_code} {quotation.grand_total}
        </strong>
      </section>

      <section className="public-quote-card">
        <div className="sales-table">
          <div className="sales-table-row sales-table-head">
            <span>Item</span>
            <span>Quantity</span>
            <span>Unit price</span>
            <span>Tax</span>
            <span>Total</span>
          </div>
          {data.lines.map((line: PublicQuotationLineView) => (
            <div className="sales-table-row" key={line.id}>
              <span>
                <strong>{line.item_name_snapshot}</strong>
                <small>{line.description_snapshot}</small>
              </span>
              <span>
                {line.quantity} {line.uom_snapshot}
              </span>
              <span>
                {quotation.currency_code} {line.unit_price}
              </span>
              <span>
                {quotation.currency_code} {line.tax_amount}
              </span>
              <span>
                {quotation.currency_code} {line.line_total}
              </span>
            </div>
          ))}
        </div>
        <aside className="public-quote-total">
          <span>Grand total</span>
          <strong>
            {quotation.currency_code} {quotation.grand_total}
          </strong>
        </aside>
      </section>

      <section className="public-quote-card">
        <h2>Terms</h2>
        <p>
          {quotation.terms_and_conditions ||
            "Terms are governed by the commercial agreement issued with this quotation."}
        </p>
      </section>

      <PublicQuoteDecision token={token} />
    </main>
  );
}
