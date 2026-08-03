import path from "node:path";
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import nodemailer from "nodemailer";
import pg from "pg";

import { setTenantContext } from "@vercentlabs/database";
import { databaseConfig } from "@vercentlabs/config";
import { createLogger } from "@vercentlabs/observability";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });

const database = databaseConfig(process.env, { defaultPoolMaximum: 4 });
const logger = createLogger("vercentlabs-crm-outbox-worker");
const workerId = randomUUID();

function integerEnvironment(name, fallback, minimum, maximum) {
  const parsed = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${minimum} and ${maximum}.`,
    );
  }
  return parsed;
}

const pool = new pg.Pool({
  connectionString: database.connectionString,
  max: Math.min(10, database.poolMaximum),
  idleTimeoutMillis: database.idleTimeoutMilliseconds,
  connectionTimeoutMillis: database.connectionTimeoutMilliseconds,
  query_timeout: database.queryTimeoutMilliseconds,
  statement_timeout: database.statementTimeoutMilliseconds,
  application_name: "vercentlabs-crm-outbox-worker",
});
const batchSize = integerEnvironment("CRM_OUTBOX_BATCH_SIZE", 25, 1, 100);
const maximumAttempts = integerEnvironment("CRM_OUTBOX_MAX_ATTEMPTS", 5, 1, 20);
const leaseSeconds = integerEnvironment(
  "CRM_OUTBOX_LEASE_SECONDS",
  300,
  60,
  3_600,
);
const emailTimeoutMs = integerEnvironment(
  "CRM_EMAIL_TIMEOUT_MS",
  10_000,
  1_000,
  120_000,
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
    port: integerEnvironment(
      process.env.CRM_SMTP_PORT ? "CRM_SMTP_PORT" : "SMTP_PORT",
      465,
      1,
      65_535,
    ),
    secure:
      (
        process.env.CRM_SMTP_SECURE ||
        process.env.SMTP_SECURE ||
        "true"
      ).toLowerCase() !== "false",
  };
}

function providerCredential(reference) {
  const value = String(reference || "").trim();
  const variable = value.startsWith("env:") ? value.slice(4) : value;
  if (!/^[A-Z][A-Z0-9_]{2,127}$/.test(variable)) return null;
  const raw = process.env[variable];
  if (!raw) return null;
  let credential;
  try {
    credential = JSON.parse(raw);
  } catch {
    throw new Error(`CRM provider credential ${variable} is invalid JSON.`);
  }
  if (!credential.accessToken) {
    throw new Error(`CRM provider credential ${variable} has no access token.`);
  }
  return credential;
}

function gmailRawMessage(message, from) {
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${String(message.subject || "Vercentlabs CRM message").replace(/[\r\n]/g, " ")}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: 8bit",
    `X-Vercentlabs-Outbox-Id: ${message.eventId}`,
    "",
    message.body || "",
  ].join("\r\n");
  return Buffer.from(headers, "utf8").toString("base64url");
}

async function deliverProviderEmail(message) {
  const provider = String(message.sync_provider || "").toLowerCase();
  if (!["gmail", "microsoft365"].includes(provider)) return null;
  const credential = providerCredential(message.credential_reference);
  if (!credential) {
    throw new Error(`CRM ${provider} credential is not configured.`);
  }
  if (provider === "gmail") {
    const response = await fetch(
      "https://gmail.googleapis.com/gmail/v1/users/me/messages/send",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${credential.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          raw: gmailRawMessage(
            message,
            message.sync_email_address ||
              credential.emailAddress ||
              credential.email,
          ),
          ...(message.external_thread_id
            ? { threadId: message.external_thread_id }
            : {}),
        }),
        signal: AbortSignal.timeout(emailTimeoutMs),
      },
    );
    if (!response.ok) {
      throw new Error(`Gmail send failed (${response.status}).`);
    }
    const receipt = await response.json();
    return {
      provider: "gmail",
      messageId: String(receipt.id || message.eventId),
      receipt,
    };
  }
  const response = await fetch("https://graph.microsoft.com/v1.0/me/sendMail", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${credential.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      message: {
        subject: message.subject || "Vercentlabs CRM message",
        body: { contentType: "Text", content: message.body || "" },
        toRecipients: [{ emailAddress: { address: message.to } }],
        internetMessageHeaders: [
          { name: "X-Vercentlabs-Outbox-Id", value: message.eventId },
        ],
      },
      saveToSentItems: true,
    }),
    signal: AbortSignal.timeout(emailTimeoutMs),
  });
  if (!response.ok) {
    throw new Error(`Microsoft 365 send failed (${response.status}).`);
  }
  return {
    provider: "microsoft365",
    messageId: `microsoft365:${message.eventId}`,
    receipt: { accepted: [message.to], status: response.status },
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

  const providerDelivery = await deliverProviderEmail(message);
  if (providerDelivery) return providerDelivery;

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
        source: "vercentlabs-crm-outbox",
        eventId: message.eventId,
        to: message.to,
        subject: message.subject,
        text: message.body,
      }),
      signal: AbortSignal.timeout(emailTimeoutMs),
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
    subject: message.subject || "Vercentlabs CRM message",
    text: message.body || "",
    headers: { "X-Vercentlabs-Outbox-Id": message.eventId },
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
            AND (
              (event.status IN ('pending', 'failed') AND event.next_attempt_at <= now())
              OR (
                event.status = 'processing'
                AND event.locked_at < now() - ($3 * interval '1 second')
              )
            )
          ORDER BY event.created_at ASC
          LIMIT $2
          FOR UPDATE SKIP LOCKED
        )
        UPDATE tenant.crm_outbox_events AS event
        SET status = 'processing',
            attempt_count = event.attempt_count + 1,
            locked_at = now(),
            locked_by = $4,
            last_error = NULL,
            updated_at = now()
        FROM candidates
        WHERE event.id = candidates.id
        RETURNING event.*
      `,
      [organizationId, batchSize, leaseSeconds, workerId],
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
          email_message.sync_account_id,
          email_thread.external_thread_id,
          sync_account.provider AS sync_provider,
          sync_account.credential_reference,
          sync_account.email_address AS sync_email_address,
          COALESCE(
            NULLIF(communication.to_addresses[1], ''),
            NULLIF(lead.email, ''),
            NULLIF(contact.email, '')
          ) AS recipient
        FROM tenant.crm_communications AS communication
        LEFT JOIN tenant.crm_email_messages AS email_message
          ON email_message.organization_id = communication.organization_id
         AND email_message.communication_id = communication.id
        LEFT JOIN tenant.crm_email_threads AS email_thread
          ON email_thread.organization_id = email_message.organization_id
         AND email_thread.id = email_message.thread_id
        LEFT JOIN tenant.crm_sync_accounts AS sync_account
          ON sync_account.organization_id = email_message.organization_id
         AND sync_account.id = email_message.sync_account_id
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
    const lease = await client.query(
      `SELECT 1 FROM tenant.crm_outbox_events
        WHERE organization_id = $1 AND id = $2 AND status = 'processing'
          AND locked_by = $3
        FOR UPDATE`,
      [event.organization_id, event.id, workerId],
    );
    if (!lease.rows[0]) throw new Error("The outbox delivery lease was lost.");
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
        UPDATE tenant.crm_email_messages
        SET status = $3,
            provider = $4,
            provider_message_id = $5,
            sent_at = CASE WHEN $3 = 'sent' THEN now() ELSE sent_at END,
            metadata = metadata || $6::jsonb
        WHERE organization_id = $1 AND communication_id = $2
      `,
      [
        event.organization_id,
        message.id,
        message.suppressed ? "unsubscribed" : "sent",
        delivery.provider,
        delivery.messageId,
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
            locked_by = NULL,
            last_error = NULL,
            updated_at = now()
        WHERE organization_id = $1 AND id = $2 AND status = 'processing'
          AND locked_by = $5
      `,
      [
        event.organization_id,
        event.id,
        delivery.messageId,
        JSON.stringify(delivery.receipt),
        workerId,
      ],
    );
  });
}

async function failEvent(event, error) {
  const dead = Number(event.attempt_count) >= maximumAttempts;
  const message = String(error?.message || error).slice(0, 1_000);
  await withTenant(event.organization_id, async (client) => {
    const updated = await client.query(
      `
        UPDATE tenant.crm_outbox_events
        SET status = $3,
            next_attempt_at = now() +
              (LEAST(3600, 30 * power(2, GREATEST(attempt_count - 1, 0))) * interval '1 second'),
            locked_at = NULL,
            locked_by = NULL,
            last_error = $4,
            updated_at = now()
        WHERE organization_id = $1 AND id = $2 AND status = 'processing'
          AND locked_by = $5
      `,
      [
        event.organization_id,
        event.id,
        dead ? "dead_letter" : "failed",
        message,
        workerId,
      ],
    );
    if (!updated.rowCount) return;
    await client.query(
      `
        UPDATE tenant.crm_email_messages
        SET status = 'failed',
            metadata = metadata || jsonb_build_object('lastDeliveryError', $3)
        WHERE organization_id = $1 AND communication_id = $2
      `,
      [event.organization_id, event.entity_id, message],
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

  logger.info("outbox_run_completed", {
    workerId,
    delivered,
    suppressed,
    failed,
  });
} finally {
  await pool.end();
}
