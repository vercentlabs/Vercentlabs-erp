import { createHash } from "node:crypto";

import { mapProviderSubscriptionStatus } from "@vercent/api";

import { replaceOrganizationSubscription } from "@/lib/billing";
import { query, transaction } from "@/lib/db";
import { errorResponse, HttpError, ok } from "@/lib/http";
import { verifyRazorpayWebhookSignature } from "@/lib/razorpay";

export const dynamic = "force-dynamic";

function numberDate(value: unknown) {
  const seconds = Number(value || 0);
  return seconds > 0 ? new Date(seconds * 1000) : null;
}

type JsonMap = Record<string, unknown>;

function asMap(value: unknown): JsonMap {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonMap)
    : {};
}

function entity(payload: JsonMap, key: string): JsonMap | null {
  const nestedPayload = asMap(payload.payload);
  const wrapper = asMap(nestedPayload[key]);
  const nestedEntity = asMap(wrapper.entity);
  return Object.keys(nestedEntity).length ? nestedEntity : null;
}

export async function POST(request: Request) {
  let eventRowId: string | null = null;

  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-razorpay-signature") || "";
    if (!signature) {
      throw new HttpError(400, "Missing Razorpay webhook signature.");
    }
    verifyRazorpayWebhookSignature(rawBody, signature);

    let event: JsonMap;
    try {
      event = asMap(JSON.parse(rawBody));
    } catch {
      throw new HttpError(400, "Invalid Razorpay webhook JSON.");
    }

    const eventType = String(event.event || "unknown");
    const providerEventId =
      request.headers.get("x-razorpay-event-id") ||
      createHash("sha256").update(rawBody).digest("hex");
    const providerCreatedAt = numberDate(event.created_at);
    const subscriptionEntity = entity(event, "subscription");
    const paymentEntity = entity(event, "payment");
    const invoiceEntity = entity(event, "invoice");
    const providerSubscriptionIdValue =
      subscriptionEntity?.id ||
      paymentEntity?.subscription_id ||
      invoiceEntity?.subscription_id ||
      null;
    const providerSubscriptionId = providerSubscriptionIdValue
      ? String(providerSubscriptionIdValue)
      : null;

    const eventRows = await query<{
      id: string;
      processing_status: string;
    }>(
      `
        INSERT INTO billing_webhook_events (
          provider_event_id, event_type, provider_created_at, signature, payload
        ) VALUES ($1, $2, $3, $4, $5::jsonb)
        ON CONFLICT (provider, provider_event_id) DO UPDATE SET
          signature = EXCLUDED.signature
        RETURNING id, processing_status
      `,
      [providerEventId, eventType, providerCreatedAt, signature, rawBody],
    );
    const eventRow = eventRows[0];
    if (!eventRow)
      throw new Error("Razorpay webhook event could not be recorded.");
    eventRowId = eventRow.id;

    if (["processed", "ignored"].includes(eventRow.processing_status)) {
      return ok({ duplicate: true });
    }

    const claimed = await query<{ id: string }>(
      `
        UPDATE billing_webhook_events
        SET processing_status = 'processing', processing_error = NULL
        WHERE id = $1 AND processing_status IN ('received', 'failed')
        RETURNING id
      `,
      [eventRowId],
    );
    if (!claimed[0]) return ok({ duplicate: true, processing: true });

    if (!providerSubscriptionId) {
      await query(
        `
          UPDATE billing_webhook_events
          SET processing_status = 'ignored', processed_at = now(),
            processing_error = 'subscription_identifier_missing'
          WHERE id = $1
        `,
        [eventRowId],
      );
      return ok({ ignored: true });
    }

    const subscriptions = await query<{
      id: string;
      organization_id: string;
      last_provider_event_at: Date | null;
    }>(
      `
        SELECT id, organization_id, last_provider_event_at
        FROM organization_subscriptions
        WHERE provider = 'razorpay' AND provider_subscription_id = $1
      `,
      [providerSubscriptionId],
    );
    let subscription = subscriptions[0];

    if (!subscription) {
      const checkoutRows = await query<{
        id: string;
        organization_id: string;
        plan_price_id: string;
      }>(
        `
          SELECT id, organization_id, plan_price_id
          FROM billing_checkout_sessions
          WHERE provider = 'razorpay'
            AND provider_subscription_id = $1
            AND status IN ('created', 'authorised')
          ORDER BY created_at DESC
          LIMIT 1
        `,
        [providerSubscriptionId],
      );
      const checkout = checkoutRows[0];
      if (checkout) {
        const local = await replaceOrganizationSubscription({
          organizationId: checkout.organization_id,
          planPriceId: checkout.plan_price_id,
          providerSubscriptionId,
          checkoutSessionId: checkout.id,
        });
        subscription = {
          id: local.id,
          organization_id: checkout.organization_id,
          last_provider_event_at: null,
        };
      }
    }

    if (!subscription) {
      await query(
        `
          UPDATE billing_webhook_events
          SET processing_status = 'ignored', processed_at = now(),
            processing_error = 'subscription_not_found'
          WHERE id = $1
        `,
        [eventRowId],
      );
      return ok({ ignored: true });
    }

    await transaction(async (client) => {
      await client.query(
        `UPDATE billing_webhook_events SET organization_id = $2 WHERE id = $1`,
        [eventRowId, subscription.organization_id],
      );

      if (subscriptionEntity) {
        const mappedStatus = mapProviderSubscriptionStatus(
          subscriptionEntity.status,
        );
        await client.query(
          `
            UPDATE organization_subscriptions SET
              status = $2,
              provider_status = $3,
              current_period_started_at = COALESCE($4, current_period_started_at),
              current_period_ends_at = COALESCE($5, current_period_ends_at),
              grace_ends_at = CASE
                WHEN $2 IN ('past_due', 'halted')
                  THEN COALESCE($5, now()) + interval '7 days'
                WHEN $2 IN ('active', 'authenticated') THEN NULL
                ELSE grace_ends_at
              END,
              cancelled_at = CASE
                WHEN $2 = 'cancelled' THEN COALESCE($6, now())
                ELSE cancelled_at
              END,
              last_provider_event_at = COALESCE($7, now())
            WHERE id = $1
              AND (
                last_provider_event_at IS NULL
                OR $7 IS NULL
                OR last_provider_event_at <= $7
              )
          `,
          [
            subscription.id,
            mappedStatus,
            String(subscriptionEntity.status || ""),
            numberDate(subscriptionEntity.current_start),
            numberDate(subscriptionEntity.current_end),
            numberDate(subscriptionEntity.ended_at),
            providerCreatedAt,
          ],
        );

        if (subscriptionEntity.customer_id) {
          await client.query(
            `
              UPDATE billing_customers
              SET provider_customer_id = $2
              WHERE organization_id = $1
                AND (
                  provider_customer_id IS NULL
                  OR provider_customer_id = $2
                )
            `,
            [
              subscription.organization_id,
              String(subscriptionEntity.customer_id),
            ],
          );
        }

        if (["authenticated", "active"].includes(mappedStatus)) {
          await client.query(
            `
              UPDATE billing_checkout_sessions
              SET status = 'authorised', subscription_id = $2
              WHERE provider_subscription_id = $1
                AND organization_id = $3
            `,
            [
              providerSubscriptionId,
              subscription.id,
              subscription.organization_id,
            ],
          );
        }
      }

      if (paymentEntity?.id) {
        await client.query(
          `
            INSERT INTO billing_payments (
              organization_id, subscription_id, provider_payment_id,
              provider_invoice_id, amount_paise, fee_paise, tax_paise,
              currency, status, method, captured_at, provider_snapshot
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb
            )
            ON CONFLICT (provider, provider_payment_id) DO UPDATE SET
              provider_invoice_id = EXCLUDED.provider_invoice_id,
              amount_paise = EXCLUDED.amount_paise,
              fee_paise = EXCLUDED.fee_paise,
              tax_paise = EXCLUDED.tax_paise,
              currency = EXCLUDED.currency,
              status = EXCLUDED.status,
              method = EXCLUDED.method,
              captured_at = EXCLUDED.captured_at,
              provider_snapshot = EXCLUDED.provider_snapshot
          `,
          [
            subscription.organization_id,
            subscription.id,
            String(paymentEntity.id),
            paymentEntity.invoice_id ? String(paymentEntity.invoice_id) : null,
            Number(paymentEntity.amount || 0),
            Number(paymentEntity.fee || 0),
            Number(paymentEntity.tax || 0),
            String(paymentEntity.currency || "INR"),
            String(paymentEntity.status || eventType),
            paymentEntity.method ? String(paymentEntity.method) : null,
            numberDate(paymentEntity.captured_at || paymentEntity.created_at),
            JSON.stringify(paymentEntity),
          ],
        );
      }

      if (invoiceEntity?.id) {
        await client.query(
          `
            INSERT INTO billing_invoices (
              organization_id, subscription_id, provider_invoice_id,
              amount_paise, amount_due_paise, amount_paid_paise, tax_paise,
              currency, status, invoice_url, issued_at, paid_at,
              provider_snapshot
            ) VALUES (
              $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
              $13::jsonb
            )
            ON CONFLICT (provider, provider_invoice_id) DO UPDATE SET
              amount_paise = EXCLUDED.amount_paise,
              amount_due_paise = EXCLUDED.amount_due_paise,
              amount_paid_paise = EXCLUDED.amount_paid_paise,
              tax_paise = EXCLUDED.tax_paise,
              currency = EXCLUDED.currency,
              status = EXCLUDED.status,
              invoice_url = EXCLUDED.invoice_url,
              issued_at = EXCLUDED.issued_at,
              paid_at = EXCLUDED.paid_at,
              provider_snapshot = EXCLUDED.provider_snapshot
          `,
          [
            subscription.organization_id,
            subscription.id,
            String(invoiceEntity.id),
            Number(invoiceEntity.amount || invoiceEntity.gross_amount || 0),
            Number(invoiceEntity.amount_due || 0),
            Number(invoiceEntity.amount_paid || 0),
            Number(invoiceEntity.tax || 0),
            String(invoiceEntity.currency || "INR"),
            String(invoiceEntity.status || eventType),
            invoiceEntity.short_url ? String(invoiceEntity.short_url) : null,
            numberDate(
              invoiceEntity.issued_at ||
                invoiceEntity.date ||
                invoiceEntity.created_at,
            ),
            numberDate(invoiceEntity.paid_at),
            JSON.stringify(invoiceEntity),
          ],
        );
      }

      await client.query(
        `
          UPDATE billing_webhook_events
          SET processing_status = 'processed', processed_at = now(),
            processing_error = NULL
          WHERE id = $1
        `,
        [eventRowId],
      );
    });

    return ok({ processed: true });
  } catch (error) {
    if (eventRowId) {
      await query(
        `
          UPDATE billing_webhook_events
          SET processing_status = 'failed', processing_error = $2
          WHERE id = $1 AND processing_status = 'processing'
        `,
        [
          eventRowId,
          error instanceof Error
            ? error.message.slice(0, 1000)
            : "unknown_error",
        ],
      ).catch(() => undefined);
    }
    return errorResponse(error);
  }
}
