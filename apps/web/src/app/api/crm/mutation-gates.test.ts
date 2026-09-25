import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Read breadth is not write authority: Auditor and Read-only now see every
// CRM record in their companies, so EVERY mutating CRM handler must demand a
// specific permission they do not hold. A handler passes if its body gates on
// a permission at the route, or if it is listed below with the domain-level
// gate that enforces it (each verified to throw 403 without the permission).

const root = path.dirname(fileURLToPath(import.meta.url));

const DOMAIN_GATED: Record<string, string> = {
  "POST accounts/duplicates/route.ts": "read-only duplicate check (no write)",
  "POST contacts/duplicates/route.ts": "read-only duplicate check (no write)",
  "POST leads/duplicates/route.ts": "read-only duplicate check (no write)",
  "POST accounts/merge/preview/route.ts": "read-only merge preview; execution route requires crm.accounts.manage",
  "POST contacts/merge/preview/route.ts": "read-only merge preview; execution route requires crm.accounts.manage",
  "POST attachments/[entityType]/[entityId]/route.ts": "assertCanWriteCrmRecordContent",
  "DELETE attachments/[entityType]/[entityId]/[id]/route.ts": "assertCanWriteCrmRecordContent",
  "POST notes/route.ts": "assertCanWriteCrmRecordContent",
  "PATCH notes/[id]/route.ts": "assertCanWriteCrmRecordContent",
  "DELETE notes/[id]/route.ts": "assertCanWriteCrmRecordContent",
  "PATCH custom-fields/values/[entityType]/[entityId]/route.ts": "assertCanEditValues (record manage permission)",
  "POST lead-scoring-models/route.ts": "assertConfigPermission",
  "PATCH lead-scoring-models/[id]/route.ts": "assertConfigPermission",
  "POST lead-scoring-models/[id]/activate/route.ts": "assertConfigPermission",
  "POST lead-scoring-models/[id]/rules/route.ts": "assertConfigPermission",
  "POST lead-scoring-models/[id]/rules/[ruleId]/status/route.ts": "assertConfigPermission",
  "POST lead-scoring-models/[id]/train/route.ts": "assertScoringConfigPermission",
  "POST leads/[id]/assign/route.ts": "canAssignLeadOwners (crm.leads.manage) + assertCrmOwnerAssignable",
  "POST leads/[id]/qualification/route.ts": "assertCanDecide (crm.leads.manage)",
  "POST leads/[id]/score/route.ts": "assertSensitiveLeadIntelligenceAccess (derived score only)",
  "POST leads/[id]/tags/route.ts": "assertCanManageTags (crm.leads.manage)",
  "DELETE leads/[id]/tags/[tagId]/route.ts": "assertCanManageTags (crm.leads.manage)",
  "POST leads/[id]/duplicates/dismiss/route.ts": "canOverrideLeadDuplicate",
  "PATCH public/meetings/bookings/[token]/route.ts": "public booking token (no CRM session)",
  "POST public/meetings/links/[token]/book/route.ts": "public booking token (no CRM session)",
};

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? routeFiles(path.join(dir, entry.name)) : entry.name === "route.ts" ? [path.join(dir, entry.name)] : [],
  );
}

test("every mutating CRM API handler is permission-gated (route-level or a named domain gate)", () => {
  const ungated: string[] = [];
  for (const file of routeFiles(root)) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/export async function (POST|PATCH|PUT|DELETE)\b/g)) {
      const next = source.indexOf("export async function", (match.index ?? 0) + 10);
      const body = source.slice(match.index, next < 0 ? source.length : next);
      const routeGated =
        /requireCrmAccess\(client, session, [^)]*(CRM_PERMISSIONS|PERMISSIONS|permission|RESOURCE_MANAGE)/.test(body) ||
        /requireCrmMutationAccess|resolveCrmMutationPermission|requireSessionPermission|requirePermission\(/.test(body);
      const key = `${match[1]} ${path.relative(root, file).split(path.sep).join("/")}`;
      if (!routeGated && !DOMAIN_GATED[key]) ungated.push(key);
    }
  }
  assert.deepEqual(ungated, [], "add a permission gate (or a verified domain gate entry) for these handlers");
});
