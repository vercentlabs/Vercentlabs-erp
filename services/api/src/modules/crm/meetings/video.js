// Video calls on meetings (CRM audit): a meeting can carry a Google Meet or Microsoft Teams link — made by the organizer's connected
// calendar (Setup › My calendar) when the meeting is put in it — a Zoom link, made by the company's Zoom app (a Server-to-Server OAuth
// app from the Zoom Marketplace, Setup › Zoom), or a link someone pastes. The link goes into the calendar event and the invitation.
import { decryptSecret, encryptSecret } from "../../../core/platform/secrets/index.js";
import { CrmError } from "../data-management/errors.js";
import { syncMeetingNow } from "./calendar.js";
import { loadMeeting } from "./invitations.js";

const MANAGE = "crm.settings.manage";
export const VIDEO_PROVIDERS = Object.freeze(["google_meet", "teams", "zoom", "link"]);
const text = (value) => String(value ?? "").trim();
const has = (input, field) => Object.prototype.hasOwnProperty.call(input ?? {}, field);
const invalid = (field, message) => new CrmError(400, message, "CRM_VIDEO_VALIDATION", { issues: [{ field, message }] });
const OPEN = "status IN ('planned', 'in_progress', 'overdue')";

// ------------------------------------------------------------------ the company's Zoom app

async function zoomCredentials(client, organizationId, env) {
  const row = (await client.query("SELECT zoom_credentials FROM tenant.crm_settings WHERE organization_id = $1", [organizationId])).rows[0];
  return row?.zoom_credentials ? await decryptSecret(row.zoom_credentials, env) : null;
}

export async function getZoomSettings(client, context, { env = process.env } = {}) {
  const credentials = await zoomCredentials(client, context.organizationId, env);
  return { connected: Boolean(credentials?.accountId && credentials?.clientId && credentials?.clientSecret), accountId: credentials?.accountId ?? null, clientId: credentials?.clientId ?? null };
}

// input: { accountId, clientId, clientSecret? } (the secret is kept when left out), or { disconnect: true }.
export async function saveZoomSettings(client, context, input = {}, { env = process.env } = {}) {
  if (!(context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(MANAGE))) throw new CrmError(403, "You do not have permission to set up Zoom.", "PERMISSION_DENIED");
  let stored = null;
  if (input.disconnect !== true) {
    const kept = (await zoomCredentials(client, context.organizationId, env)) ?? {};
    const accountId = has(input, "accountId") ? text(input.accountId) : kept.accountId;
    const clientId = has(input, "clientId") ? text(input.clientId) : kept.clientId;
    const clientSecret = text(input.clientSecret) || kept.clientSecret;
    if (!accountId || !/^[A-Za-z0-9_-]{6,64}$/.test(accountId)) throw invalid("accountId", "Enter the Account ID from your Zoom app.");
    if (!clientId || !/^[A-Za-z0-9_-]{6,64}$/.test(clientId)) throw invalid("clientId", "Enter the Client ID from your Zoom app.");
    if (!clientSecret) throw invalid("clientSecret", "Enter the Client secret from your Zoom app.");
    stored = JSON.stringify(await encryptSecret({ accountId, clientId, clientSecret: clientSecret.slice(0, 200) }, env));
  }
  await client.query(
    `INSERT INTO tenant.crm_settings (organization_id, zoom_credentials, created_by, updated_by) VALUES ($1, $2::jsonb, $3, $3)
     ON CONFLICT (organization_id) DO UPDATE SET zoom_credentials = EXCLUDED.zoom_credentials, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [context.organizationId, stored, context.userId ?? null]);
  return getZoomSettings(client, context, { env });
}

async function zoomToken(fetchImpl, credentials) {
  const response = await fetchImpl(`https://zoom.us/oauth/token?grant_type=account_credentials&account_id=${encodeURIComponent(credentials.accountId)}`, {
    method: "POST", headers: { authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString("base64")}` },
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new CrmError(502, `Zoom refused access: ${body.reason ?? body.error ?? response.status}.`, "CRM_ZOOM_TOKEN");
  return body.access_token;
}

// Makes the Zoom links meetings asked for (all due ones, or one). Returns { made, failed }; a refusal leaves the meeting waiting.
export async function makeZoomLinks(client, organizationId, { fetchImpl = fetch, env = process.env, activityId = null } = {}) {
  const result = { made: 0, failed: 0 };
  const { rows } = await client.query(
    `SELECT activity.id, activity.subject, COALESCE(activity.start_at, activity.due_at) AS starts_at,
            GREATEST(5, LEAST(1440, COALESCE(EXTRACT(EPOCH FROM activity.end_at - COALESCE(activity.start_at, activity.due_at)) / 60, invitation.duration_minutes, 30)))::int AS minutes
       FROM tenant.crm_activities activity
       LEFT JOIN tenant.crm_meeting_invitations invitation ON invitation.organization_id = activity.organization_id AND invitation.activity_id = activity.id
      WHERE activity.organization_id = $1 AND activity.video_provider = 'zoom' AND activity.video_link IS NULL AND activity.${OPEN}
        AND COALESCE(activity.start_at, activity.due_at) > now() - interval '1 hour' AND ($2::uuid IS NULL OR activity.id = $2)
      ORDER BY 3 LIMIT 20`, [organizationId, activityId]);
  if (!rows.length) return result;
  const credentials = await zoomCredentials(client, organizationId, env);
  if (!credentials?.clientSecret) return result;
  const token = await zoomToken(fetchImpl, credentials);
  for (const meeting of rows) {
    try {
      const response = await fetchImpl("https://api.zoom.us/v2/users/me/meetings", {
        method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: JSON.stringify({ topic: String(meeting.subject ?? "Meeting").slice(0, 200), type: 2, start_time: new Date(meeting.starts_at).toISOString().replace(/\.\d{3}Z$/, "Z"),
          duration: meeting.minutes, timezone: "UTC", settings: { join_before_host: true, waiting_room: false } }),
      });
      const created = await response.json().catch(() => ({}));
      if (!response.ok || !created.join_url) throw new Error(created.message ?? String(response.status));
      await client.query("UPDATE tenant.crm_activities SET video_link = $3 WHERE organization_id = $1 AND id = $2", [organizationId, meeting.id, String(created.join_url).slice(0, 1000)]);
      result.made += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
}

// ------------------------------------------------------------------ a meeting's video call

async function calendarConnected(client, organizationId, userId, provider) {
  return Boolean(userId && (await client.query("SELECT 1 FROM tenant.crm_calendar_connections WHERE organization_id = $1 AND user_id = $2 AND provider = $3 AND status IN ('active', 'error')",
    [organizationId, userId, provider])).rows[0]);
}

// The meeting's call, and which kinds can be made for it.
export async function getMeetingVideo(client, context, activityId, { env = process.env } = {}) {
  const meeting = await loadMeeting(client, context, activityId);
  return {
    provider: meeting.video_provider ?? null, link: meeting.video_link ?? null,
    available: {
      google_meet: await calendarConnected(client, context.organizationId, meeting.assigned_to, "google"),
      teams: await calendarConnected(client, context.organizationId, meeting.assigned_to, "microsoft"),
      zoom: (await getZoomSettings(client, context, { env })).connected, link: true,
    },
  };
}

// input: { provider: google_meet | teams | zoom | link | null, link? (for "link") }. The link is made at once where it can be; otherwise
// the calendar job makes it shortly (pending).
export async function setMeetingVideo(client, context, activityId, input = {}, { fetchImpl = fetch, env = process.env } = {}) {
  const meeting = await loadMeeting(client, context, activityId);
  if (["completed", "cancelled"].includes(meeting.status)) throw new CrmError(409, "This meeting is already done or cancelled.", "CRM_MEETING_CLOSED");
  const provider = input.provider ? text(input.provider) : null;
  if (provider && !VIDEO_PROVIDERS.includes(provider)) throw invalid("provider", "Choose Google Meet, Microsoft Teams, Zoom or a link.");
  let link = null;
  if (provider === "link") {
    link = text(input.link);
    let url = null;
    try { url = new URL(link); } catch { url = null; }
    if (!url || url.protocol !== "https:") throw invalid("link", "Paste the meeting link (https://…).");
    link = url.toString().slice(0, 1000);
  }
  const { available } = await getMeetingVideo(client, context, activityId, { env });
  if (provider === "google_meet" && !available.google_meet) throw new CrmError(409, "Connect Google Calendar first (Setup › My calendar): it makes the Meet link.", "CRM_VIDEO_UNAVAILABLE");
  if (provider === "teams" && !available.teams) throw new CrmError(409, "Connect Outlook first (Setup › My calendar): it makes the Teams link.", "CRM_VIDEO_UNAVAILABLE");
  if (provider === "zoom" && !available.zoom) throw new CrmError(409, "Zoom is not connected for the company yet (Setup › Zoom).", "CRM_VIDEO_UNAVAILABLE");
  const same = provider === (meeting.video_provider ?? null) && provider !== "link";
  if (!same)
    await client.query("UPDATE tenant.crm_activities SET video_provider = $3, video_link = $4, updated_at = now() WHERE organization_id = $1 AND id = $2",
      [context.organizationId, activityId, provider, link]);
  if (provider === "zoom" || provider === "google_meet" || provider === "teams") {
    try {
      if (provider === "zoom") await makeZoomLinks(client, context.organizationId, { fetchImpl, env, activityId });
      else await syncMeetingNow(client, context.organizationId, activityId, { fetchImpl, env });
    } catch {
      // The calendar job tries again shortly.
    }
  }
  const after = (await client.query("SELECT video_provider, video_link FROM tenant.crm_activities WHERE organization_id = $1 AND id = $2", [context.organizationId, activityId])).rows[0];
  return { provider: after.video_provider ?? null, link: after.video_link ?? null, pending: Boolean(after.video_provider && !after.video_link) };
}
