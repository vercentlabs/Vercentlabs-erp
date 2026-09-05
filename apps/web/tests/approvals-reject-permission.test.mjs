import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

// A regression guard for a real authorization bug found while auditing the
// Sales approval workflow (F041): both approval routes checked
// `command.permission` only inside the `if (decision.decision === "approved")`
// branch, so anyone holding the generic `approvals.manage` permission could
// reject (not just approve) a Sales quotation/order, or an Accounting
// budget/invoice/bill/payment/journal approval, without holding the
// entity-specific approval permission. The mobile route additionally never
// invoked `command.reject` at all, so a mobile "reject" silently left the
// underlying business record stuck in `pending_approval` forever.

for (const file of [
  "apps/web/src/app/api/approvals/[id]/route.ts",
  "apps/web/src/app/api/mobile/v1/approvals/[id]/route.ts",
]) {
  test(`${file}: command.permission is enforced before both approve and reject`, () => {
    const source = read(file);
    const decisionBlock = source.slice(source.indexOf("let commandResult"));
    // The permission check must appear before the approved/rejected branching,
    // not nested only inside `if (decision.decision === "approved")`.
    const permissionIndex = decisionBlock.indexOf(
      "requirePermissionFromSession(session, command.permission)",
    );
    const branchIndex = decisionBlock.indexOf(
      'decision.decision === "approved"',
    );
    assert.ok(permissionIndex >= 0, "command.permission must be checked");
    assert.ok(
      permissionIndex < branchIndex,
      "command.permission must be checked before branching on the decision, not only inside the approved branch",
    );
  });

  test(`${file}: rejecting an approval invokes command.reject`, () => {
    const source = read(file);
    assert.match(
      source,
      /else if \(command\.reject\)\s*\{\s*commandResult = await command\.reject\(/,
    );
  });
}
