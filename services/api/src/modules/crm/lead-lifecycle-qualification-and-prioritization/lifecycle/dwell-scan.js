// F007 dwell SLA: scheduled breach detection + notification. Mirrors the
// Lead SLA scan's own idempotency approach — dwell_breach_notified_at is
// the dedup marker (reset to NULL by every governed transition, migration
// 093), so a lead is notified once per stage entry, and a retried/duplicate
// tick finds nothing new to notify.
export async function scanLeadStageDwellBreaches(client, context) {
  const result = await client.query(
    `SELECT lead.id,lead.full_name,lead.owner_user_id,lead.stage_entered_at,stage.name AS stage_name,stage.dwell_breach_hours
       FROM tenant.crm_leads lead
       JOIN tenant.crm_lead_stages stage ON stage.organization_id=lead.organization_id AND stage.code=lead.status
      WHERE lead.organization_id=$1 AND lead.record_status='active'
        AND stage.dwell_breach_hours IS NOT NULL
        AND lead.stage_entered_at <= now() - (stage.dwell_breach_hours || ' hours')::interval
        AND lead.dwell_breach_notified_at IS NULL`,
    [context.organizationId],
  );
  let notified = 0;
  for (const row of result.rows) {
    await client.query(
      `UPDATE tenant.crm_leads SET dwell_breach_notified_at=now() WHERE organization_id=$1 AND id=$2 AND dwell_breach_notified_at IS NULL`,
      [context.organizationId, row.id],
    );
    if (row.owner_user_id) {
      await client.query(
        `INSERT INTO notifications(organization_id,user_id,type,title,message,href)
         SELECT $1,$2,'crm_dwell_breach',$3,$4,$5
         WHERE EXISTS(SELECT 1 FROM organization_memberships WHERE organization_id=$1 AND user_id=$2 AND status='active')
           AND COALESCE((SELECT enabled FROM notification_preferences
             WHERE organization_id=$1 AND user_id=$2 AND channel='in_app' AND category='crm_dwell_breach'),true)`,
        [
          context.organizationId,
          row.owner_user_id,
          "Lead has exceeded its stage SLA",
          `${row.full_name || "A Lead"} has been in ${row.stage_name} longer than the configured limit.`,
          `/crm/leads/${row.id}`,
        ],
      );
    }
    notified += 1;
  }
  return { scanned: result.rows.length, notified };
}
