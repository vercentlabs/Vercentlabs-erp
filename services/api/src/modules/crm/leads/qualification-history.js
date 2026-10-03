// The qualification history: one append-only row per answer changed and per
// decision, so "how did this lead come to be qualified?" can always be
// answered. The application role can only INSERT and SELECT this table.
import { requireUuid } from "./validation.js";

const EVENT_LABELS = Object.freeze({
  started: "Qualification started",
  updated: "Qualification updated",
  rating_changed: "Rating changed",
  qualified: "Lead qualified",
  qualified_override: "Lead qualified with an override",
  disqualified: "Lead disqualified",
  reopened: "Lead reopened",
  converted: "Lead converted",
});

const clip = (value, length) => (value === null || value === undefined || value === "" ? null : String(value).slice(0, length));

// event: { type, field?, oldValue?, newValue?, notes? }
export async function recordLeadQualificationEvent(client, context, leadId, event) {
  await client.query(
    `INSERT INTO tenant.crm_lead_qualification_history (organization_id, lead_id, event_type, field, old_value, new_value, notes, changed_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [context.organizationId, leadId, event.type, clip(event.field, 120), clip(event.oldValue, 500), clip(event.newValue, 500), clip(event.notes, 2000), context.userId ?? null],
  );
}

// Callers load the lead first (getLead), which is what enforces visibility.
export async function listLeadQualificationEvents(client, context, leadId, limit = 200) {
  const { rows } = await client.query(
    `SELECT history.*, actor.full_name AS changed_by_name
       FROM tenant.crm_lead_qualification_history history
       LEFT JOIN public.users actor ON actor.id = history.changed_by
      WHERE history.organization_id = $1 AND history.lead_id = $2
      ORDER BY history.changed_at DESC, history.id DESC
      LIMIT $3`,
    [context.organizationId, requireUuid(leadId, "Lead"), limit],
  );
  return rows.map((row) => ({
    id: row.id,
    eventType: row.event_type,
    // One readable line: "Budget: Unknown → Confirmed", "Lead qualified", …
    summary: row.event_type === "updated" || row.event_type === "rating_changed"
      ? `${row.field ?? "Rating"}: ${row.old_value ?? "Not set"} → ${row.new_value ?? "Not set"}`
      : [EVENT_LABELS[row.event_type] ?? row.event_type, row.new_value].filter(Boolean).join(" — "),
    field: row.field,
    oldValue: row.old_value,
    newValue: row.new_value,
    notes: row.notes,
    changedAt: row.changed_at,
    changedByName: row.changed_by_name ?? null,
  }));
}
