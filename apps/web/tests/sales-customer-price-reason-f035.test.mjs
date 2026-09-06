import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const workspace = readFileSync(
  new URL(
    "../src/modules/sales/components/pass1-operations-workspace.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("F035: the customer-specific-price form exposes a required reason field", () => {
  assert.match(workspace, /field\("reason", "Reason \(required\)", "text"\)/);
});
