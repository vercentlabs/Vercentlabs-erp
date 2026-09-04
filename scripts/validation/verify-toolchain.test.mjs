import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const script = path.join(here, "verify-toolchain.mjs");
function run(nodeVersion, pnpmVersion) {
  return spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { ...process.env, VERCENTLABS_TOOLCHAIN_TEST_MODE: "1", VERCENTLABS_TOOLCHAIN_TEST_NODE_VERSION: nodeVersion, VERCENTLABS_TOOLCHAIN_TEST_PNPM_VERSION: pnpmVersion },
  });
}
test("toolchain accepts Node 24 and pinned pnpm", () => {
  const r = run("v24.19.0", "11.21.0");
  assert.equal(r.status, 0, r.stderr);
});
test("toolchain fails closed when Node is not major 24", () => {
  const r = run("v26.5.0", "11.21.0");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Node major must be exactly 24/);
});
test("toolchain fails closed when pnpm is not pinned", () => {
  const r = run("v24.19.0", "11.20.0");
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /pnpm must be exactly 11\.21\.0/);
});
test("toolchain accepts CRLF-trimmed pinned pnpm output", () => {
  const r = run("v24.19.0", "11.21.0\r\n");
  assert.equal(r.status, 0, r.stderr);
});
