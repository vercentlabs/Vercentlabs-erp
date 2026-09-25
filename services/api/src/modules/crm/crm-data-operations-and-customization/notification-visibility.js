import { crmAccountVisibleSql, crmContactVisibleSql } from "./crm-access-scope.js";
import { recordScope } from "./record-policy.js";
import { resources } from "./resource-registry.js";

// User-facing notifications keep the title written when the event happened
// ("Acme Corp deal moved to Negotiation"). If the recipient later loses
// access to that record, the stored text would keep revealing it. Rendering
// re-checks each CRM target against the CURRENT scope rules and replaces
// what leaks with a neutral stub. The stored notification row (and every
// audit record) is never modified — this is read-time projection only.
//
// Targets are identified by href (/crm/<resource>/<uuid>, the only link
// shape CRM writes). One scoped `id = ANY(...)` query per resource type:
// no per-row permission checks.

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const TARGET = new RegExp(`^/crm/([a-z-]+)/(${UUID})(?:[/?#].*)?$`, "i");

// href segment → how visibility of that record is decided.
const TARGET_KINDS = Object.freeze({
  leads: { resource: "leads" },
  opportunities: { resource: "opportunities" },
  "follow-ups": { resource: "activities" },
  tasks: { resource: "activities" },
  meetings: { resource: "activities" },
  calls: { resource: "activities" },
  activities: { resource: "activities" },
  campaigns: { resource: "campaigns" },
  accounts: { kind: "account" },
  contacts: { kind: "contact" },
});

export const REDACTED_CRM_NOTIFICATION = Object.freeze({
  title: "CRM record updated",
  message: "You no longer have access to this record.",
});

function parseTarget(href) {
  const match = TARGET.exec(String(href || ""));
  if (!match || !TARGET_KINDS[match[1]]) return null;
  return { segment: match[1], id: match[2].toLowerCase() };
}

async function visibleIds(client, context, segment, ids) {
  const target = TARGET_KINDS[segment];
  const parameters = [context.organizationId, ids];
  const bind = (value) => { parameters.push(value); return `$${parameters.length}`; };
  let sql;
  if (target.resource) {
    const definition = resources[target.resource];
    sql = `SELECT record.id FROM ${definition.table} record WHERE record.organization_id=$1 AND record.id = ANY($2::uuid[])${recordScope(definition, context, parameters, "record")}`;
  } else if (target.kind === "account") {
    sql = `SELECT account.id FROM tenant.business_parties account WHERE account.organization_id=$1 AND account.id = ANY($2::uuid[])${crmAccountVisibleSql(context, bind, "account")}`;
  } else {
    sql = `SELECT contact.id FROM tenant.contacts contact LEFT JOIN tenant.business_parties account ON account.organization_id=contact.organization_id AND account.id=contact.party_id
            WHERE contact.organization_id=$1 AND contact.id = ANY($2::uuid[])${crmContactVisibleSql(context, bind, "contact", "account")}`;
  }
  const { rows } = await client.query(sql, parameters);
  return new Set(rows.map((row) => String(row.id).toLowerCase()));
}

// `canUseCrm` = the CRM module is enabled for the caller and they hold
// crm.view; without it every CRM target is redacted.
export async function redactInaccessibleCrmNotifications(client, context, notifications, { canUseCrm = true } = {}) {
  const targets = new Map();
  for (const notification of notifications) {
    const target = parseTarget(notification.href);
    if (!target) continue;
    if (!targets.has(target.segment)) targets.set(target.segment, new Set());
    targets.get(target.segment).add(target.id);
  }
  if (!targets.size) return notifications;
  const allowed = new Map();
  if (canUseCrm) {
    // Always checked in SQL, even for view-all callers: the record must
    // still exist inside their current company/branch boundary.
    for (const [segment, ids] of targets) allowed.set(segment, await visibleIds(client, context, segment, [...ids]));
  }
  return notifications.map((notification) => {
    const target = parseTarget(notification.href);
    if (!target || allowed.get(target.segment)?.has(target.id)) return notification;
    return { ...notification, ...REDACTED_CRM_NOTIFICATION, href: null, redacted: true };
  });
}
