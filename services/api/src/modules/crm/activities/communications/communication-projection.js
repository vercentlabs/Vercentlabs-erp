// Write-time communication participant resolution (F018). The audience SQL
// and content projection that decide who may see a communication live in
// data-management/communication-access.js and are re-exported here for
// existing importers.
export {
  communicationVisibilitySql,
  projectCrmCommunication,
  projectCrmCommunications,
  resolveCallerParticipantCommunicationIds,
} from "../../data-management/communication-access.js";

// Write-time participant resolution — called by both outbound send
// (queueOutboundEmail) and inbound ingestion (ingestMailboxDelta) right
// after the crm_communications row is inserted. Resolves each address
// against public.users (internal — the ONLY thing that can ever satisfy
// the participant-visibility check) and tenant.contacts (external CRM
// Contact — participant metadata only, never application access) by exact
// email match. An address matching neither is still recorded (role +
// email_address always present) so the full participant list stays
// complete for display even when resolution fails.
export async function resolveCommunicationParticipants(client, context, communicationId, participants) {
  const rows = (participants || []).filter((entry) => entry?.email);
  if (!rows.length) return;
  const addresses = Array.from(new Set(rows.map((entry) => String(entry.email).toLowerCase())));
  // Sequential, not Promise.all — see opportunity-revenue-intelligence.js's
  // fix for why concurrent client.query() on one shared PoolClient is unsafe.
  const users = await client.query(`SELECT id, lower(email) AS email FROM public.users WHERE lower(email) = ANY($1::text[])`, [addresses]);
  const contacts = await client.query(`SELECT id, lower(email) AS email FROM tenant.contacts WHERE organization_id=$1 AND lower(email) = ANY($2::text[])`, [context.organizationId, addresses]);
  const userByEmail = new Map(users.rows.map((row) => [row.email, row.id]));
  const contactByEmail = new Map(contacts.rows.map((row) => [row.email, row.id]));
  for (const entry of rows) {
    const email = String(entry.email).toLowerCase();
    await client.query(
      `INSERT INTO tenant.crm_communication_participants(organization_id, communication_id, role, email_address, user_id, contact_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (organization_id, communication_id, role, email_address) DO UPDATE SET user_id=EXCLUDED.user_id, contact_id=EXCLUDED.contact_id`,
      [context.organizationId, communicationId, entry.role, email, userByEmail.get(email) || null, contactByEmail.get(email) || null],
    );
  }
}
