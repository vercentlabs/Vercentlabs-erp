import path from "node:path";

import dotenv from "dotenv";
import nodemailer from "nodemailer";
import pg from "pg";

import { setTenantContext } from "@vercent/database";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required.");

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  max: 4,
  application_name: "vercent-crm-outbox-worker",
});
const batchSize = Math.max(
  1,
  Math.min(100, Number(process.env.CRM_OUTBOX_BATCH_SIZE || "25")),
);
const maximumAttempts = Math.max(
  1,
  Math.min(20, Number(process.env.CRM_OUTBOX_MAX_ATTEMPTS || "5")),
);
const requireExplicitConsent =
  process.env.CRM_OUTBOUND_REQUIRE_EXPLICIT_CONSENT?.toLowerCase() !== "false";

let transporter = null;

function smtpConfiguration() {
  const host = process.env.CRM_SMTP_HOST || process.env.SMTP_HOST;
  const user = process.env.CRM_SMTP_USER || process.env.SMTP_USER;
  const password = process.env.CRM_SMTP_PASSWORD || process.env.SMTP_PASSWORD;
  const from = process.env.CRM_EMAIL_FROM || process.env.AUTH_EMAIL_FROM;
  if (!host && !user && !password && !from) return null;
  if (!host || !user || !password || !from) {
    throw new Error("CRM SMTP configuration is incomplete.");
  }
  return {
    host,
    user,
    password,
    from,
    port: Number(process.env.CRM_SMTP_PORT || process.env.SMTP_PORT || "465"),
    secure:
      (
        process.env.CRM_SMTP_SECURE ||
        process.env.SMTP_SECURE ||
        "true"
      ).toLowerCase() !== "false",
  };
}

async function deliverEmail(message) {
  const mode = (process.env.CRM_OUTBOX_PROVIDER || "").toLowerCase();
  if (mode === "fake") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("The fake CRM provider is forbidden in production.");
    }
    return {
      provider: "fake",
      messageId: `fake:${message.eventId}`,
      receipt: { accepted: [message.to] },
    };
  }

  const webhookUrl = process.env.CRM_EMAIL_WEBHOOK_URL?.trim();
  if (webhookUrl) {
    const response = await fetch(webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": message.eventId,
        ...(process.env.CRM_EMAIL_WEBHOOK_SECRET
          ? { Authorization: `Bearer ${process.env.CRM_EMAIL_WEBHOOK_SECRET}` }
          : {}),
      },
      body: JSON.stringify({
        source: "vercent-crm-outbox",
        eventId: message.eventId,
        to: message.to,
        subject: message.subject,
        text: message.body,
      }),
      signal: AbortSignal.timeout(
        Math.max(1_000, Number(process.env.CRM_EMAIL_TIMEOUT_MS || "10000")),
      ),
    });
    if (!response.ok) {
      throw new Error(`CRM email webhook failed (${response.status}).`);
    }
    const receipt = await response.json().catch(() => ({}));
    return {
      provider: "webhook",
      messageId: String(receipt.messageId || message.eventId),
      receipt,
    };
  }

  const smtp = smtpConfiguration();
  if (!smtp) throw new Error("CRM email delivery is not configured.");
  transporter ||= nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    requireTLS: !smtp.secure,
    auth: { user: smtp.user, pass: smtp.password },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    tls: { minVersion: "TLSv1.2" },
  });
  const receipt = await transporter.sendMail({
    from: smtp.from,
    to: message.to,
    subject: message.subject || "Vercent CRM message",
    text: message.body || "",
    headers: { "X-Vercent-Outbox-Id": message.eventId },
  });
  return {
    provider: "smtp",
    messageId: String(receipt.messageId || message.eventId),
    receipt: {
      accepted: receipt.accepted,
      rejected: receipt.rejected,
      response: receipt.response,
    },
  };
}

async function withTenant(organizationId, work) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await setTenantContext(client, organizationId);
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function claimEvents(organizationId) {
  return withTenant(organizationId, async (client) => {
    const result = await client.query(
      `
        WITH candidates AS (
          SELECT event.id
          FROM tenant.crm_outbox_events AS event
          WHERE event.organization_id = $1
            AND event.event_type = 'crm.communication.queued'
            AND event.status IN ('pending', 'failed')
            AND event.next_attempt_at <= now()
          ORDER BY event.created_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE tenant.crm_outbox_events AS event
        SET status = 'processing',
            attempt_count = event.attempt_count + 1,
            locked_at = now(),
            last_error = NULL,
            updated_at = now()
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.*
      `,
      [organizationId, batchSize],
    );
    return result.rows;
  });
}

async function messageForEvent(event) {
  return withTenant(event.organization_id, async (client) => {
    const result = await client.query(
      `
        SELECT
          communication.id,
          communication.channel,
          communication.subject,
          communication.body,
          communication.to_addresses,
          communication.lead_id,
          communication.contact_id,
          communication.party_id,
          COALESCE(
            NULLIF(communication.to_addresses[1], ''),
            NULLIF(lead.email, ''),
            NULLIF(contact.email, '')
          ) AS recipient
        FROM tenant.crm_communications AS communication
        LEFT JOIN tenant.crm_leads AS lead
          ON lead.organization_id = communication.organization_id
         AND lead.id = communication.lead_id
        LEFT JOIN tenant.contacts AS contact
          ON contact.organization_id = communication.organization_id
         AND contact.id = communication.contact_id
        WHERE communication.organization_id = $1
          AND communication.id = $2
          AND communication.direction = 'outbound'
          AND communication.status IN ('queued', 'failed')
        LIMIT 1
      `,
      [event.organization_id, event.entity_id],
    );
    const message = result.rows[0];
    if (!message) throw new Error("Queued CRM communication was not found.");
    if (message.channel !== "email") {
      throw new Error(
        `CRM channel ${message.channel} is not configured for delivery.`,
      );
    }
    if (!message.recipient)
      throw new Error("CRM communication has no recipient.");

    const consent = await client.query(
      `
        SELECT consent.action
        FROM tenant.crm_consent_events AS consent
        WHERE consent.organization_id = $1
          AND consent.channel IN ('email', 'all')
          AND consent.purpose IN ('sales', 'marketing')
          AND (
            ($2::uuid IS NOT NULL AND consent.lead_id = $2)
            OR ($3::uuid IS NOT NULL AND consent.contact_id = $3)
            OR ($4::uuid IS NOT NULL AND consent.party_id = $4)
          )
        ORDER BY consent.occurred_at DESC, consent.created_at DESC
        LIMIT 1
      `,
      [
        event.organization_id,
        message.lead_id,
        message.contact_id,
        message.party_id,
      ],
    );
    const consentAction = consent.rows[0]?.action || null;
    const allowed = ["granted", "resubscribed"].includes(consentAction);
    return {
      ...message,
      consentAction,
      suppressed: requireExplicitConsent && !allowed,
    };
  });
}

async function completeEvent(event, message, delivery) {
  await withTenant(event.organization_id, async (client) => {
    await client.query(
      `
        UPDATE tenant.crm_communications
        SET status = $3,
            provider = $4,
            provider_message_id = $5,
            to_addresses = CASE
              WHEN cardinality(to_addresses) = 0 THEN ARRAY[$6]::text[]
              ELSE to_addresses
            END,
            metadata = metadata || $7::jsonb,
            updated_at = now()
        WHERE organization_id = $1 AND id = $2
      `,
      [
        event.organization_id,
        message.id,
        message.suppressed ? "suppressed" : "sent",
        delivery.provider,
        delivery.messageId,
        message.recipient,
        JSON.stringify({ receipt: delivery.receipt }),
      ],
    );
    await client.query(
      `
        UPDATE tenant.crm_outbox_events
        SET status = 'delivered',
            delivered_at = now(),
            provider_message_id = $3,
            delivery_receipt = $4::jsonb,
            locked_at = NULL,
            last_error = NULL,
            updated_at = now()
        WHERE organization_id = $1 AND id = $2 AND status = 'processing'
      `,
      [
        event.organization_id,
        event.id,
        delivery.messageId,
        JSON.stringify(delivery.receipt),
      ],
    );
  });
}

async function failEvent(event, error) {
  const dead = Number(event.attempt_count) >= maximumAttempts;
  const message = String(error?.message || error).slice(0, 1_000);
  await withTenant(event.organization_id, async (client) => {
    await client.query(
      `
        UPDATE tenant.crm_outbox_events
        SET status = $3,
            next_attempt_at = now() +
              (LEAST(3600, 30 * power(2, GREATEST(attempt_count - 1, 0))) * interval '1 second'),
            locked_at = NULL,
            last_error = $4,
            updated_at = now()
        WHERE organization_id = $1 AND id = $2 AND status = 'processing'
      `,
      [
        event.organization_id,
        event.id,
        dead ? "dead_letter" : "failed",
        message,
      ],
    );
    await client.query(
      `
        UPDATE tenant.crm_communications
        SET status = 'failed',
            metadata = metadata || jsonb_build_object('lastDeliveryError', $3),
            updated_at = now()
        WHERE organization_id = $1 AND id = $2 AND status = 'queued'
      `,
      [event.organization_id, event.entity_id, message],
    );
  });
}

let delivered = 0;
let suppressed = 0;
let failed = 0;
try {
  const organizations = await pool.query(
    `
      SELECT id AS organization_id
      FROM public.organizations
      WHERE status = 'active'
      ORDER BY id
    `,
  );

  for (const row of organizations.rows) {
    const events = await claimEvents(row.organization_id);
    for (const event of events) {
      try {
        const message = await messageForEvent(event);
        if (message.suppressed) {
          await completeEvent(event, message, {
            provider: "consent-policy",
            messageId: `suppressed:${event.id}`,
            receipt: {
              suppressed: true,
              reason: "explicit_consent_missing",
              latestConsentAction: message.consentAction,
            },
          });
          suppressed += 1;
          continue;
        }
        const delivery = await deliverEmail({
          eventId: event.id,
          to: message.recipient,
          subject: message.subject,
          body: message.body,
        });
        await completeEvent(event, message, delivery);
        delivered += 1;
      } catch (error) {
        await failEvent(event, error);
        failed += 1;
      }
    }
  }

  console.log(
    JSON.stringify({
      service: "vercent-crm-outbox-worker",
      delivered,
      suppressed,
      failed,
      completedAt: new Date().toISOString(),
    }),
  );
} finally {
  await pool.end();
}
