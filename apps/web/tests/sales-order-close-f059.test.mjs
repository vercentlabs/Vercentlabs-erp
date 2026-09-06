import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const validation = read("src/modules/sales/validation.ts");
const route = read("src/app/api/sales/orders/[id]/actions/route.ts");
const actions = read("src/modules/sales/components/document-actions.tsx");

test("F059: the sales action schema accepts a close action", () => {
  assert.match(validation, /"close"/);
});

test("F059: the order actions route dispatches close to closeSalesOrder", () => {
  assert.match(route, /closeSalesOrder/);
  assert.match(route, /input\.action === "close"/);
});

test("F059: the document-actions UI exposes a Close order button for confirmed/on_hold orders", () => {
  assert.match(actions, /act\("close"\)/);
  assert.match(actions, /status === "confirmed" \|\| status === "on_hold"/);
});
