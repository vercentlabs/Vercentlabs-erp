#!/usr/bin/env node
// Release evidence for one deployment (deploy workflow artifact; also usable
// locally). No secrets: only identifiers, digests and versions.
//
//   node scripts/deploy/release-manifest.mjs --environment production --out release.json
//
// Inputs from the environment: RELEASE_SHA, WEB_IMAGE, WORKER_IMAGE,
// LANDING_IMAGE, MIGRATION_IMAGE (digest references), PREVIOUS_IMAGES (the
// rollback target, "deployment=image" lines captured before apply),
// GITHUB_ACTOR / GITHUB_RUN_ID / GITHUB_SERVER_URL / GITHUB_REPOSITORY,
// VERIFICATION (a short summary, e.g. "erp-ci: success; smoke: 5/5").
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { EXPECTED_MIGRATIONS } from "../../packages/database/src/migration-manifest.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = Object.fromEntries(
  process.argv
    .slice(2)
    .reduce((pairs, arg, index, all) => (arg.startsWith("--") ? [...pairs, [arg.slice(2), all[index + 1]]] : pairs), []),
);

const last = (files) => (files.length ? files[files.length - 1] : null);
const git = (...command) => {
  try {
    return execFileSync("git", command, { cwd: root, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
};
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const digestOf = (reference) => (reference && /@sha256:[0-9a-f]{64}$/.test(reference) ? reference.split("@")[1] : null);
const images = Object.fromEntries(
  ["web", "worker", "landing", "migration"].map((name) => {
    const reference = process.env[`${name.toUpperCase()}_IMAGE`] || null;
    return [name, { reference, digest: digestOf(reference) }];
  }),
);
const previous = Object.fromEntries(
  String(process.env.PREVIOUS_IMAGES || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.split("=")),
);

const manifest = {
  schema: "vercentlabs-release/1",
  environment: args.environment || process.env.ENVIRONMENT || null,
  commit: process.env.RELEASE_SHA || git("rev-parse", "HEAD"),
  commitSubject: git("log", "-1", "--format=%s"),
  deployedAt: new Date().toISOString(),
  actor: process.env.GITHUB_ACTOR || null,
  run: process.env.GITHUB_RUN_ID ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}` : null,
  images,
  rollbackTarget: Object.keys(previous).length ? previous : null,
  migrations: {
    platform: last(EXPECTED_MIGRATIONS.platform),
    tenant: last(EXPECTED_MIGRATIONS.tenant),
    contracts: {
      platform: last(EXPECTED_MIGRATIONS.contracts.platform),
      tenant: last(EXPECTED_MIGRATIONS.contracts.tenant),
    },
  },
  toolchain: { node: process.version, pnpm: packageJson.engines?.pnpm ?? null },
  verification: process.env.VERIFICATION || null,
};

const problems = [];
for (const [name, image] of Object.entries(images)) if (image.reference && !image.digest) problems.push(`${name} image is not a digest reference`);
if (problems.length) {
  console.error(problems.join("\n"));
  process.exit(1);
}
const text = `${JSON.stringify(manifest, null, 2)}\n`;
if (args.out) fs.writeFileSync(path.resolve(args.out), text);
process.stdout.write(text);
