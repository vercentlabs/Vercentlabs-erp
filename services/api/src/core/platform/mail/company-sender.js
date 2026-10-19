// How a company's email is sent (Shared Platform plan 4), Settings › Email:
//   platform  the platform's server, from its address with "Name via Company" (default)
//   domain    the platform's server, from the company's own address (accounts@company.in), DKIM-signed with a key made here; the
//             company publishes the DKIM record (and adds the platform to its SPF record) and verifies — until verified, mail goes
//             as "platform"
//   smtp      the company's own server (Google Workspace, Microsoft 365, Zoho, its host) with its own username and password;
//             verified by a test message
// Invoices, quotations and other business mail then come from the company's own domain. Security mail (sign-in, password) always
// goes from the platform.
import { generateKeyPairSync } from "node:crypto";
import { promises as dns } from "node:dns";
import nodemailer from "nodemailer";

import { requireSessionPermission } from "../../access/index.js";
import { audit } from "../../security/request-security.js";
import { decryptSecret, encryptSecret } from "../secrets/index.js";
import { getMailTransport } from "./transport.js";

export class MailSettingsError extends Error {
  constructor(status, message, code = "MAIL_SETTINGS_INVALID", details = undefined) {
    super(message);
    this.name = "MailSettingsError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const DOMAIN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/;
const invalid = (field, message) => new MailSettingsError(422, message, "MAIL_SETTINGS_INVALID", { field });
const spfInclude = (env) => String(env.MAIL_SPF_INCLUDE || "").trim() || null;

async function row(client, organizationId) {
  return (await client.query(`SELECT * FROM tenant.company_mail_settings WHERE organization_id = $1`, [organizationId])).rows[0] ?? null;
}

function view(settings, env) {
  const domain = settings?.domain ?? null;
  return {
    mode: settings?.mode ?? "platform",
    fromName: settings?.from_name ?? null,
    fromAddress: settings?.from_address ?? null,
    replyTo: settings?.reply_to ?? null,
    domain,
    domainVerifiedAt: settings?.domain_verified_at ?? null,
    dnsRecords: domain && settings?.dkim_public_key ? [
      { type: "TXT", host: `${settings.dkim_selector}._domainkey.${domain}`, value: `v=DKIM1; k=rsa; p=${settings.dkim_public_key}` },
      ...(spfInclude(env) ? [{ type: "TXT", host: domain, value: `v=spf1 include:${spfInclude(env)} ~all`, note: "Or add include:" + spfInclude(env) + " to your existing SPF record." }] : []),
    ] : [],
    smtp: settings?.smtp_host ? { host: settings.smtp_host, port: settings.smtp_port, secure: settings.smtp_secure, username: settings.smtp_username, verifiedAt: settings.smtp_verified_at } : null,
    lastError: settings?.last_error ?? null,
    active: settings?.mode === "domain" ? Boolean(settings.domain_verified_at) : settings?.mode === "smtp" ? Boolean(settings.smtp_verified_at) : true,
  };
}

export async function getMailSettings(client, organizationId, env = process.env) {
  return view(await row(client, organizationId), env);
}

async function upsert(client, session, columns) {
  const keys = Object.keys(columns);
  await client.query(
    `INSERT INTO tenant.company_mail_settings (organization_id, ${keys.join(", ")}, updated_by) VALUES ($1, ${keys.map((_, index) => `$${index + 2}`).join(", ")}, $${keys.length + 2})
     ON CONFLICT (organization_id) DO UPDATE SET ${keys.map((key) => `${key} = EXCLUDED.${key}`).join(", ")}, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [session.organizationId, ...keys.map((key) => columns[key]), session.userId]);
}

// The sender's name, the reply-to address and the mode. input: { mode, fromName, fromAddress, replyTo }
export async function saveMailSettings(client, session, input = {}, env = process.env) {
  requireSessionPermission(session, "organization.manage");
  const mode = input.mode ?? "platform";
  if (!["platform", "domain", "smtp"].includes(mode)) throw invalid("mode", "Choose how email is sent.");
  const fromName = String(input.fromName ?? "").trim().slice(0, 120) || null;
  const fromAddress = String(input.fromAddress ?? "").trim().toLowerCase() || null;
  const replyTo = String(input.replyTo ?? "").trim().toLowerCase() || null;
  if (fromAddress && !EMAIL.test(fromAddress)) throw invalid("fromAddress", "Enter a valid email address.");
  if (replyTo && !EMAIL.test(replyTo)) throw invalid("replyTo", "Enter a valid email address.");
  if (mode !== "platform" && !fromAddress) throw invalid("fromAddress", "Enter the address your email comes from.");
  const current = await row(client, session.organizationId);
  if (mode === "domain" && current?.domain && fromAddress && fromAddress.split("@")[1] !== current.domain) {
    throw invalid("fromAddress", `The address must be at ${current.domain}, the domain you set up.`);
  }
  await upsert(client, session, { mode, from_name: fromName, from_address: fromAddress, reply_to: replyTo });
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "mail.settings.changed", entityType: "company_mail_settings", entityId: session.organizationId, metadata: { mode } });
  return getMailSettings(client, session.organizationId, env);
}

// Sets up sending from the company's own domain: a fresh DKIM key (the private half encrypted), to publish in DNS.
export async function setupMailDomain(client, session, { domain } = {}, env = process.env) {
  requireSessionPermission(session, "organization.manage");
  const name = String(domain ?? "").trim().toLowerCase().replace(/^@/, "");
  if (!DOMAIN.test(name)) throw invalid("domain", "Enter the domain, like yourcompany.in.");
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, publicKeyEncoding: { type: "spki", format: "der" }, privateKeyEncoding: { type: "pkcs8", format: "pem" } });
  const selector = `vl${new Date().toISOString().slice(0, 7).replace("-", "")}`;
  await upsert(client, session, {
    mode: "domain", domain: name, dkim_selector: selector, dkim_public_key: publicKey.toString("base64"),
    encrypted_dkim_private_key: JSON.stringify(await encryptSecret(privateKey, env)), domain_verified_at: null, last_error: null,
  });
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "mail.domain.setup", entityType: "company_mail_settings", entityId: session.organizationId, metadata: { domain: name } });
  return getMailSettings(client, session.organizationId, env);
}

// Checks DNS: the DKIM record must carry this key (and, when the platform has an SPF include, the SPF record must name it).
export async function verifyMailDomain(client, session, env = process.env, resolveTxt = dns.resolveTxt) {
  requireSessionPermission(session, "organization.manage");
  const settings = await row(client, session.organizationId);
  if (!settings?.domain || !settings.dkim_public_key) throw new MailSettingsError(409, "Set up the domain first.", "MAIL_DOMAIN_NOT_SET_UP");
  const flat = async (host) => (await resolveTxt(host).catch(() => [])).map((parts) => parts.join("")).map((value) => value.replace(/\s+/g, ""));
  const dkim = await flat(`${settings.dkim_selector}._domainkey.${settings.domain}`);
  const problems = [];
  if (!dkim.some((value) => value.includes(`p=${settings.dkim_public_key}`))) problems.push(`The DKIM record at ${settings.dkim_selector}._domainkey.${settings.domain} was not found, or has another key.`);
  if (spfInclude(env)) {
    const spf = (await flat(settings.domain)).find((value) => value.startsWith("v=spf1"));
    if (!spf || !spf.includes(`include:${spfInclude(env)}`)) problems.push(`The SPF record of ${settings.domain} does not include ${spfInclude(env)}.`);
  }
  await client.query(`UPDATE tenant.company_mail_settings SET domain_verified_at = $2, last_error = $3, updated_at = now() WHERE organization_id = $1`,
    [session.organizationId, problems.length ? null : new Date(), problems.join(" ") || null]);
  if (!problems.length) await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "mail.domain.verified", entityType: "company_mail_settings", entityId: session.organizationId });
  return { verified: !problems.length, problems, settings: await getMailSettings(client, session.organizationId, env) };
}

// The company's own SMTP server; it is verified (and used) only after a test message reaches the person who set it up.
export async function saveCompanySmtp(client, session, input = {}, env = process.env, { createTransport = nodemailer.createTransport } = {}) {
  requireSessionPermission(session, "organization.manage");
  const host = String(input.host ?? "").trim().toLowerCase();
  const port = Number(input.port ?? 587);
  const secure = input.secure === true || port === 465;
  const username = String(input.username ?? "").trim();
  if (!/^[a-z0-9.-]+$/.test(host) || host.length > 253) throw invalid("host", "Enter the server name, like smtp.gmail.com.");
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw invalid("port", "Enter the port (587 or 465 usually).");
  if (!username) throw invalid("username", "Enter the username.");
  const current = await row(client, session.organizationId);
  const password = input.password ? String(input.password) : current?.encrypted_smtp_password ? await decryptSecret(current.encrypted_smtp_password, env) : null;
  if (!password) throw invalid("password", "Enter the password (or app password).");
  const settings = await getMailSettings(client, session.organizationId, env);
  const from = settings.fromAddress || username;
  const transport = createTransport({ host, port, secure, requireTLS: !secure, auth: { user: username, pass: password }, connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000, tls: { minVersion: "TLSv1.2" } });
  let verifiedAt = null;
  let error = null;
  try {
    const me = (await client.query(`SELECT email FROM users WHERE id = $1`, [session.userId])).rows[0]?.email;
    await transport.sendMail({ from, to: me ?? from, subject: "Vercentlabs ERP: your email server works", text: "This test message shows Vercentlabs ERP can send your company's email through your own server." });
    verifiedAt = new Date();
  } catch (failure) {
    error = `The server refused the test message: ${String(failure?.message ?? failure).slice(0, 300)}`;
  }
  await upsert(client, session, {
    mode: "smtp", smtp_host: host, smtp_port: port, smtp_secure: secure, smtp_username: username,
    encrypted_smtp_password: JSON.stringify(await encryptSecret(password, env)), smtp_verified_at: verifiedAt, last_error: error,
    ...(settings.fromAddress ? {} : { from_address: username.includes("@") ? username.toLowerCase() : null }),
  });
  await audit(client, { organizationId: session.organizationId, actorUserId: session.userId, eventType: "mail.smtp.saved", entityType: "company_mail_settings", entityId: session.organizationId, metadata: { host, verified: Boolean(verifiedAt) } });
  return { verified: Boolean(verifiedAt), error, settings: await getMailSettings(client, session.organizationId, env) };
}

const smtpCache = new Map();

// The transport a company's business mail goes through: its own server or domain when set up and verified, else the platform's.
// Returns { transporter, from, replyTo, via, dkim? } or null when no mail is configured at all.
export async function companyMailTransport(client, organizationId, env = process.env) {
  const settings = organizationId ? await row(client, organizationId).catch(() => null) : null;
  if (settings?.mode === "smtp" && settings.smtp_verified_at && settings.encrypted_smtp_password) {
    const key = `${organizationId}|${settings.smtp_host}|${settings.smtp_port}|${settings.smtp_username}|${settings.updated_at?.toISOString?.() ?? ""}`;
    let transporter = smtpCache.get(key);
    if (!transporter) {
      transporter = nodemailer.createTransport({
        host: settings.smtp_host, port: settings.smtp_port, secure: settings.smtp_secure, requireTLS: !settings.smtp_secure,
        auth: { user: settings.smtp_username, pass: await decryptSecret(settings.encrypted_smtp_password, env) },
        connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000, tls: { minVersion: "TLSv1.2" },
      });
      smtpCache.set(key, transporter);
    }
    return { transporter, from: settings.from_address, fromName: settings.from_name, replyTo: settings.reply_to, via: "company_smtp" };
  }
  const platform = getMailTransport(env);
  if (!platform) return null;
  if (settings?.mode === "domain" && settings.domain_verified_at && settings.encrypted_dkim_private_key && settings.from_address) {
    return {
      transporter: platform.transporter, from: settings.from_address, fromName: settings.from_name, replyTo: settings.reply_to, via: "company_domain",
      dkim: { domainName: settings.domain, keySelector: settings.dkim_selector, privateKey: await decryptSecret(settings.encrypted_dkim_private_key, env) },
    };
  }
  return { ...platform, replyTo: settings?.reply_to ?? platform.replyTo, fromName: settings?.from_name ?? null, via: "platform" };
}
