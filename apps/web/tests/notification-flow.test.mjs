import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

test("opening a notification updates read state and refreshes the shell badge", () => {
  const source = read("apps/web/src/components/notification-list.tsx");

  assert.match(source, /const \[items, setItems\] = useState\(notifications\)/);
  assert.match(source, /setItems\(\(current\) =>/);
  assert.match(source, /router\.push\(href\);\s*router\.refresh\(\);/);
  assert.match(source, /if \(!result\.ok\)[\s\S]*?return;/);
});

test("workspace notifications link to their related setup pages", () => {
  const platform = read("apps/web/src/lib/platform.ts");
  const invitation = read("apps/web/src/app/api/invitations/accept/route.ts");

  assert.match(platform, /'Your ERP workspace is ready'.*'\/settings'/);
  assert.match(invitation, /'Workspace access granted'.*'\/profile'/);
  assert.doesNotMatch(platform, /'Your ERP workspace is ready'.*'\/dashboard'/);
  assert.doesNotMatch(invitation, /'Workspace access granted'.*'\/dashboard'/);
});
