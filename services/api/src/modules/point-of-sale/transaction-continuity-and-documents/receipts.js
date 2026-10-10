// F289 -- receipt generation. Deterministic evidence built ONLY from
// already-persisted, immutable sale facts (tenant.pos_sales/
// pos_sale_lines/pos_payments/pos_returns) -- nothing here is computed
// fresh or trusted from a client; it is a read of what completePosCart
// already committed. getPosSaleReceipt itself has no side effects and can
// be called any number of times safely; recordPosReceiptPrintAttempt
// (below) is the actual audited action, backed by
// tenant.pos_receipt_print_events (migration 129) rather than the
// previous client-supplied `?original=1` URL parameter, which any viewer
// could set regardless of real print history.
import { posError } from "../shared/errors.js";
import { requirePermission, assertPosStoreAccess } from "../shared/access-control.js";
import { assertPosAction } from "../permissions/index.js";

const posAdministrator = (context) => context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
  || context.permissions?.includes("pos.store.manage") || context.permissions?.includes("pos.settings.manage");
import { event } from "../shared/audit.js";
import { escapeHtml, getMailTransport } from "../../../core/platform/mail/index.js";

export async function getPosSaleReceipt(client, context, saleId) {
  requirePermission(context, "pos.view");
  const saleResult = await client.query(
    `SELECT sale.*, store.name AS store_name, store.timezone AS store_timezone, terminal.name AS terminal_name,
            party.display_name AS customer_display_name, cashier.full_name AS cashier_name
       FROM tenant.pos_sales sale
       JOIN tenant.pos_stores store ON store.organization_id=sale.organization_id AND store.id=sale.store_id
       JOIN tenant.pos_terminals terminal ON terminal.organization_id=sale.organization_id AND terminal.id=sale.terminal_id
       LEFT JOIN tenant.business_parties party ON party.organization_id=sale.organization_id AND party.id=sale.customer_id
       LEFT JOIN public.users cashier ON cashier.id=sale.created_by
      WHERE sale.organization_id=$1 AND sale.id=$2`,
    [context.organizationId, saleId],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);

  const lines = await client.query(`SELECT * FROM tenant.pos_sale_lines WHERE organization_id=$1 AND sale_id=$2 ORDER BY line_number`, [
    context.organizationId,
    saleId,
  ]);
  const payments = await client.query(`SELECT * FROM tenant.pos_payments WHERE organization_id=$1 AND sale_id=$2 ORDER BY captured_at`, [
    context.organizationId,
    saleId,
  ]);
  const returns = await client.query(
    `SELECT id,return_number,status,refund_total,created_at,completed_at FROM tenant.pos_returns WHERE organization_id=$1 AND sale_id=$2 ORDER BY created_at`,
    [context.organizationId, saleId],
  );
  const promotions = await client.query(
    `SELECT application.discount_amount, promotion.code, promotion.name
       FROM tenant.pos_promotion_applications application
       JOIN tenant.pos_promotions promotion ON promotion.organization_id=application.organization_id AND promotion.id=application.promotion_id
      WHERE application.organization_id=$1 AND application.sale_id=$2`,
    [context.organizationId, saleId],
  );
  const printEvents = await client.query(
    `SELECT print_event.id, print_event.print_type, print_event.requested_at, printer.full_name AS requested_by_name
       FROM tenant.pos_receipt_print_events print_event
       LEFT JOIN public.users printer ON printer.id = print_event.requested_by
      WHERE print_event.organization_id=$1 AND print_event.sale_id=$2
      ORDER BY print_event.requested_at DESC`,
    [context.organizationId, saleId],
  );

  return {
    sale,
    lines: lines.rows,
    payments: payments.rows,
    returns: returns.rows,
    promotionEvidence: promotions.rows,
    printEvents: printEvents.rows,
  };
}

// F289 gap closure: records that a print was REQUESTED for this sale's
// receipt. print_type is derived server-side (never from client input) --
// the first ever recorded attempt for a sale is 'original', every
// subsequent one is 'reprint'. This can only ever claim the print DIALOG
// was invoked by an authenticated, store-access-checked user at a known
// time -- never that physical paper came out, which nothing in a browser
// can observe. Rows are immutable (migration 129's trigger) -- correcting
// a mistake means nothing here, since a print request is simply a fact
// that did or didn't happen.
export async function recordPosReceiptPrintAttempt(client, context, saleId) {
  requirePermission(context, "pos.view");
  const saleResult = await client.query(
    `SELECT id, store_id FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, saleId],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);

  const priorCount = await client.query(
    `SELECT count(*)::int AS count FROM tenant.pos_receipt_print_events WHERE organization_id=$1 AND sale_id=$2`,
    [context.organizationId, saleId],
  );
  const printType = Number(priorCount.rows[0].count) === 0 ? "original" : "reprint";
  if (!posAdministrator(context)) await assertPosAction(client, context, { permission: printType === "original" ? "RECEIPT_PRINT" : "RECEIPT_REPRINT", outletId: sale.store_id });

  const result = await client.query(
    `INSERT INTO tenant.pos_receipt_print_events (organization_id,sale_id,print_type,requested_by)
     VALUES ($1,$2,$3,$4) RETURNING *`,
    [context.organizationId, saleId, printType, context.userId],
  );
  const response = result.rows[0];
  await event(client, context, "pos_sale", saleId, "pos.receipt.print_requested", { printType });
  return response;
}

export async function listPosReceiptPrintEvents(client, context, saleId) {
  requirePermission(context, "pos.view");
  const saleResult = await client.query(
    `SELECT id, store_id FROM tenant.pos_sales WHERE organization_id=$1 AND id=$2`,
    [context.organizationId, saleId],
  );
  const sale = saleResult.rows[0];
  if (!sale) throw posError(404, "Sale was not found.", "POS_SALE_NOT_FOUND");
  await assertPosStoreAccess(client, context, sale.store_id);

  const result = await client.query(
    `SELECT print_event.id, print_event.print_type, print_event.requested_at, printer.full_name AS requested_by_name
       FROM tenant.pos_receipt_print_events print_event
       LEFT JOIN public.users printer ON printer.id = print_event.requested_by
      WHERE print_event.organization_id=$1 AND print_event.sale_id=$2
      ORDER BY print_event.requested_at DESC`,
    [context.organizationId, saleId],
  );
  return result.rows;
}

// ------------------------------------------------------------------ digital receipts (Walk-In Customer, migration 0087)

// Sends a sale's digital receipts: the ones the customer agreed to at checkout (queued with the sale) and, optionally, one more to a new
// address given now (RECEIPT_REPRINT). Email goes through the company's configured mail transport; there is no SMS provider, so an SMS receipt
// is recorded as not configured — the screen never claims a receipt was sent when it was not. Sending never changes the sale. A receipt
// already sent is not sent again unless asked (resend). input: channel + destination + consent (an extra receipt), resend.
export async function sendPosDigitalReceipts(client, context, saleId, input = {}) {
  requirePermission(context, "pos.view");
  const receipt = await getPosSaleReceipt(client, context, saleId);
  const sale = receipt.sale;
  if (input.destination) {
    if (!posAdministrator(context)) await assertPosAction(client, context, { permission: "RECEIPT_REPRINT", outletId: sale.store_id });
    const channel = input.channel === "sms" ? "sms" : "email";
    const destination = channel === "sms" ? String(input.destination).replace(/[\s()-]/g, "") : String(input.destination).trim().toLowerCase();
    if (channel === "sms" ? !/^\+?[0-9]{7,15}$/.test(destination) : !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(destination))
      throw posError(400, "Enter a valid phone number or email.", "POS_RECEIPT_CONTACT_INVALID");
    if (input.consent !== true) throw posError(400, "Confirm the customer agreed to receive the receipt there.", "POS_RECEIPT_CONTACT_INVALID");
    await client.query(`INSERT INTO tenant.pos_receipt_deliveries (organization_id, sale_id, channel, destination, consent, requested_by) VALUES ($1,$2,$3,$4,true,$5)`,
      [context.organizationId, saleId, channel, destination, context.userId ?? null]);
  }
  const statuses = input.resend ? ["pending", "failed", "not_configured", "sent"] : ["pending", "failed"];
  const { rows } = await client.query(`SELECT * FROM tenant.pos_receipt_deliveries WHERE organization_id=$1 AND sale_id=$2 AND status = ANY($3::text[]) ORDER BY created_at`,
    [context.organizationId, saleId, statuses]);
  for (const delivery of rows) {
    let status = "not_configured";
    let failure = delivery.channel === "sms" ? "No SMS provider is configured." : "Email is not configured for this workspace.";
    if (delivery.channel === "email") {
      const mail = getMailTransport();
      if (mail) {
        try {
          await mail.transporter.sendMail({ from: mail.from, replyTo: mail.replyTo ?? undefined, to: delivery.destination,
            subject: `Receipt ${sale.receipt_number} — ${sale.store_name}`, html: receiptHtml(receipt), text: receiptText(receipt) });
          status = "sent";
          failure = null;
        } catch (error) {
          status = "failed";
          failure = String(error?.message ?? "The email could not be sent.").slice(0, 300);
        }
      }
    }
    await client.query(`UPDATE tenant.pos_receipt_deliveries SET status=$3, error=$4, attempts=attempts+1, sent_at=CASE WHEN $3='sent' THEN now() ELSE sent_at END
                         WHERE organization_id=$1 AND id=$2`, [context.organizationId, delivery.id, status, failure]);
  }
  return listPosReceiptDeliveries(client, context, saleId);
}

// A sale's digital receipts: channel, where (masked unless the person may see customer contacts), outcome.
export async function listPosReceiptDeliveries(client, context, saleId) {
  requirePermission(context, "pos.view");
  const full = context.roleSlugs?.some((slug) => ["organization_owner", "system_administrator"].includes(slug))
    || ["sales.customers.view", "pos.settings.manage", "pos.reports.view"].some((key) => context.permissions?.includes(key));
  const { rows } = await client.query(`SELECT id, channel, destination, status, error, attempts, created_at, sent_at FROM tenant.pos_receipt_deliveries
     WHERE organization_id=$1 AND sale_id=$2 ORDER BY created_at`, [context.organizationId, saleId]);
  const mask = (row) => (full ? row.destination : row.channel === "sms" ? `••••${row.destination.slice(-4)}` : row.destination.replace(/^(.)[^@]*(@.*)$/, "$1•••$2"));
  return rows.map((row) => ({ id: row.id, channel: row.channel, destination: mask(row), status: row.status, error: row.error, attempts: row.attempts, at: row.created_at, sentAt: row.sent_at }));
}

const money2 = (value) => Number(value ?? 0).toFixed(2);
function receiptText({ sale, lines }) {
  return [`${sale.store_name} — receipt ${sale.receipt_number}`, ...lines.map((line) => `${line.description} × ${Number(line.quantity)}  ${money2(line.line_total)}`),
    `Tax ${money2(sale.tax_total)}`, `Total ${sale.currency_code} ${money2(sale.grand_total)}`].join("\n");
}
function receiptHtml({ sale, lines }) {
  const rows = lines.map((line) => `<tr><td>${escapeHtml(line.description ?? "")}</td><td style="text-align:right">${escapeHtml(String(Number(line.quantity)))}</td>`
    + `<td style="text-align:right">${money2(line.line_total)}</td></tr>`).join("");
  return `<h2>${escapeHtml(sale.store_name ?? "")}</h2><p>Receipt ${escapeHtml(sale.receipt_number)} · ${escapeHtml(new Date(sale.completed_at ?? sale.created_at).toLocaleString("en-IN"))}</p>`
    + `<table cellpadding="4">${rows}</table><p>Tax ${money2(sale.tax_total)}<br/><strong>Total ${escapeHtml(sale.currency_code ?? "")} ${money2(sale.grand_total)}</strong></p>`;
}
