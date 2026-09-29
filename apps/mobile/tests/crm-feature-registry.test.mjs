// Every F001-F030 capability has a mobile disposition, and every web deep
// link it opens is a real page in the web app (several pointed at routes that
// never existed: /crm/sources, /crm/stages, /crm/lost-reasons, /crm/inbox,
// /crm/activities).
import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const registry = fs.readFileSync(new URL("../src/modules/crm/ui/crm-feature-registry.ts", import.meta.url), "utf8");
const entries = [...registry.matchAll(/\{ id: "(F\d{3})",[^}]*support: "([a-z-]+)"[^}]*webPath: "([^"]+)" \}/g)].map((match) => ({ id: match[1], support: match[2], webPath: match[3] }));

test("F001-F030 each have exactly one mobile disposition", () => {
  const ids = entries.map((entry) => entry.id);
  assert.deepEqual(ids, Array.from({ length: 30 }, (_, index) => `F${String(index + 1).padStart(3, "0")}`));
  for (const entry of entries) assert.ok(["native", "native-read", "native-action", "web-workspace"].includes(entry.support), entry.id);
});

test("every web deep link opens an existing web page", () => {
  for (const entry of entries) {
    const page = new URL(`../../web/src/app/(workspace)${entry.webPath}/page.tsx`, import.meta.url);
    assert.ok(fs.existsSync(page), `${entry.id} links to ${entry.webPath}, which has no page`);
  }
});
