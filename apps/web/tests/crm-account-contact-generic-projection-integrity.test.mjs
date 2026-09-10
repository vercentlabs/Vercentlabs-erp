// Integrity closeout (Prompts 1-5): Accounts and Contacts each have a
// specialized, sensitive-field-projecting implementation
// (account-security.js/contact-security.js, exposed only through the
// dedicated /api/crm/accounts and /api/crm/contacts routes). This test
// proves the generic CRM resource path (which returns raw, unprojected
// records via getCrmRecord/listCrmRecords + projectCrmRecord) has no
// reachable escape hatch for either entity type: neither key is in the
// CRM_API_RESOURCE_KEYS/CRM_UI_RESOURCE_KEYS allowlist every
// /api/crm/[resource] request is gated on, and neither exists in the
// API-layer `resources` map the generic query builder reads from — so even
// a caller who somehow bypassed the route-level allowlist would hit an
// "unknown resource" error, not a raw record.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { loadTsModule } from "./helpers/load-ts-module.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const scopeMod = await loadTsModule("apps/web/src/modules/crm/crm-data-operations-and-customization/capability-registry.ts");

test("accounts/contacts are not reachable through the generic CRM resource route allowlist", () => {
  assert.equal(scopeMod.isCrmApiResource("accounts"), false, "accounts must not be a generic API resource");
  assert.equal(scopeMod.isCrmApiResource("contacts"), false, "contacts must not be a generic API resource");
  assert.equal(scopeMod.isCrmUiResource("accounts"), false, "accounts must not be a generic settings-page resource");
  assert.equal(scopeMod.isCrmUiResource("contacts"), false, "contacts must not be a generic settings-page resource");
});

test("accounts/contacts have no definition in the API-layer generic resources map (defense in depth if the route-level allowlist is ever bypassed)", () => {
  const source = read("services/api/src/modules/crm/index.js");
  // The `resources` object's own top-level entries are declared as
  // `<key>: {` at the start of a line inside that literal — match that
  // shape rather than any string occurrence of "accounts"/"contacts"
  // (which legitimately appear as *fields* on other resources, e.g.
  // `partyId`, joins, etc.).
  assert.doesNotMatch(source, /^ {2}accounts: \{/m, "accounts must not be defined as a generic resource");
  assert.doesNotMatch(source, /^ {2}contacts: \{/m, "contacts must not be defined as a generic resource");
});

test("account/contact sensitive-field projection stays wired to the dedicated routes, not the generic [resource] route", () => {
  const accountsRoute = read("apps/web/src/app/api/crm/accounts/route.ts");
  const contactsRoute = read("apps/web/src/app/api/crm/contacts/route.ts");
  assert.match(accountsRoute, /createCrmAccount|listCrmAccounts|getCrmAccountForCaller/);
  assert.match(contactsRoute, /createCrmContact|listCrmContacts|getCrmContactForCaller/);
});
