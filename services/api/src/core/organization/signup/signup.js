// New workspace signup (MVP 44): 4 details → a 6-digit code from the email → (what the business does, only when the website told us
// nothing) → the suggested apps → the workspace, in about a minute, with no password, no industry list and no tax details.
//
// A signup is kept in public.signup_requests, found by the opaque token in the browser's signup cookie (only its hash is stored). The
// website is read in the background while the person checks their email; Screen 4 shows what was understood and the apps suggested.
// Creating the workspace is one transaction (registerOrganization, then the apps not picked are switched off, what we understood is
// saved): either the whole workspace exists or nothing does. An email that already has a workspace never gets a second one: after its
// code, the person is signed in to the workspace they have.
import { createOpaqueToken, tokenHash } from "../../auth/session.js";
import { checkEmailCode, codeError, issueEmailCode, pruneEmailCodes } from "../../auth/email-code.js";
import { audit } from "../../security/request-security.js";
import { registerOrganization } from "../registration.js";
import { SIGNUP_APPS, suggestApps } from "./app-suggester.js";
import { normalizeWebsite, readWebsite } from "./website-reader.js";

export class SignupError extends Error {
  constructor(status, message, code = "SIGNUP_ERROR", details) {
    super(message);
    this.name = "SignupError";
    this.status = status;
    this.code = code;
    if (details) this.details = details;
  }
}
export const READING_DEADLINE_MS = 8000;
const MAX_SUGGESTION_RUNS = 5;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const invalid = (field, message) => new SignupError(422, message, "SIGNUP_INVALID", { field });

async function signupOf(client, token, { lock = false } = {}) {
  if (!token) throw new SignupError(401, "Start again: the signup was not found.", "SIGNUP_NOT_FOUND");
  const row = (await client.query(`SELECT * FROM public.signup_requests WHERE token_hash = $1${lock ? " FOR UPDATE" : ""}`, [tokenHash(String(token))])).rows[0];
  if (!row || (row.status !== "completed" && new Date(row.expires_at).getTime() < Date.now())) throw new SignupError(401, "Start again: the signup has expired.", "SIGNUP_NOT_FOUND");
  return row;
}
const firstName = (name) => String(name ?? "").trim().split(/\s+/)[0] || null;

// Screen 1. input: fullName, email, companyName, website (optional), timezone (the browser's). Returns { token, email, website }.
export async function startSignup(client, input = {}, { ipAddress = null, env = process.env } = {}) {
  const fullName = String(input.fullName ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if ((fullName.match(/\p{L}/gu) ?? []).length < 2) throw invalid("fullName", "Enter your name.");
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!EMAIL.test(email) || email.length > 320) throw invalid("email", "Enter a valid email, like ravi@sharmatextiles.in");
  const companyName = String(input.companyName ?? "").trim().replace(/\s+/g, " ").slice(0, 200);
  if (companyName.length < 2) throw invalid("companyName", "Enter your company name.");
  let website = null;
  if (String(input.website ?? "").trim()) {
    website = normalizeWebsite(input.website);
    if (!website) throw invalid("website", "Enter a web address, like sharmatextiles.in, or leave it empty.");
  }
  const timezone = /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(String(input.timezone ?? "")) ? String(input.timezone) : "Asia/Kolkata";
  await pruneEmailCodes(client);
  const existing = (await client.query(`SELECT id FROM public.users WHERE lower(email) = $1`, [email])).rows[0];
  const token = createOpaqueToken();
  const row = (await client.query(`INSERT INTO public.signup_requests (token_hash, email, full_name, company_name, website, timezone, reading_status, existing_user_id, ip_address)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [tokenHash(token), email, fullName, companyName, website, timezone, website && !existing ? "reading" : "none", existing?.id ?? null, ipAddress])).rows[0];
  await issueEmailCode(client, { email, purpose: "signup", signupId: row.id, firstName: firstName(fullName) }, env);
  return { token, signupId: row.id, email, website: existing ? null : website };
}

export async function resendSignupCode(client, token, env = process.env) {
  const row = await signupOf(client, token);
  if (row.status !== "code_sent") throw new SignupError(409, "This email is already confirmed.", "SIGNUP_STATE");
  return issueEmailCode(client, { email: row.email, purpose: "signup", signupId: row.id, firstName: firstName(row.full_name) }, env);
}

// Screen 2. Never throws for a wrong code: returns { ok: false, reason } so the caller commits the counted try first; an expired code is
// replaced by a new one. On success: { ok: true, existingUserId } (sign that person in) or { ok: true } (carry on to the apps).
export async function verifySignupCode(client, token, code, env = process.env) {
  const row = await signupOf(client, token, { lock: true });
  if (row.status !== "code_sent") return { ok: true, existingUserId: row.existing_user_id, already: true };
  const result = await checkEmailCode(client, { email: row.email, purpose: "signup", code });
  if (!result.ok) {
    if (result.reason === "expired") await issueEmailCode(client, { email: row.email, purpose: "signup", signupId: row.id, firstName: firstName(row.full_name) }, env).catch(() => undefined);
    return { ok: false, reason: result.reason };
  }
  const existing = (await client.query(`SELECT id FROM public.users WHERE lower(email) = $1`, [row.email])).rows[0];
  await client.query(`UPDATE public.signup_requests SET status = 'verified', verified_at = now(), existing_user_id = $2 WHERE id = $1`, [row.id, existing?.id ?? null]);
  if (existing) await client.query(`UPDATE public.users SET email_verified_at = COALESCE(email_verified_at, now()) WHERE id = $1`, [existing.id]);
  return { ok: true, existingUserId: existing?.id ?? null };
}

// Runs outside the request that started the signup (the route does not wait for it): reads the website and suggests apps within the
// 8-second budget, then records the outcome. `transaction(fn)` runs fn in its own short transaction.
export async function readSignupWebsite(transaction, signupId, { env = process.env, allowPrivate = false } = {}) {
  const row = await transaction(async (client) => (await client.query(`SELECT id, website, company_name, reading_status FROM public.signup_requests WHERE id = $1`, [signupId])).rows[0]);
  if (!row?.website || row.reading_status !== "reading") return;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), READING_DEADLINE_MS);
  let status = "failed";
  let text = null;
  let profile = null;
  try {
    const page = await readWebsite(row.website, { signal: controller.signal, allowPrivate });
    text = page.text;
    profile = await suggestApps({ companyName: row.company_name, text, source: "website" }, { env, signal: controller.signal });
    status = profile ? "done" : "unclear";
  } catch (error) {
    void error;
    status = "failed";
  } finally {
    clearTimeout(timer);
  }
  await transaction((client) => client.query(`UPDATE public.signup_requests SET reading_status = $2, website_text = $3, profile = $4::jsonb, suggestion_runs = suggestion_runs + $5
      WHERE id = $1 AND reading_status = 'reading'`, [signupId, status, text, profile ? JSON.stringify({ ...profile, at: new Date().toISOString() }) : null, text ? 1 : 0]));
}

const appCards = (profile) => {
  const suggested = (profile?.apps ?? []).map((entry) => ({ key: entry.app, name: SIGNUP_APPS[entry.app].name, reason: entry.reason, suggested: true }));
  const others = Object.entries(SIGNUP_APPS).filter(([key]) => !suggested.some((entry) => entry.key === key)).map(([key, app]) => ({ key, name: app.name, reason: app.line, suggested: false }));
  return { suggested, others };
};
// What the screens after the code show. `next`: "code" (not confirmed), "wait" (still reading the website), "describe" (Screen 3) or
// "apps" (Screen 4).
export async function getSignupState(client, token) {
  const row = await signupOf(client, token);
  const waited = row.verified_at ? Date.now() - new Date(row.verified_at).getTime() : 0;
  const reading = row.reading_status === "reading" && Date.now() - new Date(row.created_at).getTime() < READING_DEADLINE_MS + 4000 && waited < READING_DEADLINE_MS;
  const next = row.status === "code_sent" ? "code" : row.status === "completed" ? "done" : reading ? "wait" : row.profile ? "apps" : "describe";
  return {
    next, email: row.email, fullName: row.full_name, companyName: row.company_name, website: row.website,
    websiteFailed: Boolean(row.website) && ["failed", "reading"].includes(row.reading_status) && !row.profile,
    profile: row.profile ? { description: row.profile.description, confidence: row.profile.confidence, sells: row.profile.sells, channels: row.profile.channels } : null,
    apps: appCards(row.profile), suggestionsLeft: Math.max(0, MAX_SUGGESTION_RUNS - row.suggestion_runs),
  };
}

// Screen 3 (and Edit on Screen 4): the person's own line. Suggests again from it — at most 5 suggestion runs per signup.
export async function describeSignupBusiness(client, token, text, { env = process.env } = {}) {
  const row = await signupOf(client, token, { lock: true });
  if (row.status !== "verified") throw new SignupError(409, row.status === "completed" ? "This workspace is already set up." : "Enter the code from your email first.", "SIGNUP_STATE");
  const line = String(text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
  if (line.length < 3) throw invalid("description", "In one line, tell us what you sell or what service you give.");
  if (row.suggestion_runs >= MAX_SUGGESTION_RUNS) throw new SignupError(429, "You've changed this too many times. Pick the apps yourself below.", "SIGNUP_SUGGESTION_LIMIT");
  // Edit reuses the website text already read (it is never read twice).
  const profile = await suggestApps({ companyName: row.company_name, text: row.website_text ? `${line}\n\nFrom the website:\n${row.website_text}` : line, source: row.website_text ? "website+description" : "description" }, { env });
  const saved = profile ?? { description: line, apps: [], confidence: "low", sells: null, channels: null, source: "description", model: null };
  await client.query(`UPDATE public.signup_requests SET description_input = $2, profile = $3::jsonb, reading_status = CASE WHEN reading_status = 'reading' THEN 'failed' ELSE reading_status END,
      suggestion_runs = suggestion_runs + 1 WHERE id = $1`, [row.id, line, JSON.stringify({ ...saved, description: profile?.description ?? line, at: new Date().toISOString() })]);
  return getSignupState(client, token);
}

// Screen 5: creates the workspace. input: apps (module keys, in order; the first is the one they land in). Returns
// { userId, organizationId, firstApp }. One transaction: either everything exists or nothing does.
export async function completeSignup(client, token, input = {}, { request = null, env = process.env } = {}) {
  const row = await signupOf(client, token, { lock: true });
  if (row.status === "code_sent") throw new SignupError(409, "Enter the code from your email first.", "SIGNUP_STATE");
  if (row.status === "completed") throw new SignupError(409, "This workspace is already set up.", "SIGNUP_STATE");
  if (row.existing_user_id) throw new SignupError(409, "Welcome back, you already have a workspace.", "SIGNUP_EXISTING_WORKSPACE");
  const apps = [...new Set((Array.isArray(input.apps) ? input.apps : []).map(String))].filter((key) => SIGNUP_APPS[key]);
  if (!apps.length) throw invalid("apps", "Pick at least one app.");
  const registered = await registerOrganization(client, {
    fullName: row.full_name, email: row.email, organizationName: row.company_name, countryCode: "IN", baseCurrency: "INR", timezone: row.timezone || "Asia/Kolkata", emailVerified: true,
  });
  const { organizationId, userId } = registered;
  // Every app starts switched on (the ensure_organization_modules trigger); the ones not picked are switched off, as Settings › Modules does.
  const off = (await client.query(`UPDATE public.organization_modules SET status = 'disabled', updated_at = now() WHERE organization_id = $1 AND NOT (module_key = ANY($2::text[])) AND status = 'enabled'
      RETURNING module_key`, [organizationId, apps])).rows.map((r) => r.module_key);
  for (const moduleKey of off) {
    await audit(client, { organizationId, actorUserId: userId, eventType: "module.disabled", entityType: "organization_module", entityId: null, metadata: { moduleKey, source: "signup" },
      beforeData: { moduleKey, enabled: true }, afterData: { moduleKey, enabled: false }, request, env });
  }
  // The Free plan's one app (once the trial ends) is pre-filled with the first app.
  await client.query(`UPDATE public.organization_subscriptions SET selected_modules = $2::jsonb WHERE organization_id = $1 AND selected_modules IS NULL`, [organizationId, JSON.stringify([apps[0]])]);
  const profile = row.profile ?? {};
  await client.query(`UPDATE public.organizations SET business_profile = $2::jsonb, website = COALESCE(website, $3), updated_at = now() WHERE id = $1`, [organizationId, JSON.stringify({
    description: profile.description ?? row.description_input ?? null, sells: profile.sells ?? null, channels: profile.channels ?? null, confidence: profile.confidence ?? null,
    suggested: (profile.apps ?? []).map((entry) => entry.app), chosen: apps, firstApp: apps[0], source: profile.source ?? null, website: row.website, at: new Date().toISOString(),
  }), row.website]);
  // The full website text is not kept after setup.
  await client.query(`UPDATE public.signup_requests SET status = 'completed', completed_at = now(), organization_id = $2, website_text = NULL WHERE id = $1`, [row.id, organizationId]);
  await audit(client, { organizationId, actorUserId: userId, eventType: "organization.registered", entityType: "organization", entityId: organizationId, metadata: { apps, source: "signup" }, request, env });
  return { userId, organizationId, firstApp: apps[0], apps };
}
