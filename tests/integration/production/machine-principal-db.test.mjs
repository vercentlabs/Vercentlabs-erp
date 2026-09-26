// Machine principals (API keys) under platform RLS, as the restricted web
// role: the organisation comes only from the authenticated key, a request
// cannot choose it, and an organisation context cannot see another
// organisation's keys or developer apps.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import { createProductionKit } from "./production-kit.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const { authenticateApiKey, createApiKey, createDeveloperApp, getApiPlatformContext } = await import("../../../services/api/src/index.js");

test("API key organisation comes only from the key; platform RLS isolates keys between organisations", async (t) => {
  const kit = await createProductionKit();
  t.after(() => kit.close());
  const a = await kit.organization("machine-a");
  const b = await kit.organization("machine-b");
  const admin = { organizationId: a.organizationId, userId: a.ownerId, roleSlugs: ["organization_owner"], permissions: ["platform.integrations.manage", "platform.integrations.view"] };

  const app = await kit.as(kit.web, { organizationId: a.organizationId, userId: a.ownerId }, (client) => createDeveloperApp(client, admin, { name: "Machine A" }));
  const issued = await kit.as(kit.web, { organizationId: a.organizationId, userId: a.ownerId }, (client) => createApiKey(client, admin, app.id, { name: "Key", scopes: ["platform.context.read"] }));

  await t.test("authentication resolves the key's own organisation (no context supplied)", async () => {
    const principal = await kit.as(kit.web, {}, (client) => authenticateApiKey(client, issued.token));
    assert.equal(principal.kind, "api_key");
    assert.equal(principal.organizationId, a.organizationId);
    const context = await kit.as(kit.web, { organizationId: principal.organizationId }, (client) => getApiPlatformContext(client, principal));
    assert.equal(context.organization.id, a.organizationId);
  });

  await t.test("an attacker-chosen organisation context cannot see another organisation's keys or apps", async () => {
    const visible = await kit.as(kit.web, { organizationId: b.organizationId }, async (client) => ({
      keys: (await client.query("SELECT count(*)::int AS n FROM api_keys WHERE developer_app_id=$1", [app.id])).rows[0].n,
      apps: (await client.query("SELECT count(*)::int AS n FROM developer_apps WHERE id=$1", [app.id])).rows[0].n,
    }));
    assert.deepEqual(visible, { keys: 0, apps: 0 });
    const principal = await kit.as(kit.web, { organizationId: b.organizationId }, (client) => authenticateApiKey(client, issued.token));
    assert.equal(principal.organizationId, a.organizationId, "a pre-set context does not change the key's organisation");
  });

  await t.test("the v1 composition and routes never read an organisation from the request", () => {
    const files = [
      path.join(root, "apps/web/src/core/api-key-route.ts"),
      ...fs.readdirSync(path.join(root, "apps/web/src/app/api/v1"), { recursive: true }).filter((file) => String(file).endsWith("route.ts")).map((file) => path.join(root, "apps/web/src/app/api/v1", String(file))),
    ];
    for (const file of files) {
      const source = fs.readFileSync(file, "utf8");
      assert.ok(!/searchParams\.get\(\s*["']organization/i.test(source), `${file} reads an organisation from the query`);
      assert.ok(!/body\??\.organization|input\??\.organization|params\??\.organization/i.test(source), `${file} reads an organisation from the body or path`);
    }
    assert.match(fs.readFileSync(files[0], "utf8"), /tenantTransaction\(principal\.organizationId/, "the handler transaction uses the key's organisation");
  });
});
