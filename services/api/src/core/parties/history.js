// A business party's timeline and audit trail (Foundation: CRM companies and Sales customers are the same party): one append-only row
// per significant event, with old and new values for field changes. Moved from crm/accounts (CRM plan 5.9).
import { PartyError } from "./errors.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function requireUuid(value, label) {
  if (!UUID.test(String(value ?? ""))) throw new PartyError(400, `${label} is not valid.`, "CRM_ACCOUNT_VALIDATION");
  return String(value);
}

export async function recordAccountHistory(client, context, partyId, eventType, summary, changes = {}) {
  await client.query(
    // clock_timestamp, not now(): several events recorded in one transaction
    // (create, assign, add address) must keep the order they happened in.
    `INSERT INTO tenant.crm_account_history (organization_id, party_id, event_type, summary, changes, actor_user_id, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
    [context.organizationId, partyId, eventType, String(summary).slice(0, 500), JSON.stringify(changes), context.userId ?? null],
  );
}

// Callers load the account first (getAccount), which enforces visibility.
export async function listAccountHistory(client, context, partyId, { limit = 200 } = {}) {
  const { rows } = await client.query(
    `SELECT history.id, history.event_type, history.summary, history.changes, history.created_at, actor.full_name AS actor_name
       FROM tenant.crm_account_history history
       LEFT JOIN public.users actor ON actor.id = history.actor_user_id
      WHERE history.organization_id = $1 AND history.party_id = $2
      ORDER BY history.created_at DESC, history.id DESC
      LIMIT $3`,
    [context.organizationId, requireUuid(partyId, "Account"), Math.min(Math.max(Number(limit) || 200, 1), 500)],
  );
  return rows.map((row) => ({
    id: row.id, eventType: row.event_type, summary: row.summary, changes: row.changes, createdAt: row.created_at, actorName: row.actor_name,
  }));
}
