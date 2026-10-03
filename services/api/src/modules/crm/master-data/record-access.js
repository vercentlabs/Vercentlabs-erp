// Scoped Account and Contact loaders shared by hierarchy, merge and Customer
// 360: the same ownership rule as the Account/Contact
// lists (crm-access-scope.js), optional row locks, and redaction of a parent
// Account the caller cannot open.

import { crmAccountVisibleSql, crmContactVisibleSql } from "../data-management/crm-access-scope.js";
import { CrmAccountIntelligenceError, assertId } from "./account-intelligence-error.js";

// Same ownership rule as the Account/Contact lists
// (crm-access-scope.js): 360, hierarchy and merge could previously open any
// Account or Contact in the organisation by id.
export function intelligenceScope(context, parameters, alias, kind) {
  const bind = (value) => { parameters.push(value); return `$${parameters.length}`; };
  return kind === "account" ? crmAccountVisibleSql(context, bind, alias) : crmContactVisibleSql(context, bind, alias, "party");
}

export async function loadScopedAccount(client, context, partyId, lock = false) {
  const id = assertId(partyId, "Account");
  const parameters = [context.organizationId, id];
  const result = await client.query(
    `SELECT party.*,parent.display_name AS parent_name,
            (parent.id IS NULL OR (true${intelligenceScope(context, parameters, "parent", "account")})) AS parent_visible
     FROM tenant.business_parties party
     LEFT JOIN tenant.business_parties parent
       ON parent.organization_id=party.organization_id AND parent.id=party.parent_party_id
     WHERE party.organization_id=$1 AND party.id=$2${intelligenceScope(context, parameters, "party", "account")}${lock ? " FOR UPDATE OF party" : ""}`,
    parameters,
  );
  if (!result.rows[0]) {
    throw new CrmAccountIntelligenceError(
      404,
      "Account not found.",
      "CRM_ACCOUNT_NOT_FOUND",
    );
  }
  return result.rows[0];
}

// Internal callers (merge, hierarchy checks) need the real parent id; what
// leaves the server hides a parent the caller cannot open.
export function redactHiddenParent(row) {
  if (!row) return row;
  const { parent_visible: parentVisible, ...rest } = row;
  return parentVisible === false
    ? { ...rest, parent_party_id: null, parent_name: "Restricted account", parent_restricted: true }
    : { ...rest, parent_restricted: false };
}

export async function loadScopedContact(client, context, contactId, lock = false) {
  const id = assertId(contactId, "Contact");
  const parameters = [context.organizationId, id];
  // LEFT JOIN, not JOIN: a standalone Contact (party_id IS NULL) is a
  // valid, supported record (see F003's "standalone Contact creation
  // persists without fabricating an Account"). An INNER JOIN here silently
  // excluded every standalone Contact from merge preview/merge entirely —
  // found by a real browser E2E journey (erp-crm-merge-hierarchy.spec.ts)
  // that created a Contact with no Account and hit a 404.
  const result = await client.query(
    `SELECT contact.*,party.display_name AS account_name
     FROM tenant.contacts contact
     LEFT JOIN tenant.business_parties party
       ON party.organization_id=contact.organization_id AND party.id=contact.party_id
     WHERE contact.organization_id=$1 AND contact.id=$2${intelligenceScope(context, parameters, "contact", "contact")}${lock ? " FOR UPDATE OF contact" : ""}`,
    parameters,
  );
  if (!result.rows[0]) {
    throw new CrmAccountIntelligenceError(
      404,
      "Contact not found.",
      "CRM_CONTACT_NOT_FOUND",
    );
  }
  return result.rows[0];
}
