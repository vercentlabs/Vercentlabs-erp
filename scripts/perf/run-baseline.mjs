#!/usr/bin/env node
// pnpm perf:baseline — runs scripts/perf/k6-baseline.js in the pinned k6
// container (no local k6 install). Environment passed through: BASE_URL,
// ORIGIN, EMAIL, PASSWORD, API_KEY, VUS, DURATION. The JSON summary is written
// to reports/perf/k6-summary-<timestamp>.json (gitignored reports/ path is
// fine to keep locally; commit a curated baseline to docs/operations).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const K6_IMAGE = "grafana/k6:1.3.0@sha256:3ddc8b1a33a2c3d8edc6e99b6a762ae36cba08788463458f5e6a7703e14eb77d";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const outputDirectory = path.join(root, "reports", "perf");
fs.mkdirSync(outputDirectory, { recursive: true });
const summary = `k6-summary-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
for (const name of ["BASE_URL", "EMAIL", "PASSWORD"]) {
  if (!process.env[name]) {
    console.error(`${name} is required.`);
    process.exit(2);
  }
}
const env = ["BASE_URL", "ORIGIN", "EMAIL", "PASSWORD", "API_KEY", "VUS", "DURATION"].flatMap((name) => (process.env[name] ? ["-e", `${name}=${process.env[name]}`] : []));
const result = spawnSync(
  "docker",
  [
    "run", "--rm",
    ...(process.platform === "linux" ? ["--add-host", "host.docker.internal:host-gateway"] : []),
    "-v", `${path.join(root, "scripts", "perf")}:/scripts:ro`,
    "-v", `${outputDirectory}:/out`,
    ...env,
    K6_IMAGE, "run", "--summary-export", `/out/${summary}`, "/scripts/k6-baseline.js",
  ],
  { stdio: "inherit" },
);
console.log(`Summary: reports/perf/${summary}`);
process.exit(result.status ?? 1);
