import { spawnSync } from "node:child_process";

const REQUIRED_NODE_MAJOR = 24;
const REQUIRED_PNPM = "11.21.0";
const testMode = process.env.VERCENTLABS_TOOLCHAIN_TEST_MODE === "1";
const nodeVersion = testMode && process.env.VERCENTLABS_TOOLCHAIN_TEST_NODE_VERSION
  ? process.env.VERCENTLABS_TOOLCHAIN_TEST_NODE_VERSION
  : process.version;

function parseMajor(v) {
  const m = String(v).trim().match(/^v?(\d+)/);
  return m ? Number(m[1]) : NaN;
}

function runVersionCommand(command) {
  // On Windows, Corepack/pnpm are commonly .cmd shims. Running through the
  // platform shell is required for reliable resolution from Git Bash/Node.
  // Commands are fixed constants; no user-controlled text is interpolated.
  const r = spawnSync(command, {
    encoding: "utf8",
    shell: true,
    windowsHide: true,
  });
  const stdout = String(r.stdout || "").trim();
  const stderr = String(r.stderr || "").trim();
  if (r.status === 0 && stdout) {
    return { ok: true, version: stdout.split(/\r?\n/).at(-1).trim() };
  }
  return {
    ok: false,
    detail: [r.error?.message, stdout, stderr].filter(Boolean).join(" | "),
  };
}

function getPnpmVersion() {
  if (testMode && process.env.VERCENTLABS_TOOLCHAIN_TEST_PNPM_VERSION) {
    return process.env.VERCENTLABS_TOOLCHAIN_TEST_PNPM_VERSION.trim();
  }

  const attempts = [];
  for (const command of ["pnpm --version", "corepack pnpm --version"]) {
    const result = runVersionCommand(command);
    if (result.ok) return result.version;
    attempts.push(`${command}: ${result.detail || "command unavailable"}`);
  }
  throw new Error(`Unable to resolve pnpm (${attempts.join("; ")})`);
}

const errors = [];
if (parseMajor(nodeVersion) !== REQUIRED_NODE_MAJOR) {
  errors.push(`Node major must be exactly ${REQUIRED_NODE_MAJOR}; current=${nodeVersion}`);
}
let pnpmVersion = "";
try { pnpmVersion = getPnpmVersion(); }
catch (error) { errors.push(error instanceof Error ? error.message : String(error)); }
if (pnpmVersion && pnpmVersion !== REQUIRED_PNPM) {
  errors.push(`pnpm must be exactly ${REQUIRED_PNPM}; current=${pnpmVersion}`);
}
if (errors.length) {
  console.error("TOOLCHAIN VALIDATION FAILED");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}
console.log("TOOLCHAIN VALIDATION PASSED");
console.log(` - Node: ${nodeVersion}`);
console.log(` - pnpm: ${pnpmVersion}`);
