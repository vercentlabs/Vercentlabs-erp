// A server component may render a client component, but it cannot CALL a
// function (or read a value) exported from a "use client" module — Next.js
// fails at runtime ("Attempted to call X() from the server but X is on the
// client"), which neither typecheck nor unit tests catch. Server pages here
// may import only components (capitalised names) and types from client
// modules; shared helpers belong in a plain module.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const appDir = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.resolve(appDir, "..");

function walk(directory: string): string[] {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const isClientModule = (source: string) =>
  /^\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*["']use client["']/.test(source);

function resolveImport(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? path.join(srcDir, specifier.slice(2))
    : specifier.startsWith(".")
      ? path.resolve(path.dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    path.join(base, "index.ts"),
    path.join(base, "index.tsx"),
  ])
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile())
      return candidate;
  return null;
}

test("server pages never call functions exported from client modules", () => {
  const problems: string[] = [];
  const pages = walk(appDir).filter((file) => /(page|layout)\.tsx$/.test(file));
  for (const page of pages) {
    const source = fs.readFileSync(page, "utf8");
    if (isClientModule(source)) continue;
    for (const match of source.matchAll(
      /import\s+\{([^}]+)\}\s+from\s+["']([^"']+)["']/g,
    )) {
      const target = resolveImport(page, match[2]);
      if (!target || !isClientModule(fs.readFileSync(target, "utf8"))) continue;
      const names = match[1]
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part && !part.startsWith("type "))
        .map((part) =>
          part
            .split(/\s+as\s+/)
            .pop()!
            .trim(),
        );
      for (const name of names)
        if (!/^[A-Z]/.test(name))
          problems.push(
            `${path.relative(srcDir, page)} imports "${name}" from client module ${match[2]}`,
          );
    }
  }
  assert.deepEqual(problems, []);
});
