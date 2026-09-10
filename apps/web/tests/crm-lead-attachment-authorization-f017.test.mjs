// CRM vNext Prompt 6 (F017 — Notes & Files), §48: "This is critical. A
// storage URL must not become an authorization bypass."
//
// An Explore-agent audit of the current attachment-serving path (see
// CRM_VNEXT_IMPLEMENTATION_REGISTER.md's Prompt 6 evidence) found the
// three-part authorization gate (parent-record scope, sensitive-content
// permission, quarantine/scan status) is real and correctly enforced.
// Bytes are stored directly in Postgres (public.attachments.content bytea)
// and served only through this one authenticated route — there is no
// separate storage URL to bypass today.
//
// v2 (F017 attachment-generalization pass): the route no longer owns this
// gate's SQL directly — it now delegates to the canonical attachment
// domain module (attachments-operations.js, seller-activity-and-follow-up-
// workspace/attachments/) that Account/Contact/Opportunity's new routes
// also call, so a future authorization change only has one place to make
// it. This file's assertions moved with the logic: the exact SQL/ordering
// pins now target the domain module, the route-level pins (permission
// order before delegating, no redirect, cache headers, no storage_key
// leak) stay on the route.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

const routePath = "apps/web/src/app/api/crm/leads/[id]/attachments/[attachmentId]/route.ts";
const domainPath = "services/api/src/modules/crm/seller-activity-and-follow-up-workspace/attachments/attachments-operations.js";

test("F017 §48: the attachment GET handler checks the sensitive-content permission before delegating to the domain module", () => {
  const source = read(routePath);
  const getFn = source.match(/export async function GET[\s\S]*?\n}\n/)?.[0] || "";
  assert.match(getFn, /requirePermissionFromSession\(session, PERMISSIONS\.crmView\);/);
  assert.match(getFn, /requirePermissionFromSession\(session, PERMISSIONS\.crmLeadsViewSensitive\);/);
  const permissionIndex = getFn.indexOf("requirePermissionFromSession(session, PERMISSIONS.crmLeadsViewSensitive)");
  const delegateIndex = getFn.indexOf("getCrmAttachmentContent(");
  assert.ok(permissionIndex > -1 && delegateIndex > -1 && permissionIndex < delegateIndex, "the sensitive-content permission check must run before the attachment content is ever fetched");
});

test("F017 §48: the domain module resolves the parent record through the real shared authorization function before the content query", () => {
  const source = read(domainPath);
  const fn = source.match(/export async function getCrmAttachmentContent[\s\S]*?\n}\n/)?.[0] || "";
  const scopeIndex = fn.indexOf("await assertParentAccess(client, context, entityType, entityId);");
  const queryIndex = fn.indexOf("SELECT file_name,mime_type,size_bytes,content");
  assert.ok(scopeIndex > -1, "the handler must resolve the parent record through assertParentAccess (which itself calls resolveCrmEntityAccess — the SAME function Notes/Timeline use), not an unscoped existence check");
  assert.ok(scopeIndex < queryIndex, "parent-record scope must be resolved before the attachment content query — never after");
});

test("F017 §48: the attachment content query itself enforces parent binding (organization + entity) and quarantine/scan status — the gate lives in SQL, not only in application code", () => {
  const source = read(domainPath);
  const select = source.match(/SELECT file_name,mime_type,size_bytes,content[\s\S]*?LIMIT 1`/)?.[0] || "";
  assert.match(select, /FROM public\.attachments/);
  assert.match(select, /WHERE organization_id=\$1 AND id=\$2 AND entity_type=\$3 AND entity_id=\$4/);
  assert.match(select, /lifecycle_status='clean'/);
  assert.match(select, /scan_status IN \('clean','not_applicable'\)/);
});

test("F017 §48: attachment bytes are served directly through this authenticated route, never via a redirect to an unauthenticated storage URL", () => {
  const source = read(routePath);
  assert.doesNotMatch(source, /Response\.redirect/);
  assert.doesNotMatch(source, /\.location\s*=/i);
  assert.doesNotMatch(source, /storage_key/, "storage_key must not be surfaced to the client as a fetchable URL — bytes are streamed by this route or not at all");
  assert.match(source, /Cache-Control["']?:\s*["']private, no-store["']/, "attachment responses must never be cached by shared/proxy caches");
  assert.match(source, /X-Content-Type-Options["']?:\s*["']nosniff["']/, "prevents MIME-sniffing a served attachment as something else");
});

test("F017 §48: DELETE enforces the same organization+parent+entity binding as GET, via the same shared parent-access check preceding the destructive query", () => {
  const source = read(domainPath);
  const fn = source.match(/export async function deleteCrmAttachment[\s\S]*?\n}\n/)?.[0] || "";
  const scopeIndex = fn.indexOf("await assertParentAccess(client, context, entityType, entityId);");
  const deleteIndex = fn.indexOf("DELETE FROM public.attachments");
  assert.ok(scopeIndex > -1 && deleteIndex > -1 && scopeIndex < deleteIndex, "parent-record scope must be resolved before the attachment is deleted");
  assert.match(fn, /WHERE organization_id=\$1 AND id=\$2 AND entity_type=\$3 AND entity_id=\$4/);
});

test("F017 §48: no generic CRM resource/mobile route exposes raw attachment content — the domain module's routes are the single authorization chokepoint", () => {
  const generic = read("apps/web/src/app/api/crm/[resource]/[id]/route.ts");
  const mobile = read("apps/web/src/app/api/mobile/v1/crm/[resource]/[id]/route.ts");
  for (const source of [generic, mobile]) {
    assert.doesNotMatch(source, /public\.attachments/i, "attachment content must only ever be reachable through the dedicated, fully-governed attachments routes");
  }
});

test("F017 §48: the storage-adapter interface intended for a future real backend documents that callers must still authorize before download — not a bare public URL", () => {
  const engine = read("packages/document-engine/src/index.js");
  // Not asserting the adapter is wired up (it isn't — see the register); this
  // pins that if/when it is, its own contract doesn't invite an unauthenticated
  // public URL pattern by construction (e.g. no plain "publicUrl" field).
  assert.doesNotMatch(engine, /publicUrl/i);
});

test("F017: Account/Contact/Opportunity attachment routes reuse the SAME domain module as Lead, not a copy of the SQL a fourth time", () => {
  for (const routeFile of [
    "apps/web/src/app/api/crm/accounts/[id]/attachments/route.ts",
    "apps/web/src/app/api/crm/contacts/[id]/attachments/route.ts",
    "apps/web/src/app/api/crm/opportunities/[id]/attachments/route.ts",
  ]) {
    const source = read(routeFile);
    assert.match(source, /from "@vercentlabs\/api"/);
    assert.match(source, /createCrmAttachment/);
    assert.match(source, /listCrmAttachments/);
    assert.doesNotMatch(source, /INSERT INTO public\.attachments/, `${routeFile} must delegate to the domain module, not re-derive the INSERT`);
  }
});

// F017 §CRM-VNEXT-053 closeout (route-level wiring): the POST routes must
// forward a `replacesLogicalId` form field through to the domain module so
// "replace this file" reuses the logical identity, and a dedicated versions
// route must exist per entity type using the SAME shared permission gate as
// that entity's download route (not a weaker one).
for (const [entity, folder, entityType, permission] of [
  ["Lead", "leads", "lead", "crmLeadsViewSensitive"],
  ["Account", "accounts", "party", "crmAccountsViewSensitive"],
  ["Contact", "contacts", "contact", "crmContactsViewSensitive"],
  ["Opportunity", "opportunities", "opportunity", "crmLeadsViewSensitive"],
]) {
  test(`F017 §CRM-VNEXT-053: ${entity}'s attachment POST route forwards replacesLogicalId to createCrmAttachment`, () => {
    const source = read(`apps/web/src/app/api/crm/${folder}/[id]/attachments/route.ts`);
    assert.match(source, /form\.get\("replacesLogicalId"\)/);
    assert.match(source, /replacesLogicalId/);
  });

  test(`F017 §CRM-VNEXT-053: ${entity} has a dedicated versions route wrapping listCrmAttachmentVersions with the same view-permission gate as its download route`, () => {
    const source = read(`apps/web/src/app/api/crm/${folder}/[id]/attachments/[attachmentId]/versions/route.ts`);
    assert.match(source, /listCrmAttachmentVersions/);
    assert.match(source, new RegExp(`PERMISSIONS\\.${permission}`));
    assert.match(source, new RegExp(`listCrmAttachmentVersions\\(client, context, "${entityType}", id, attachmentId\\)`));
  });
}

test("F017 §CRM-VNEXT-053: no generic CRM resource/mobile route exposes attachment version history either — the versions routes are the single chokepoint", () => {
  const generic = read("apps/web/src/app/api/crm/[resource]/[id]/route.ts");
  const mobile = read("apps/web/src/app/api/mobile/v1/crm/[resource]/[id]/route.ts");
  for (const source of [generic, mobile]) {
    assert.doesNotMatch(source, /listCrmAttachmentVersions/);
  }
});
