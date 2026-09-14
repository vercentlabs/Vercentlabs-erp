#!/usr/bin/env node
// Runs every Storybook play() function (interaction tests) AND the a11y
// addon's axe checks (preview.tsx sets a11y.test = "error", so a real
// WCAG violation fails the story, not just a lint warning) against the
// real Vercentlabs component system -- not a demo, the actual production
// token/Tailwind pipeline (see .storybook/preview.tsx). This is the
// SP032 accessibility acceptance gate this pass wires up for
// packages/ui-web; see docs/ux/UI_REWRITE_TRACKER.md.
//
// @storybook/test-runner needs a running Storybook to connect to. Rather
// than depending on a long-lived dev server, this builds the static
// output once and serves it with an IN-PROCESS static file server (plain
// node:http, no child process) on a throwaway port, points the runner at
// that URL, and always closes the listener -- spawning `http-server` as a
// separate child process was tried first and abandoned: on Windows,
// child.kill() only signals the immediate process, and when that child is
// itself a shell wrapper (needed to resolve npx.cmd), the real
// http-server process it spawned survives and keeps the port bound,
// breaking the next run with EADDRINUSE. An in-process server has no
// grandchild to leak.
import { createReadStream, existsSync, statSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const staticDir = path.join(root, "storybook-static");
const PORT = 6116;

const MIME_TYPES = {
  ".html": "text/html", ".js": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png",
  ".map": "application/json", ".woff2": "font/woff2",
};

function serveStatic() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlPath = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
      let filePath = path.join(staticDir, urlPath === "/" ? "index.html" : urlPath);
      if (!existsSync(filePath) || statSync(filePath).isDirectory()) filePath = path.join(staticDir, "index.html");
      res.setHeader("Content-Type", MIME_TYPES[path.extname(filePath)] || "application/octet-stream");
      createReadStream(filePath).pipe(res);
    });
    server.on("error", reject);
    server.listen(PORT, () => resolve(server));
  });
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`))));
    child.on("error", reject);
  });
}

async function main() {
  console.log("Building Storybook (static)...");
  await run("npx", ["storybook", "build", "--quiet"]);

  console.log(`Serving storybook-static on http://localhost:${PORT} (in-process, no child server to leak)...`);
  const server = await serveStatic();

  try {
    console.log("Running Storybook test-runner (interactions + a11y)...");
    await run("npx", ["test-storybook", "--url", `http://localhost:${PORT}`, "--ci"]);
    console.log("All Storybook interaction and accessibility checks passed.");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
