// Meeting invitations (CRM plan 4.5). A planned meeting — a meeting activity, or a follow-up by meeting — is sent to its attendees as an
// iCalendar invitation (REQUEST), from the workspace's address in the organizer's name. Moving the meeting and sending again updates
// the same invitation (one UID, a rising SEQUENCE); cancelling it sends a CANCEL. Attendees who refused email are never invited.
import { randomUUID } from "node:crypto";

import { escapeHtml, sendMail } from "../../../core/platform/mail/index.js";
import { CrmError } from "../data-management/errors.js";
import { recordVisible } from "../notes/access.js";

const EMAIL = /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/;
const text = (value) => String(value ?? "").trim();
const invalid = (field, message) => new CrmError(400, message, "CRM_MEETING_VALIDATION", { issues: [{ field, message }] });
const EDIT = Object.freeze({ lead: "crm.leads.edit", opportunity: "crm.opportunities.edit", party: "crm.accounts.edit", contact: "crm.contacts.edit" });

// iCalendar text: commas, semicolons and backslashes escaped, new lines as \n, lines folded at 75 octets.
const icsText = (value) => String(value ?? "").replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsTime = (at) => new Date(at).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function fold(line) {
  const parts = [];
  let rest = line;
  while (Buffer.byteLength(rest) > 75) {
    let cut = 75;
    while (Buffer.byteLength(rest.slice(0, cut)) > 75) cut -= 1;
    parts.push(rest.slice(0, cut));
    rest = ` ${rest.slice(cut)}`;
  }
  parts.push(rest);
  return parts.join("\r\n");
}

export function buildIcs({ method, uid, sequence, start, end, summary, description, location, organizer, attendees }) {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Vercentlabs//CRM//EN", `METHOD:${method}`, "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT", `UID:${uid}`, `SEQUENCE:${sequence}`, `DTSTAMP:${icsTime(new Date())}`, `DTSTART:${icsTime(start)}`, `DTEND:${icsTime(end)}`,
    `SUMMARY:${icsText(summary)}`, ...(description ? [`DESCRIPTION:${icsText(description)}`] : []), ...(location ? [`LOCATION:${icsText(location)}`] : []),
    `ORGANIZER;CN=${icsText(organizer.name ?? organizer.email)}:mailto:${organizer.email}`,
    ...attendees.map((attendee) => `ATTENDEE;CN=${icsText(attendee.name || attendee.email)};ROLE=REQ-PARTICIPANT;PARTSTAT=NEEDS-ACTION;RSVP=TRUE:mailto:${attendee.email}`),
    `STATUS:${method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT", "END:VCALENDAR",
  ];
  return `${lines.map(fold).join("\r\n")}\r\n`;
}

// The meeting: its time (start, else the due time), the record it is about, who organizes it.
async function loadMeeting(client, context, activityId) {
  const row = (await client.query(
    `SELECT activity.*, COALESCE(activity.start_at, activity.due_at) AS meeting_at, organizer.full_name AS organizer_name, organizer.email AS organizer_email,
            organization.name AS organization_name
       FROM tenant.crm_activities activity
       JOIN public.organizations organization ON organization.id = activity.organization_id
       LEFT JOIN users organizer ON organizer.id = COALESCE(activity.assigned_to, activity.created_by)
      WHERE activity.organization_id = $1 AND activity.id = $2`, [context.organizationId, activityId])).rows[0];
  if (!row) throw new CrmError(404, "Meeting not found.", "CRM_MEETING_NOT_FOUND");
  const isMeeting = row.activity_type === "meeting" || (row.activity_type === "follow_up" && (row.follow_up_type === "meeting" || row.follow_up_channel === "meeting"));
  if (!isMeeting) throw new CrmError(409, "Only a meeting can be sent as an invitation.", "CRM_MEETING_NOT_MEETING");
  if (row.entity_id && !(await recordVisible(client, context, row.entity_type, row.entity_id))) throw new CrmError(404, "Meeting not found.", "CRM_MEETING_NOT_FOUND");
  const mayEdit = row.assigned_to === context.userId || context.roleSlugs?.includes("organization_owner") || context.permissions?.includes(EDIT[row.entity_type] ?? "crm.activities.manage");
  if (!mayEdit) throw new CrmError(403, "You do not have permission to change this meeting.", "PERMISSION_DENIED");
  return row;
}

export async function getMeetingInvitation(client, context, activityId) {
  await loadMeeting(client, context, activityId);
  const row = (await client.query("SELECT * FROM tenant.crm_meeting_invitations WHERE organization_id = $1 AND activity_id = $2", [context.organizationId, activityId])).rows[0];
  return row ? { attendees: row.attendees, location: row.location, durationMinutes: row.duration_minutes, status: row.status, sequence: row.sequence, sentAt: row.sent_at } : null;
}

async function refusedEmail(client, organizationId, addresses) {
  const { rows } = await client.query(
    `SELECT lower(email) AS email FROM tenant.contacts WHERE organization_id = $1 AND do_not_email AND lower(email) = ANY($2::text[])
     UNION SELECT lower(email) FROM tenant.crm_leads WHERE organization_id = $1 AND do_not_contact AND lower(email) = ANY($2::text[])
     UNION SELECT value FROM tenant.crm_opt_outs WHERE organization_id = $1 AND kind = 'email' AND value = ANY($2::text[]) AND channels && ARRAY['email', 'all']`,
    [organizationId, addresses]);
  return rows.map((row) => row.email);
}

// input: { attendees: [{ email, name? }], location?, durationMinutes?, message? } — sends (or updates) the invitation.
export async function sendMeetingInvitation(client, context, activityId, input = {}, env = process.env) {
  const meeting = await loadMeeting(client, context, activityId);
  if (["completed", "cancelled"].includes(meeting.status)) throw new CrmError(409, "This meeting is already done or cancelled.", "CRM_MEETING_CLOSED");
  if (!meeting.meeting_at) throw invalid("start", "Give the meeting a date and time first.");
  const attendees = (Array.isArray(input.attendees) ? input.attendees : []).map((entry) => ({ email: text(entry?.email).toLowerCase(), name: text(entry?.name).slice(0, 120) || null }))
    .filter((entry) => entry.email);
  if (!attendees.length) throw invalid("attendees", "Add who to invite.");
  if (attendees.length > 25) throw invalid("attendees", "Invite at most 25 people.");
  if (attendees.some((entry) => !EMAIL.test(entry.email))) throw invalid("attendees", "Check the email addresses.");
  const refused = await refusedEmail(client, context.organizationId, attendees.map((entry) => entry.email));
  if (refused.length) throw new CrmError(409, `${refused[0]} does not accept email, so cannot be invited.`, "CRM_DO_NOT_CONTACT", { channel: "email" });
  const duration = Number(input.durationMinutes ?? 30);
  if (!Number.isInteger(duration) || duration < 5 || duration > 1440) throw invalid("durationMinutes", "A meeting lasts 5 minutes to a day.");
  const existing = (await client.query("SELECT * FROM tenant.crm_meeting_invitations WHERE organization_id = $1 AND activity_id = $2", [context.organizationId, activityId])).rows[0];
  const uid = existing?.uid ?? `${randomUUID()}@crm.vercentlabs`;
  const sequence = existing ? existing.sequence + 1 : 0;
  const start = new Date(meeting.meeting_at);
  const end = meeting.end_at && new Date(meeting.end_at) > start ? new Date(meeting.end_at) : new Date(start.getTime() + duration * 60000);
  const location = text(input.location ?? existing?.location).slice(0, 500) || meeting.location || null;
  const organizer = { name: meeting.organizer_name, email: (/<([^>]+)>/.exec(env.AUTH_EMAIL_FROM ?? "")?.[1] ?? env.AUTH_EMAIL_FROM ?? meeting.organizer_email ?? "no-reply@crm.local").trim() };
  const description = [text(input.message), meeting.description].filter(Boolean).join("\n\n").slice(0, 4000);
  const ics = buildIcs({ method: "REQUEST", uid, sequence, start, end, summary: meeting.subject, description, location, organizer, attendees });
  const when = start.toLocaleString("en-IN", { dateStyle: "full", timeStyle: "short", timeZone: (await client.query("SELECT timezone FROM public.organizations WHERE id = $1", [context.organizationId])).rows[0]?.timezone ?? "Asia/Kolkata" });
  const body = `${existing ? "The meeting has changed." : "You are invited to a meeting."}\n\n${meeting.subject}\nWhen: ${when}${location ? `\nWhere: ${location}` : ""}${text(input.message) ? `\n\n${text(input.message)}` : ""}\n\n${meeting.organizer_name ?? ""}${meeting.organization_name ? `, ${meeting.organization_name}` : ""}`;
  const result = await sendMail({
    meter: { client, organizationId: context.organizationId },
    to: attendees.map((entry) => entry.email), subject: `${existing ? "Updated: " : "Invitation: "}${meeting.subject}`, text: body,
    html: `<!doctype html><html><body style="font-family:Arial,sans-serif;line-height:1.6">${escapeHtml(body).replace(/\n/g, "<br>")}</body></html>`,
    replyTo: meeting.organizer_email ?? undefined, fromName: meeting.organizer_name ?? undefined,
    attachments: [{ filename: "invite.ics", content: Buffer.from(ics, "utf8"), contentType: "text/calendar; method=REQUEST; charset=utf-8" }],
  }, env);
  if (!result.sent) throw new CrmError(409, "Email is not set up for this workspace, so invitations cannot be sent.", "CRM_EMAIL_UNAVAILABLE");
  await client.query(
    `INSERT INTO tenant.crm_meeting_invitations (organization_id, activity_id, uid, sequence, attendees, location, duration_minutes, organizer_user_id, status, sent_for, sent_at, updated_at)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8, 'sent', $9, now(), now())
     ON CONFLICT (organization_id, activity_id) DO UPDATE SET sequence = EXCLUDED.sequence, attendees = EXCLUDED.attendees, location = EXCLUDED.location,
       duration_minutes = EXCLUDED.duration_minutes, status = 'sent', sent_for = EXCLUDED.sent_for, sent_at = now(), updated_at = now()`,
    [context.organizationId, activityId, uid, sequence, JSON.stringify(attendees), location, duration, context.userId ?? null, start]);
  if (location && !meeting.location) await client.query("UPDATE tenant.crm_activities SET location = $3 WHERE organization_id = $1 AND id = $2", [context.organizationId, activityId, location]);
  return { uid, sequence, attendees: attendees.length, updated: Boolean(existing) };
}

// Cancels a sent invitation (the attendees' calendars drop it).
export async function cancelMeetingInvitation(client, context, activityId, { message = null } = {}, env = process.env) {
  const meeting = await loadMeeting(client, context, activityId);
  const existing = (await client.query("SELECT * FROM tenant.crm_meeting_invitations WHERE organization_id = $1 AND activity_id = $2", [context.organizationId, activityId])).rows[0];
  if (!existing || existing.status === "cancelled") throw new CrmError(409, "No invitation was sent for this meeting.", "CRM_MEETING_NOT_INVITED");
  const start = new Date(existing.sent_for ?? meeting.meeting_at);
  const end = new Date(start.getTime() + existing.duration_minutes * 60000);
  const organizer = { name: meeting.organizer_name, email: (/<([^>]+)>/.exec(env.AUTH_EMAIL_FROM ?? "")?.[1] ?? env.AUTH_EMAIL_FROM ?? "no-reply@crm.local").trim() };
  const ics = buildIcs({ method: "CANCEL", uid: existing.uid, sequence: existing.sequence + 1, start, end, summary: meeting.subject, description: text(message), location: existing.location, organizer, attendees: existing.attendees });
  const body = `The meeting "${meeting.subject}" is cancelled.${text(message) ? `\n\n${text(message)}` : ""}`;
  const result = await sendMail({
    meter: { client, organizationId: context.organizationId },
    to: existing.attendees.map((entry) => entry.email), subject: `Cancelled: ${meeting.subject}`, text: body, html: `<p>${escapeHtml(body).replace(/\n/g, "<br>")}</p>`,
    fromName: meeting.organizer_name ?? undefined, attachments: [{ filename: "cancel.ics", content: Buffer.from(ics, "utf8"), contentType: "text/calendar; method=CANCEL; charset=utf-8" }],
  }, env);
  if (!result.sent) throw new CrmError(409, "Email is not set up for this workspace.", "CRM_EMAIL_UNAVAILABLE");
  await client.query("UPDATE tenant.crm_meeting_invitations SET status = 'cancelled', sequence = sequence + 1, updated_at = now() WHERE organization_id = $1 AND activity_id = $2", [context.organizationId, activityId]);
  return { cancelled: true };
}
