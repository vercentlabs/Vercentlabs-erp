import { cpSync, existsSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const standaloneDir = path.join(repoRoot, "apps", "landing", ".next", "standalone");
const standaloneServer = path.join(standaloneDir, "apps", "landing", "server.js");
const outputDir = path.join(repoRoot, "dist");

if (!existsSync(standaloneServer)) {
  throw new Error(`Landing standalone server was not generated at ${standaloneServer}`);
}

rmSync(outputDir, { recursive: true, force: true });
cpSync(standaloneDir, outputDir, { recursive: true });
writeFileSync(
  path.join(outputDir, "server.js"),
  '// Hostinger runtime entry point.\nrequire("./apps/landing/server.js");\n',
  "utf8",
);

console.log(`Prepared Hostinger runtime output at ${outputDir}`);
