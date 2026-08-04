import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import test from "node:test";

import {
  attachmentStorageKey,
  sanitizeFileName,
  validateAttachment,
} from "../../packages/document-engine/src/index.js";
import { redact } from "../../packages/observability/src/index.js";
import { csvCell } from "../../packages/reporting-engine/src/index.js";

function bashExecutable() {
  if (process.platform !== "win32") return "bash";

  const located = spawnSync("where.exe", ["git.exe"], { encoding: "utf8" });
  if (located.status === 0) {
    for (const gitPath of located.stdout.split(/\r?\n/).filter(Boolean)) {
      const candidate = path.resolve(path.dirname(gitPath), "../bin/bash.exe");
      if (existsSync(candidate)) return candidate;
    }
  }

  return "bash";
}

test("exports, logs and attachment paths reject common data-boundary attacks", () => {
  assert.match(csvCell('=HYPERLINK("https://invalid")'), /'=/);
  assert.deepEqual(redact({ password: "secret", safe: "visible" }), {
    password: "[REDACTED]",
    safe: "visible",
  });
  assert.equal(sanitizeFileName("../../payroll.csv"), "..-..-payroll.csv");
  assert.throws(
    () =>
      validateAttachment({
        fileName: "payload.svg",
        mimeType: "image/svg+xml",
        sizeBytes: 128,
      }),
    TypeError,
  );
  const key = attachmentStorageKey({
    organizationId: "018f1ec7-49c3-4a52-8c4e-52e164537b21",
    attachmentId: "018f1ec7-49c3-4a52-8c4e-52e164537b22",
    fileName: "../../quote.pdf",
  });
  assert.equal(key.includes(".."), false);
});

test("source exports include reproducibility files without native build output", () => {
  const projectRoot = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../..",
  );
  const temporaryRoot = path.join(projectRoot, "tmp");
  mkdirSync(temporaryRoot, { recursive: true });
  const directory = mkdtempSync(
    path.join(temporaryRoot, "vercentlabs-source-export-"),
  );
  const staleDirectory = mkdtempSync(
    path.join(projectRoot, "vercentlabs-source-export-regression-"),
  );
  writeFileSync(
    path.join(staleDirectory, "project-code.txt"),
    "# Project source export\n\nFILE: apps/mobile/android/app/build.gradle\n",
  );
  const output = path.join(directory, "project-code.txt");
  const relativeOutput = path
    .relative(projectRoot, output)
    .split(path.sep)
    .join("/");
  try {
    const result = spawnSync(
      bashExecutable(),
      ["export-project-code.sh", relativeOutput],
      { cwd: projectRoot, encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const source = readFileSync(output, "utf8");
    assert.match(source, /^FILE: apps\/web\/\.env\.example$/m);
    assert.match(source, /^FILE: pnpm-lock\.yaml$/m);
    assert.doesNotMatch(source, /^FILE: apps\/mobile\/android\//m);
    assert.doesNotMatch(
      source,
      /^FILE: vercentlabs-source-export-regression-/m,
    );
    assert.doesNotMatch(source, /^FILE: .*\.env\.local$/m);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(staleDirectory, { recursive: true, force: true });
  }
});
