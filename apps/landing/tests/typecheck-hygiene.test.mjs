import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareLandingTypecheck } from "../scripts/prepare-typecheck.mjs";

const packageJson = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"),
);

test("landing typecheck removes stale dev-generated types before tsc", () => {
  assert.equal(
    packageJson.scripts.typecheck,
    "node scripts/prepare-typecheck.mjs && tsc --noEmit",
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "vercentlabs-landing-typecheck-"));
  try {
    const devValidator = path.join(root, ".next", "dev", "types", "validator.ts");
    const productionType = path.join(root, ".next", "types", "routes.d.ts");
    const cache = path.join(root, "tsconfig.tsbuildinfo");

    fs.mkdirSync(path.dirname(devValidator), { recursive: true });
    fs.mkdirSync(path.dirname(productionType), { recursive: true });
    fs.writeFileSync(devValidator, "}\n", "utf8");
    fs.writeFileSync(productionType, "export {};\n", "utf8");
    fs.writeFileSync(cache, "stale", "utf8");

    prepareLandingTypecheck(root);

    assert.equal(fs.existsSync(devValidator), false);
    assert.equal(fs.existsSync(cache), false);
    assert.equal(
      fs.existsSync(productionType),
      true,
      "production-generated .next/types must not be deleted by typecheck preparation",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
