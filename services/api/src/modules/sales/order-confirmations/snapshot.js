// The confirmation snapshot: an immutable record of exactly what was
// confirmed, written in the same transaction as the confirmation itself.
//
// The order's lines stay the source of truth for executing the order; the
// snapshot only proves what the customer was told. It holds the order header
// with its customer, contact and address snapshots, the lines, the tax by
// component and the company as it was, and never internal notes, cost or
// margin. The PDF of a confirmation is always built from its snapshot, so it
// reads the same however often and however late it is downloaded. The
// database refuses any change to what a snapshot says, and any deletion.
import { OrderError } from "../orders/constants.js";
import { recordOrderEvent } from "../orders/versions.js";
import { confirmationStatus, CONFIRMATION_STATUS_LABELS, CHANNEL_LABELS } from "./constants.js";

// The same document shape the 0030 migration wrote for orders confirmed before it.
const SNAPSHOT_SQL = `
  INSERT INTO tenant.sales_order_confirmations (organization_id, sales_order_id, sales_order_version_id, version, order_number, snapshot, quotation_variance, variance_reason, confirmed_by)
  SELECT sales_order.organization_id, sales_order.id, version.id, $3, sales_order.sales_order_number,
         jsonb_build_object(
           'order', (to_jsonb(version) - ARRAY['internal_notes', 'cost_total', 'margin_amount', 'margin_percent', 'pricing_trace', 'tax_trace', 'content_hash'])
             || jsonb_build_object(
               'sales_order_number', sales_order.sales_order_number, 'order_date', sales_order.order_date, 'requested_delivery_date', sales_order.requested_delivery_date,
               'owner_name', owner.full_name, 'source_quotation_number', quotation.quotation_number, 'confirmed_at', sales_order.confirmed_at,
               'confirmed_by_name', confirmer.full_name, 'currency_code', btrim(version.currency_code)),
           'lines', COALESCE((SELECT jsonb_agg(to_jsonb(line) - ARRAY['standard_cost', 'cost_amount', 'margin_amount', 'margin_percent', 'pricing_trace', 'tax_trace'] ORDER BY line.sequence)
                       FROM tenant.sales_order_lines line WHERE line.organization_id = version.organization_id AND line.sales_order_version_id = version.id), '[]'::jsonb),
           'taxLines', COALESCE((SELECT jsonb_agg(jsonb_build_object('tax_type', tax.tax_type, 'label', tax.label, 'rate', tax.rate, 'taxable_amount', tax.taxable_amount, 'tax_amount', tax.tax_amount)
                                            ORDER BY tax.tax_type, tax.rate)
                          FROM (SELECT tax_type, label, rate, sum(taxable_amount) AS taxable_amount, sum(tax_amount) AS tax_amount FROM tenant.sales_order_tax_lines
                                 WHERE organization_id = version.organization_id AND sales_order_version_id = version.id GROUP BY tax_type, label, rate) tax), '[]'::jsonb),
           'company', jsonb_build_object('name', COALESCE(NULLIF(organization.legal_name, ''), organization.name), 'tradingName', organization.name, 'taxId', organization.tax_id)),
         $4::jsonb, $5, $6
    FROM tenant.sales_orders sales_order
    JOIN tenant.sales_order_versions version ON version.organization_id = sales_order.organization_id AND version.id = sales_order.current_version_id
    JOIN public.organizations organization ON organization.id = sales_order.organization_id
    LEFT JOIN tenant.sales_quotations quotation ON quotation.organization_id = sales_order.organization_id AND quotation.id = sales_order.source_quotation_id
    LEFT JOIN public.users owner ON owner.id = sales_order.owner_user_id
    LEFT JOIN public.users confirmer ON confirmer.id = sales_order.confirmed_by
   WHERE sales_order.organization_id = $1 AND sales_order.id = $2
  RETURNING id, version, confirmed_at`;

// Writes the next revision for an order that has just been confirmed (its
// confirmed_at and confirmed_by already set). variance: how it differs from
// its accepted quotation, with the reason it was accepted.
export async function createOrderConfirmation(client, context, order, { variance = null, varianceReason = null } = {}) {
  const version = Number(order.confirmation_version ?? 0) + 1;
  const confirmation = (await client.query(SNAPSHOT_SQL,
    [context.organizationId, order.id, version, variance ? JSON.stringify(variance) : null, varianceReason, context.userId ?? null])).rows[0];
  if (!confirmation) throw new OrderError(500, "The order confirmation could not be recorded.", "SALES_ORDER_CONFIRMATION_FAILED");
  await client.query(`UPDATE tenant.sales_orders SET confirmation_version = $3 WHERE organization_id = $1 AND id = $2`, [context.organizationId, order.id, version]);
  await recordOrderEvent(client, context, order.id, "sales_order.confirmation_created", order.lifecycle_status, order.lifecycle_status,
    { confirmationId: confirmation.id, version, varianceReason: varianceReason ?? undefined });
  return confirmation;
}

// Reopening: the current confirmation stays as history but is no longer current.
export async function supersedeCurrentConfirmation(client, context, orderId, reason) {
  const superseded = (await client.query(
    `UPDATE tenant.sales_order_confirmations SET superseded_at = now(), superseded_by = $3, superseded_reason = $4
      WHERE organization_id = $1 AND sales_order_id = $2 AND superseded_at IS NULL RETURNING id, version`,
    [context.organizationId, orderId, context.userId ?? null, reason ?? null])).rows[0] ?? null;
  if (superseded)
    await recordOrderEvent(client, context, orderId, "sales_order.confirmation_superseded", "confirmed", "draft", { confirmationId: superseded.id, version: superseded.version, reason });
  return superseded;
}

// The current confirmation of an order (null for a draft), locked when asked.
export async function currentConfirmation(client, organizationId, orderId, { lock = false } = {}) {
  return (await client.query(
    `SELECT id, version, confirmed_at, sent_at, sent_to, acknowledged_at, superseded_at FROM tenant.sales_order_confirmations
      WHERE organization_id = $1 AND sales_order_id = $2 AND superseded_at IS NULL${lock ? " FOR UPDATE" : ""}`, [organizationId, orderId])).rows[0] ?? null;
}

// Every confirmation of an order, newest first, with how each went out. The snapshots are not included.
export async function listOrderConfirmations(client, organizationId, orderId) {
  const [confirmations, sends] = [
    await client.query(
      `SELECT confirmation.id, confirmation.version, confirmation.confirmed_at, confirmer.full_name AS confirmed_by_name, confirmation.sent_at, confirmation.sent_to,
              sender.full_name AS sent_by_name, confirmation.acknowledged_at, confirmation.acknowledgement_reference, confirmation.acknowledgement_note,
              acknowledger.full_name AS acknowledged_by_name, confirmation.superseded_at, confirmation.superseded_reason, superseder.full_name AS superseded_by_name,
              confirmation.quotation_variance, confirmation.variance_reason, (confirmation.snapshot->'order'->>'grand_total') AS grand_total
         FROM tenant.sales_order_confirmations confirmation
         LEFT JOIN public.users confirmer ON confirmer.id = confirmation.confirmed_by
         LEFT JOIN public.users sender ON sender.id = confirmation.sent_by
         LEFT JOIN public.users acknowledger ON acknowledger.id = confirmation.acknowledged_by
         LEFT JOIN public.users superseder ON superseder.id = confirmation.superseded_by
        WHERE confirmation.organization_id = $1 AND confirmation.sales_order_id = $2 ORDER BY confirmation.version DESC`, [organizationId, orderId]),
    await client.query(
      `SELECT send.id, send.confirmation_id, send.channel, send.recipients, send.subject, send.note, send.pdf_file_id IS NOT NULL AS pdf_kept, send.sent_at, sender.full_name AS sent_by_name
         FROM tenant.sales_order_confirmation_sends send LEFT JOIN public.users sender ON sender.id = send.sent_by
        WHERE send.organization_id = $1 AND send.sales_order_id = $2 ORDER BY send.sent_at DESC`, [organizationId, orderId]),
  ];
  return confirmations.rows.map((row) => {
    const status = confirmationStatus(row);
    return {
      ...row, status, statusLabel: CONFIRMATION_STATUS_LABELS[status], current: !row.superseded_at,
      sends: sends.rows.filter((send) => send.confirmation_id === row.id).map((send) => ({ ...send, channelLabel: CHANNEL_LABELS[send.channel] ?? send.channel })),
    };
  });
}
