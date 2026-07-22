import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relativePath) => fs.readFileSync(path.join(mobileRoot, relativePath), "utf8");
const exists = (relativePath) => fs.existsSync(path.join(mobileRoot, relativePath));

test("Expo Router uses the src/app architecture without a WebView", () => {
  assert.ok(exists("src/app/_layout.tsx"));
  assert.equal(exists("app"), false);
  assert.doesNotMatch(read("package.json"), /react-native-webview/);
});

test("legacy pre-module architecture is absent", () => {
  const legacyPaths = [
    "src/api",
    "src/auth",
    "src/config.ts",
    "src/data",
    "src/features",
    "src/providers",
    "src/security",
    "src/theme",
    "src/ui",
    "src/modules/registry.ts",
    "src/modules/workspace-navigation.ts",
  ];

  for (const legacyPath of legacyPaths) {
    assert.equal(exists(legacyPath), false, `${legacyPath} must not return`);
  }
});

test("platform concerns have one canonical owner", () => {
  for (const canonicalPath of [
    "src/core/api/client.ts",
    "src/core/auth/auth-provider.tsx",
    "src/core/config/index.ts",
    "src/core/database/database.ts",
    "src/core/providers/app-providers.tsx",
    "src/core/security/privacy-shield.tsx",
    "src/shared/theme/theme.tsx",
    "src/shared/components/app-error-boundary.tsx",
  ]) {
    assert.ok(exists(canonicalPath), `${canonicalPath} is required`);
  }
});

test("CRM owns its native data, sync, UI, and manifest", () => {
  assert.match(read("src/modules/crm/manifest.ts"), /released: true/);
  for (const modulePath of [
    "src/modules/crm/components/create-record-sheet.tsx",
    "src/modules/crm/components/lead-capture.tsx",
    "src/modules/crm/data/sync.ts",
    "src/modules/crm/hooks/use-crm-query.ts",
  ]) {
    assert.ok(exists(modulePath), `${modulePath} is required`);
  }
});

test("application source does not import removed legacy aliases", () => {
  const forbidden = /from\s+["']@\/(?:api|auth|data|features|providers|security|theme|ui)(?:\/|["'])/;
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolutePath = path.join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath);
      else if (/\.tsx?$/.test(entry.name)) {
        assert.doesNotMatch(
          fs.readFileSync(absolutePath, "utf8"),
          forbidden,
          `${path.relative(mobileRoot, absolutePath)} imports a legacy alias`,
        );
      }
    }
  };

  visit(path.join(mobileRoot, "src"));
});
