// The first-run checklist on CRM Setup (CRM audit): only the essentials, each ticked by what the company has actually done — so a new
// company sees where to start, and the list goes away once it is through them.
const ITEMS = Object.freeze([
  { id: "how-you-sell", title: "Set up how you sell", hint: "Pick your industry's starter pack, or adjust the deal stages.", href: "/crm/settings/starter-packs",
    done: `EXISTS (SELECT 1 FROM tenant.crm_pipelines WHERE organization_id = $1 AND NOT is_default)
      OR EXISTS (SELECT 1 FROM tenant.crm_pipeline_stages WHERE organization_id = $1 AND updated_at > created_at + interval '1 minute')` },
  { id: "team", title: "Invite your team", hint: "Give each salesperson their own login and CRM access.", href: "/crm/settings/team-access",
    done: "(SELECT count(*) FROM public.organization_memberships WHERE organization_id = $1 AND status = 'active') > 1" },
  { id: "working-week", title: "Your working week and holidays", hint: "So reminders and response times skip your days off.", href: "/crm/settings/holidays",
    done: "EXISTS (SELECT 1 FROM tenant.crm_holidays WHERE organization_id = $1)" },
  { id: "leads-in", title: "Bring enquiries in", hint: "Connect IndiaMART, JustDial, a property portal or your website form.", href: "/crm/settings/leads/connectors",
    done: "EXISTS (SELECT 1 FROM tenant.crm_lead_connectors WHERE organization_id = $1) OR EXISTS (SELECT 1 FROM tenant.crm_capture_forms WHERE organization_id = $1)" },
  { id: "whatsapp", title: "Talk on WhatsApp", hint: "Use click-to-chat, or connect your WhatsApp Business number.", href: "/crm/settings/whatsapp",
    done: "EXISTS (SELECT 1 FROM tenant.crm_whatsapp_settings WHERE organization_id = $1)" },
  { id: "import", title: "Bring your customers in", hint: "Import companies, contacts and leads from Tally, Busy, Vyapar or Excel.", href: "/crm/data/import-export",
    done: "EXISTS (SELECT 1 FROM tenant.business_parties WHERE organization_id = $1) OR EXISTS (SELECT 1 FROM tenant.crm_leads WHERE organization_id = $1)" },
]);

// [{ id, title, hint, href, done }] in order; { complete } is true once every one is done.
export async function getCrmSetupChecklist(client, context) {
  const { rows } = await client.query(`SELECT ${ITEMS.map((item, index) => `(${item.done}) AS done_${index}`).join(", ")}`, [context.organizationId]);
  const items = ITEMS.map((item, index) => ({ id: item.id, title: item.title, hint: item.hint, href: item.href, done: Boolean(rows[0]?.[`done_${index}`]) }));
  return { items, complete: items.every((item) => item.done) };
}
