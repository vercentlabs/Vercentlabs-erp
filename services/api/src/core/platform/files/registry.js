// Entity types a Shared Platform file may belong to. A file row is only
// ever created for a registered type; the owning module (or, for platform
// artifacts, the platform) decides who may read or change it. A generic
// entity_type + entity_id pair is never an authorization by itself.
export const FILE_ENTITY_TYPES = Object.freeze({
  "crm.lead": { moduleKey: "crm", purposes: ["attachment"] },
  "crm.opportunity": { moduleKey: "crm", purposes: ["attachment"] },
  "crm.party": { moduleKey: "crm", purposes: ["attachment"] },
  "crm.contact": { moduleKey: "crm", purposes: ["attachment"] },
  "crm.campaign": { moduleKey: "crm", purposes: ["attachment"] },
  "support.ticket": { moduleKey: "support", purposes: ["attachment", "inbound_mail"] },
  // Shared by every module that uses the catalogue; the product module checks access.
  "products.item": { moduleKey: null, purposes: ["attachment"] },
  "sales.quotation": { moduleKey: "sales", purposes: ["attachment"] },
  "sales.order": { moduleKey: "sales", purposes: ["attachment"] },
  // The exact PDF of each order confirmation that was emailed.
  "sales.order_confirmation": { moduleKey: "sales", purposes: ["attachment"] },
  "platform.export": { moduleKey: null, purposes: ["export"] },
  "platform.report_run": { moduleKey: null, purposes: ["report_output"] },
});

export function getFileEntityType(entityType) {
  return FILE_ENTITY_TYPES[String(entityType || "")] || null;
}
