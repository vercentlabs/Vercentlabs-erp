// What was recorded against a CRM record, moved from a merged duplicate to the record kept — the one list every merge (lead, deal,
// company, contact) shares, so a WhatsApp chat, an email thread, a call or a follower never stays behind on the archived duplicate.
// entityType: "lead" | "opportunity" | "party" | "contact" (the entity_type those tables use).
const RECORDED = ["crm_activities", "crm_notes", "crm_attachment_details", "crm_email_messages", "crm_whatsapp_messages", "crm_calls", "crm_sms_messages"];
// Tags exist on leads and deals only (crm_record_tags' check).
const TAGGED = new Set(["lead", "opportunity"]);

export async function moveRecordedHistory(client, context, entityType, duplicateId, keepId) {
  const move = [context.organizationId, duplicateId, keepId, entityType];
  for (const table of RECORDED)
    await client.query(`UPDATE tenant.${table} SET entity_id = $3 WHERE organization_id = $1 AND entity_type = $4 AND entity_id = $2`, move);
  await client.query(`UPDATE public.attachments SET entity_id = $3::text WHERE organization_id = $1 AND entity_type = 'crm.' || $4 AND entity_id = $2::text`, move);
  // Tags and followers are copied (the kept record may already have some) and then leave the duplicate, so nobody keeps being
  // notified about an archived record.
  if (TAGGED.has(entityType)) {
    await client.query(
      `INSERT INTO tenant.crm_record_tags (organization_id, entity_type, entity_id, tag_id, created_by)
       SELECT organization_id, entity_type, $3, tag_id, $5 FROM tenant.crm_record_tags WHERE organization_id = $1 AND entity_type = $4 AND entity_id = $2
       ON CONFLICT DO NOTHING`, [...move, context.userId ?? null]);
    await client.query("DELETE FROM tenant.crm_record_tags WHERE organization_id = $1 AND entity_type = $3 AND entity_id = $2", [context.organizationId, duplicateId, entityType]);
  }
  await client.query(
    `INSERT INTO tenant.crm_followers (organization_id, entity_type, entity_id, user_id, reason)
     SELECT organization_id, entity_type, $3, user_id, reason FROM tenant.crm_followers WHERE organization_id = $1 AND entity_type = $4 AND entity_id = $2
     ON CONFLICT DO NOTHING`, move);
  await client.query("DELETE FROM tenant.crm_followers WHERE organization_id = $1 AND entity_type = $3 AND entity_id = $2", [context.organizationId, duplicateId, entityType]);
}
