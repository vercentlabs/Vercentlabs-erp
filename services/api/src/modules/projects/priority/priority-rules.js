// Projects — Priority: one four-level model shared by Projects, Milestones and Tasks (the value is stored on each record; this is its one
// definition, validation, wording, ordering and change rules). Priority says how important work is. It never changes a due date, an
// assignee, a status, a dependency, a hold or an approval: a change is recorded (who, when, from, to, why) and the right people are told.
// A change to or from Urgent says why. A parent's priority never flows into its children.
import { createNotification } from "../../../core/platform/notifications/index.js";
import { projectError, text } from "../project-core.js";

export const PRIORITY_LEVELS = Object.freeze([
  Object.freeze({ code: "URGENT", label: "Urgent", rank: 4, description: "Needs immediate attention" }),
  Object.freeze({ code: "HIGH", label: "High", rank: 3, description: "Important work" }),
  Object.freeze({ code: "NORMAL", label: "Normal", rank: 2, description: "Standard work" }),
  Object.freeze({ code: "LOW", label: "Low", rank: 1, description: "Flexible work" }),
]);
export const PRIORITY_DEFAULT = "NORMAL";
export const PRIORITY_RANK = Object.freeze(Object.fromEntries(PRIORITY_LEVELS.map((level) => [level.code, level.rank])));
export const PRIORITY_LABEL = Object.freeze(Object.fromEntries(PRIORITY_LEVELS.map((level) => [level.code, level.label])));
// Highest first, for ORDER BY (an unknown value sorts last).
export const prioritySortSql = (column) => `array_position(ARRAY['URGENT','HIGH','NORMAL','LOW']::text[], ${column})`;

// One of the four levels; nothing given = the fallback (a new record's is Normal).
export function validatePriority(value, fallback = PRIORITY_DEFAULT) {
  if (value === undefined || value === null || value === "") return fallback;
  const code = String(value).trim().toUpperCase();
  if (!PRIORITY_RANK[code]) throw projectError(400, "PRIORITY_INVALID", undefined, { field: "priority" });
  return code;
}

// The change a request makes, or null when it keeps the priority. Raising to Urgent, or lowering from it, says why.
export function priorityChangeOf(current, requested, reason) {
  const to = validatePriority(requested, current);
  if (to === current) return null;
  const why = text(reason, 1000) || null;
  if ((to === "URGENT" || current === "URGENT") && (!why || why.length < 3)) throw projectError(400, "PRIORITY_REASON_REQUIRED", undefined, { field: "priorityReason" });
  return { from: current, to, reason: why, raised: PRIORITY_RANK[to] > PRIORITY_RANK[current] };
}

// Who hears about a change: escalation to Urgent tells the person doing the work and the manager; leaving Urgent (de-escalation) or a
// raise to High tells the person doing the work; anything else (Low ↔ Normal, High → Normal) is recorded without a notification.
export function priorityAudience(change, { worker, manager }) {
  if (change.to === "URGENT") return [worker, manager];
  if (change.from === "URGENT") return [worker];
  if (change.to === "HIGH" && change.raised) return [worker];
  return [];
}
export function priorityHeadline(code, change) {
  if (change.to === "URGENT") return `${code} is now Urgent`;
  if (change.from === "URGENT") return `${code} is no longer Urgent (now ${PRIORITY_LABEL[change.to]})`;
  return `${code} is now ${PRIORITY_LABEL[change.to]} priority`;
}
export const prioritySummary = (change) => `Priority ${PRIORITY_LABEL[change.from]} → ${PRIORITY_LABEL[change.to]}${change.reason ? `: ${change.reason}` : ""}`;

// Through the shared notification service, never to the actor, and once: the same headline about the same record to the same person
// within ten minutes (a double submit, a quick back-and-forth) is not sent again.
export async function notifyPriorityChange(client, c, userIds, { category, title, message, href, entityType, entityId }) {
  const people = new Set(userIds.filter(Boolean));
  people.delete(c.userId);
  for (const userId of people) {
    const recent = (await client.query(`SELECT 1 FROM notifications WHERE organization_id = $1 AND user_id = $2 AND entity_id = $3 AND title = $4
        AND created_at > now() - interval '10 minutes' LIMIT 1`, [c.organizationId, userId, String(entityId), title])).rows[0];
    if (!recent) await createNotification(client, { organizationId: c.organizationId, userId, category, title, message, href, entityType, entityId });
  }
}
