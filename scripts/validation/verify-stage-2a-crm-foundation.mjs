import assert from "node:assert/strict";
import fs from "node:fs";
const read = (file) => fs.readFileSync(file, "utf8");
const migration = read(
  "database/tenant/migrations/016_crm_account_contact_foundation.sql",
);
const service = read("services/api/src/crm/foundation.js");
const accountMerge = read(
  "apps/web/src/app/api/crm/accounts/[id]/merge/route.ts",
);
const contactMerge = read(
  "apps/web/src/app/api/crm/contacts/[id]/merge/route.ts",
);
assert.match(migration, /crm_account_merge_history/);
assert.match(migration, /crm_contact_merge_history/);
assert.match(migration, /FORCE ROW LEVEL SECURITY/g);
assert.match(service, /findAccountDuplicates/);
assert.match(service, /findContactDuplicates/);
assert.match(service, /mergeAccounts/);
assert.match(service, /mergeContacts/);
assert.match(service, /getRelationshipGraph/);
assert.match(accountMerge, /crmAccountsManage/);
assert.match(accountMerge, /assertSameOriginOrMobile/);
assert.match(contactMerge, /crmAccountsManage/);
assert.match(contactMerge, /audit/);
console.log("Stage 2A CRM foundation contract verified.");
