// Email campaigns (CRM plan 5.8): one email to many leads or contacts, sent in batches by the worker.
//
//   audience   leads or contacts, narrowed by a few filters (status, stage, source, campaign, tag, owner, state, city, rating); only
//              people who agreed to email (a lead's email consent; a contact's email or marketing consent), have an address, are not
//              marked do-not-contact or do-not-email and are not on the opt-out list receive it — the others are listed as skipped
//              with why. One email per address.
//   sending    when scheduled (now or at a time), the recipients are fixed; the worker sends 50 per tick per organization, checking the
//              opt-out list again just before each. {{first_name}}, {{last_name}}, {{name}} and {{company}} are filled in.
//   tracking   every email carries an unsubscribe link (one click adds the address to the opt-out list for email), a List-Unsubscribe
//              header, an open pixel, and its links go through a counter that leads on to the same page.
import { createHash, randomBytes } from "node:crypto";
import { setTenantContext } from "@vercentlabs/database";

import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { CrmError } from "../data-management/errors.js";

const MANAGE = "crm.settings.manage";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BATCH = 50;
const MAX_RECIPIENTS = 20000;
const hash = (value) => createHash("sha256").update(String(value)).digest("hex");
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (field, message) => new CrmError(400, message, "CRM_MAILING_VALIDATION", { issues: [{ field, message }] });
const PLACEHOLDER = /\{\{\s*(first_name|last_name|name|company)\s*\}\}/g;

function requireManage(context) {
  if (context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE)) return;
  throw new CrmError(403, "You do not have permission to send email campaigns.", "PERMISSION_DENIED");
}

const FILTERS = Object.freeze({
  leads: { status: "lead.status", stage: "lead.stage", sourceId: "lead.source_id", campaignId: "lead.campaign_id", ownerId: "lead.owner_user_id", rating: "lead.rating",
    state: "lower(lead.state)", city: "lower(lead.city)" },
  contacts: { ownerId: "person.owner_user_id", city: "lower(person.city)", accountId: "person.party_id" },
});

function cleanFilters(audience, value) {
  const out = {};
  for (const [key, raw] of Object.entries(value && typeof value === "object" ? value : {})) {
    if (key === "tagId" && audience === "leads" && UUID.test(String(raw))) { out.tagId = String(raw); continue; }
    if (!FILTERS[audience][key] || text(raw) === "") continue;
    out[key] = ["state", "city"].includes(key) ? text(raw).toLowerCase().slice(0, 120) : text(raw).slice(0, 120);
  }
  return out;
}

// The audience with, for each person, whether they may be emailed and why not.
async function audienceRows(client, organizationId, audience, filters) {
  const values = [organizationId];
  const bind = (value) => { values.push(value); return `$${values.length}`; };
  const where = Object.entries(filters).filter(([key]) => key !== "tagId").map(([key, value]) => `${FILTERS[audience][key]} = ${bind(value)}`);
  const optedOut = (column) => `EXISTS (SELECT 1 FROM tenant.crm_opt_outs opt_out WHERE opt_out.organization_id = $1 AND opt_out.kind = 'email' AND opt_out.value = lower(${column})
    AND opt_out.channels && ARRAY['all', 'email']::text[])`;
  if (audience === "leads") {
    if (filters.tagId) where.push(`EXISTS (SELECT 1 FROM tenant.crm_record_tags tagged WHERE tagged.organization_id = $1 AND tagged.entity_type = 'lead' AND tagged.entity_id = lead.id AND tagged.tag_id = ${bind(filters.tagId)})`);
    return (await client.query(
      `SELECT 'lead' AS entity_type, lead.id, lower(btrim(lead.email)) AS email, lead.first_name, lead.last_name, lead.company_name AS company,
              CASE WHEN COALESCE(btrim(lead.email), '') = '' THEN 'No email address' WHEN lead.do_not_contact THEN 'Asked not to be contacted'
                   WHEN NOT lead.consent_email THEN 'Has not agreed to email' WHEN ${optedOut("lead.email")} THEN 'On the opt-out list' END AS skip_reason
         FROM tenant.crm_leads lead
        WHERE lead.organization_id = $1 AND lead.archived_at IS NULL AND lead.merged_into_lead_id IS NULL AND lead.status <> 'converted' ${where.map((clause) => `AND ${clause}`).join(" ")}
        ORDER BY lead.created_at LIMIT ${MAX_RECIPIENTS + 1}`, values)).rows;
  }
  return (await client.query(
    `SELECT 'contact' AS entity_type, person.id, lower(btrim(person.email)) AS email, person.first_name, person.last_name, party.display_name AS company,
            CASE WHEN COALESCE(btrim(person.email), '') = '' THEN 'No email address' WHEN person.do_not_email THEN 'Asked not to be emailed'
                 WHEN NOT (person.consent_email OR person.marketing_consent = 'opted_in') THEN 'Has not agreed to email' WHEN ${optedOut("person.email")} THEN 'On the opt-out list' END AS skip_reason
       FROM tenant.contacts person LEFT JOIN tenant.business_parties party ON party.organization_id = person.organization_id AND party.id = person.party_id
      WHERE person.organization_id = $1 AND person.status = 'active' ${where.map((clause) => `AND ${clause}`).join(" ")}
      ORDER BY person.created_at LIMIT ${MAX_RECIPIENTS + 1}`, values)).rows;
}

// Who a campaign would reach, before it is sent: { total, eligible, skipped: { reason: count } }.
export async function previewMailingAudience(client, context, { audience, filters } = {}) {
  requireManage(context);
  if (!FILTERS[audience]) throw invalid("audience", "Choose leads or contacts.");
  const rows = await audienceRows(client, context.organizationId, audience, cleanFilters(audience, filters));
  const seen = new Set();
  const skipped = {};
  let eligible = 0;
  for (const row of rows) {
    const reason = row.skip_reason ?? (seen.has(row.email) ? "Same address as another person" : null);
    if (reason) skipped[reason] = (skipped[reason] ?? 0) + 1;
    else { eligible += 1; seen.add(row.email); }
  }
  return { total: rows.length, eligible, skipped, tooMany: rows.length > MAX_RECIPIENTS };
}

function toMailing(row) {
  return {
    id: row.id, name: row.name, audience: row.audience, filters: row.audience_filters ?? {}, subject: row.subject, body: row.body, campaignId: row.campaign_id ?? null,
    status: row.status, scheduledAt: row.scheduled_at, startedAt: row.started_at, finishedAt: row.finished_at, createdAt: row.created_at, createdByName: row.created_by_name ?? null,
    counts: { recipients: Number(row.recipients ?? 0), sent: Number(row.sent ?? 0), skipped: Number(row.skipped ?? 0), failed: Number(row.failed ?? 0),
      opened: Number(row.opened ?? 0), clicked: Number(row.clicked ?? 0), unsubscribed: Number(row.unsubscribed ?? 0) },
  };
}
const MAILING_SELECT = `SELECT mailing.*, member.full_name AS created_by_name,
    (SELECT count(*) FROM tenant.crm_mailing_recipients r WHERE r.mailing_id = mailing.id) AS recipients,
    (SELECT count(*) FROM tenant.crm_mailing_recipients r WHERE r.mailing_id = mailing.id AND r.status = 'sent') AS sent,
    (SELECT count(*) FROM tenant.crm_mailing_recipients r WHERE r.mailing_id = mailing.id AND r.status = 'skipped') AS skipped,
    (SELECT count(*) FROM tenant.crm_mailing_recipients r WHERE r.mailing_id = mailing.id AND r.status = 'failed') AS failed,
    (SELECT count(*) FROM tenant.crm_mailing_recipients r WHERE r.mailing_id = mailing.id AND r.opened_at IS NOT NULL) AS opened,
    (SELECT count(*) FROM tenant.crm_mailing_recipients r WHERE r.mailing_id = mailing.id AND r.clicked_at IS NOT NULL) AS clicked,
    (SELECT count(*) FROM tenant.crm_mailing_recipients r WHERE r.mailing_id = mailing.id AND r.unsubscribed_at IS NOT NULL) AS unsubscribed
  FROM tenant.crm_mailings mailing LEFT JOIN users member ON member.id = mailing.created_by`;

export async function listMailings(client, context) {
  requireManage(context);
  return (await client.query(`${MAILING_SELECT} WHERE mailing.organization_id = $1 ORDER BY mailing.created_at DESC LIMIT 200`, [context.organizationId])).rows.map(toMailing);
}

export async function getMailing(client, context, mailingId) {
  requireManage(context);
  const row = UUID.test(String(mailingId ?? "")) ? (await client.query(`${MAILING_SELECT} WHERE mailing.organization_id = $1 AND mailing.id = $2`, [context.organizationId, mailingId])).rows[0] : null;
  if (!row) throw new CrmError(404, "Campaign email not found.", "CRM_MAILING_NOT_FOUND");
  return toMailing(row);
}

async function clean(client, context, input, current = null) {
  const out = {};
  if (!current || has(input, "name")) { out.name = text(input.name).slice(0, 120); if (!out.name) throw invalid("name", "Name the campaign email."); }
  if (!current || has(input, "audience")) { out.audience = input.audience; if (!FILTERS[out.audience]) throw invalid("audience", "Choose leads or contacts."); }
  const audience = out.audience ?? current?.audience;
  if (!current || has(input, "filters") || has(input, "audience")) out.audience_filters = JSON.stringify(cleanFilters(audience, input.filters ?? current?.audience_filters));
  if (!current || has(input, "subject")) { out.subject = text(input.subject).replace(/[\r\n]+/g, " ").slice(0, 300); if (!out.subject) throw invalid("subject", "Write a subject."); }
  if (!current || has(input, "body")) { out.body = text(input.body).slice(0, 50000); if (!out.body) throw invalid("body", "Write the email."); }
  if (has(input, "campaignId")) {
    out.campaign_id = input.campaignId || null;
    if (out.campaign_id && !(UUID.test(String(out.campaign_id)) && (await client.query("SELECT 1 FROM tenant.crm_campaigns WHERE organization_id = $1 AND id = $2", [context.organizationId, out.campaign_id])).rows[0]))
      throw invalid("campaignId", "Choose a campaign from the list.");
  }
  return out;
}

// input: { name, audience: leads | contacts, filters?, subject, body, campaignId? }
export async function createMailing(client, context, input = {}) {
  requireManage(context);
  const fields = await clean(client, context, input);
  const columns = Object.keys(fields);
  const row = (await client.query(
    `INSERT INTO tenant.crm_mailings (organization_id, created_by, updated_by, ${columns.join(", ")}) VALUES ($1, $2, $2, ${columns.map((column, index) => `$${index + 3}${column === "audience_filters" ? "::jsonb" : ""}`).join(", ")}) RETURNING id`,
    [context.organizationId, context.userId ?? null, ...columns.map((column) => fields[column])])).rows[0];
  return getMailing(client, context, row.id);
}

async function lockDraft(client, context, mailingId) {
  const row = UUID.test(String(mailingId ?? "")) ? (await client.query("SELECT * FROM tenant.crm_mailings WHERE organization_id = $1 AND id = $2 FOR UPDATE", [context.organizationId, mailingId])).rows[0] : null;
  if (!row) throw new CrmError(404, "Campaign email not found.", "CRM_MAILING_NOT_FOUND");
  return row;
}

export async function updateMailing(client, context, mailingId, input = {}) {
  requireManage(context);
  const row = await lockDraft(client, context, mailingId);
  if (row.status !== "draft") throw new CrmError(409, "Only a draft can be changed. Cancel it first to change what is sent.", "CRM_MAILING_NOT_DRAFT");
  const fields = await clean(client, context, input, row);
  const columns = Object.keys(fields);
  if (columns.length)
    await client.query(`UPDATE tenant.crm_mailings SET ${columns.map((column, index) => `${column} = $${index + 4}${column === "audience_filters" ? "::jsonb" : ""}`).join(", ")}, updated_by = $3, updated_at = now()
      WHERE organization_id = $1 AND id = $2`, [context.organizationId, row.id, context.userId ?? null, ...columns.map((column) => fields[column])]);
  return getMailing(client, context, row.id);
}

// Fixes the recipients and schedules the sending: now, or at `scheduledAt`.
export async function scheduleMailing(client, context, mailingId, { scheduledAt = null } = {}) {
  requireManage(context);
  const row = await lockDraft(client, context, mailingId);
  if (row.status !== "draft") throw new CrmError(409, "This campaign email is already scheduled or sent.", "CRM_MAILING_NOT_DRAFT");
  // A time given, or now by the database's clock (the same clock the worker compares with).
  const at = scheduledAt ? new Date(scheduledAt) : null;
  if (at && Number.isNaN(at.getTime())) throw invalid("scheduledAt", "Choose when to send it.");
  const rows = await audienceRows(client, context.organizationId, row.audience, row.audience_filters ?? {});
  if (rows.length > MAX_RECIPIENTS) throw new CrmError(409, `A campaign email goes to at most ${MAX_RECIPIENTS.toLocaleString("en-IN")} people. Narrow the audience.`, "CRM_MAILING_TOO_MANY");
  const seen = new Set();
  let eligible = 0;
  for (const person of rows) {
    const reason = person.skip_reason ?? (seen.has(person.email) ? "Same address as another person" : null);
    if (!reason) { seen.add(person.email); eligible += 1; }
    await client.query(
      `INSERT INTO tenant.crm_mailing_recipients (organization_id, mailing_id, entity_type, entity_id, email, status, skip_reason, token_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) ON CONFLICT (mailing_id, entity_type, entity_id) DO NOTHING`,
      [context.organizationId, row.id, person.entity_type, person.id, person.email || "-", reason ? "skipped" : "queued", reason, hash(randomBytes(24).toString("hex"))]);
  }
  if (!eligible) throw new CrmError(409, "Nobody in this audience may be emailed: check consent and the opt-out list.", "CRM_MAILING_NO_RECIPIENTS");
  await client.query("UPDATE tenant.crm_mailings SET status = 'scheduled', scheduled_at = COALESCE($3, now()), updated_by = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, row.id, at, context.userId ?? null]);
  return getMailing(client, context, row.id);
}

// Stops a scheduled or sending campaign email (what was sent stays sent); a draft is simply cancelled.
export async function cancelMailing(client, context, mailingId) {
  requireManage(context);
  const row = await lockDraft(client, context, mailingId);
  if (["sent", "cancelled"].includes(row.status)) throw new CrmError(409, "This campaign email is already finished.", "CRM_MAILING_FINISHED");
  await client.query("UPDATE tenant.crm_mailings SET status = 'cancelled', finished_at = now(), updated_by = $3, updated_at = now() WHERE organization_id = $1 AND id = $2",
    [context.organizationId, row.id, context.userId ?? null]);
  await client.query("UPDATE tenant.crm_mailing_recipients SET status = 'skipped', skip_reason = 'Cancelled before sending' WHERE organization_id = $1 AND mailing_id = $2 AND status = 'queued'",
    [context.organizationId, row.id]);
  return getMailing(client, context, row.id);
}

// ------------------------------------------------------------------ sending (worker)

const appUrl = (env) => String(env.APP_URL ?? "").replace(/\/+$/, "");
const fill = (template, person) => String(template).replace(PLACEHOLDER, (_, key) => {
  const name = [person.first_name, person.last_name].filter(Boolean).join(" ");
  return { first_name: person.first_name ?? "", last_name: person.last_name ?? "", name, company: person.company ?? "" }[key] ?? "";
});

// The email as sent: plain text, and HTML with tracked links, an unsubscribe line and the open pixel.
export function renderMailingEmail(body, person, token, env = process.env) {
  const base = appUrl(env);
  const filled = fill(body, person);
  const unsubscribe = `${base}/api/crm/public/mail/u/${token}`;
  const html = escapeHtml(filled).replace(/https?:\/\/[^\s<>"]+/g, (url) => {
    const target = url.replace(/&amp;/g, "&");
    return `<a href="${base}/api/crm/public/mail/c/${token}?u=${encodeURIComponent(target)}">${url}</a>`;
  }).replace(/\n/g, "<br>");
  return {
    text: `${filled}\n\n—\nTo stop these emails: ${unsubscribe}`,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;color:#0f172a;line-height:1.6">${html}`
      + `<p style="margin-top:24px;font-size:12px;color:#64748b">You received this because you agreed to hear from us. <a href="${unsubscribe}">Unsubscribe</a></p>`
      + `<img src="${base}/api/crm/public/mail/o/${token}" width="1" height="1" alt="" style="display:none"></body></html>`,
    unsubscribe,
  };
}

// The worker's tick for one organization: due campaign emails start, and up to `batch` of their recipients are emailed.
// options: { batch, env, tokenFor } — tokenFor(recipient) gives the token sent (the default rotates it; tests can read it back).
export async function runMailings(client, organizationId, { batch = BATCH, env = process.env } = {}) {
  await client.query(`UPDATE tenant.crm_mailings SET status = 'sending', started_at = now() WHERE organization_id = $1 AND status = 'scheduled' AND scheduled_at <= now()`, [organizationId]);
  const result = { sent: 0, failed: 0, skipped: 0, finished: 0 };
  const due = (await client.query(
    `SELECT recipient.*, mailing.subject, mailing.body FROM tenant.crm_mailing_recipients recipient JOIN tenant.crm_mailings mailing ON mailing.id = recipient.mailing_id
      WHERE recipient.organization_id = $1 AND recipient.status = 'queued' AND mailing.status = 'sending' ORDER BY mailing.started_at, recipient.id LIMIT $2 FOR UPDATE OF recipient SKIP LOCKED`,
    [organizationId, batch])).rows;
  for (const recipient of due) {
    const optedOut = (await client.query(
      "SELECT 1 FROM tenant.crm_opt_outs WHERE organization_id = $1 AND kind = 'email' AND value = $2 AND channels && ARRAY['all', 'email']::text[]", [organizationId, recipient.email])).rows[0];
    if (optedOut) {
      await client.query("UPDATE tenant.crm_mailing_recipients SET status = 'skipped', skip_reason = 'On the opt-out list' WHERE id = $1", [recipient.id]);
      result.skipped += 1;
      continue;
    }
    const person = (await client.query(recipient.entity_type === "lead"
      ? "SELECT first_name, last_name, company_name AS company FROM tenant.crm_leads WHERE organization_id = $1 AND id = $2"
      : `SELECT person.first_name, person.last_name, party.display_name AS company FROM tenant.contacts person
           LEFT JOIN tenant.business_parties party ON party.organization_id = person.organization_id AND party.id = person.party_id WHERE person.organization_id = $1 AND person.id = $2`,
    [organizationId, recipient.entity_id])).rows[0] ?? {};
    // A fresh token for this email (only its hash is kept).
    const token = randomBytes(24).toString("hex");
    await client.query("UPDATE tenant.crm_mailing_recipients SET token_hash = $2 WHERE id = $1", [recipient.id, hash(token)]);
    const email = renderMailingEmail(recipient.body, person, token, env);
    try {
      const sent = await sendMail({ to: recipient.email, subject: fill(recipient.subject, person), text: email.text, html: email.html,
        headers: { "List-Unsubscribe": `<${email.unsubscribe}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } }, env);
      if (!sent.sent) {
        await client.query("UPDATE tenant.crm_mailing_recipients SET status = 'failed', error = 'Email is not set up for this workspace.' WHERE id = $1", [recipient.id]);
        result.failed += 1;
      } else {
        await client.query("UPDATE tenant.crm_mailing_recipients SET status = 'sent', sent_at = now(), message_id = $2 WHERE id = $1", [recipient.id, sent.messageId ?? null]);
        result.sent += 1;
      }
    } catch (error) {
      await client.query("UPDATE tenant.crm_mailing_recipients SET status = 'failed', error = $2 WHERE id = $1", [recipient.id, String(error?.message ?? error).slice(0, 300)]);
      result.failed += 1;
    }
  }
  const finished = await client.query(
    `UPDATE tenant.crm_mailings mailing SET status = 'sent', finished_at = now() WHERE mailing.organization_id = $1 AND mailing.status = 'sending'
        AND NOT EXISTS (SELECT 1 FROM tenant.crm_mailing_recipients r WHERE r.mailing_id = mailing.id AND r.status = 'queued')`, [organizationId]);
  result.finished = finished.rowCount;
  return result;
}

export async function hasDueMailings(client, organizationId) {
  return Boolean((await client.query("SELECT 1 FROM tenant.crm_mailings WHERE organization_id = $1 AND (status = 'sending' OR (status = 'scheduled' AND scheduled_at <= now())) LIMIT 1",
    [organizationId])).rows[0]);
}

// ------------------------------------------------------------------ public: unsubscribe, open, click

async function recipientOf(client, token) {
  if (!/^[0-9a-f]{48}$/.test(String(token ?? ""))) return null;
  const found = (await client.query("SELECT * FROM tenant.crm_resolve_mailing_token($1)", [hash(token)])).rows[0];
  if (!found) return null;
  await setTenantContext(client, found.organization_id);
  return (await client.query("SELECT * FROM tenant.crm_mailing_recipients WHERE organization_id = $1 AND id = $2", [found.organization_id, found.recipient_id])).rows[0] ?? null;
}

// One click: the address joins the opt-out list for email. Returns { done, email } (done false for an unknown link).
export async function unsubscribeFromMailing(client, token) {
  const recipient = await recipientOf(client, token);
  if (!recipient) return { done: false };
  await client.query(
    `INSERT INTO tenant.crm_opt_outs (organization_id, kind, value, channels, source, reason) VALUES ($1, 'email', $2, ARRAY['email']::text[], 'unsubscribe', 'Unsubscribed from a campaign email')
     ON CONFLICT (organization_id, kind, value) DO UPDATE SET channels = (SELECT array_agg(DISTINCT entry) FROM unnest(tenant.crm_opt_outs.channels || EXCLUDED.channels) AS entry)`,
    [recipient.organization_id, recipient.email]);
  await client.query("UPDATE tenant.crm_mailing_recipients SET unsubscribed_at = COALESCE(unsubscribed_at, now()) WHERE id = $1", [recipient.id]);
  return { done: true, email: recipient.email };
}

export async function recordMailingOpen(client, token) {
  const recipient = await recipientOf(client, token);
  if (recipient) await client.query("UPDATE tenant.crm_mailing_recipients SET opened_at = COALESCE(opened_at, now()) WHERE id = $1", [recipient.id]);
  return { done: Boolean(recipient) };
}

// Counts the click and returns where to go (http and https only; anything else goes nowhere).
export async function recordMailingClick(client, token, url) {
  let target = null;
  try {
    const parsed = new URL(String(url ?? ""));
    if (["http:", "https:"].includes(parsed.protocol)) target = parsed.toString();
  } catch {
    target = null;
  }
  const recipient = await recipientOf(client, token);
  if (recipient && target)
    await client.query("UPDATE tenant.crm_mailing_recipients SET clicked_at = COALESCE(clicked_at, now()), opened_at = COALESCE(opened_at, now()) WHERE id = $1", [recipient.id]);
  return { target };
}
