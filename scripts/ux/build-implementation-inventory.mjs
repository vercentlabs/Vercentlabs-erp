// Builds docs/implementation/{routes,feature-status,requirement-matrix}.csv and counts.json from the real repository.
//
// Honesty rule: this script never emits VERIFIED_COMPLETE. It can only see that source cites a feature id, that a route
// page exists, and whether a test file mentions the feature or route. That is evidence to review, not proof of
// behaviour. A person or a passing acceptance run promotes a status; the generator reports at most
// IMPLEMENTED_UNVERIFIED.
import { readFileSync, readdirSync, existsSync, statSync, mkdirSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { execSync } from "node:child_process";

import { parseCsv } from "./csv.mjs";

const root = process.cwd();
const out = join(root, "docs", "implementation");
mkdirSync(out, { recursive: true });

const slash = (p) => p.split("\\").join("/");
const rel = (p) => slash(relative(root, p));

function readTable(path) {
  const rows = parseCsv(readFileSync(join(root, path), "utf8")).filter((r) => r.length > 1);
  const [header, ...body] = rows;
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}
function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.split('"').join('""')}"` : s;
}
function writeCsv(name, header, rows) {
  writeFileSync(join(out, name), [header.join(","), ...rows.map((r) => header.map((h) => csvCell(r[h])).join(","))].join("\n") + "\n");
}
function walk(dir, filter, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, filter, acc);
    else if (filter(p)) acc.push(p);
  }
  return acc;
}
const isTestFile = (p) => /\.(test|spec)\.[a-z]+$/.test(p);

const commit = execSync("git rev-parse HEAD", { cwd: root }).toString().trim();

// ---- registers
const features = readTable("docs/02-register/FEATURE_REGISTER.csv");
const semantic = readTable("docs/02-register/FEATURE_SEMANTIC_SUBCAPABILITY_REGISTER.csv");
const requirements = readTable("docs/02-register/SUBREQUIREMENT_REGISTER.csv");
const flows = readTable("docs/02-register/FEATURE_FLOW_REGISTER.csv");
const transitions = readTable("docs/02-register/FEATURE_STATE_TRANSITION_REGISTER.csv");
const capabilities = readTable("docs/02-register/CAPABILITY_REGISTER.csv");
const shared = readTable("docs/04-shared-platform/SP_SUBREQUIREMENT_REGISTER.csv");
const ux = readTable("docs/ux/UX_TRACEABILITY_REGISTER.csv");
const dupes = (rows, key) => rows.length - new Set(rows.map((r) => r[key])).size;

// ---- routes
const navSource = readFileSync(join(root, "apps/web/src/shell/navigation/module-navigation-registry.ts"), "utf8");
const navEntries = [...navSource.matchAll(/\b(available|planned|adminOnly)\(\s*"([^"]+)"\s*,\s*"([^"]+)"/g)].map((m) => ({
  declared: m[1] === "available" ? "AVAILABLE" : m[1] === "planned" ? "PLANNED" : "ADMIN_ONLY",
  label: m[2],
  route: m[3],
}));
const appDir = join(root, "apps/web/src/app");
const pageRoutes = new Set(
  walk(appDir, (p) => p.endsWith("page.tsx"))
    .map((p) => slash(relative(appDir, p)).replace(/\/?page\.tsx$/, ""))
    .map((p) => "/" + p.split("/").filter((seg) => seg && !(seg.startsWith("(") && seg.endsWith(")"))).join("/")),
);
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const segmentPattern = (seg) => (seg.startsWith("[...") || seg.startsWith("[[...") ? ".+" : seg.startsWith("[") ? "[^/]+" : escapeRe(seg));
const dynamicPatterns = [...pageRoutes].filter((r) => r.includes("[")).map((r) => new RegExp("^" + r.split("/").map(segmentPattern).join("/") + "$"));
// A [page] catch-all only serves the slugs its page table declares; any other slug is a 404, so read the table.
const catchAllSlugs = new Map();
for (const r of pageRoutes) {
  if (!r.endsWith("/[page]")) continue;
  const file = walk(appDir, (p) => slash(p).endsWith(r + "/page.tsx"))[0];
  const src = file ? readFileSync(file, "utf8") : "";
  const tableImport = src.match(/import\s*\{[^}]*\b([A-Z_]+_PAGES)\b[^}]*\}\s*from\s*"@\/([^"]+)"/);
  if (!tableImport) continue;
  const base = join(root, "apps/web/src", tableImport[2]);
  const tableFile = [".ts", ".tsx", "/index.ts"].map((ext) => base + ext).find((p) => existsSync(p));
  if (!tableFile) continue;
  const body = readFileSync(tableFile, "utf8");
  const start = body.indexOf(tableImport[1]);
  const keys = new Set([...body.slice(start).matchAll(/^\s{2}"?([a-z0-9][a-z0-9-]*)"?\s*:\s*\{/gm)].map((m) => m[1]));
  catchAllSlugs.set(r.slice(0, -"/[page]".length), keys);
}
const routeResolves = (route) => {
  if (pageRoutes.has(route)) return true;
  const parent = route.slice(0, route.lastIndexOf("/"));
  const slug = route.slice(route.lastIndexOf("/") + 1);
  if (catchAllSlugs.has(parent)) return catchAllSlugs.get(parent).has(slug);
  return dynamicPatterns.some((re) => re.test(route));
};

const specs = walk(join(root, "apps/web/e2e"), (p) => p.endsWith(".spec.ts")).map((p) => ({ file: rel(p), text: readFileSync(p, "utf8") }));
const unitTests = [...walk(join(root, "apps/web/src"), isTestFile), ...walk(join(root, "services/api"), isTestFile), ...walk(join(root, "tests"), isTestFile)];
const unitTexts = unitTests.map((p) => ({ file: rel(p), text: readFileSync(p, "utf8") }));

const routeRows = navEntries.map((e) => {
  const exists = routeResolves(e.route);
  return {
    route: e.route,
    label: e.label,
    declared_status: e.declared,
    page_exists: exists ? "yes" : "no",
    e2e_specs: [...new Set(specs.filter((s) => s.text.includes(e.route)).map((s) => s.file))].join(";"),
    finding: e.declared === "AVAILABLE" && !exists ? "AVAILABLE_WITHOUT_PAGE" : e.declared === "PLANNED" && exists ? "PAGE_EXISTS_BUT_NAV_SAYS_PLANNED" : "",
  };
});
writeCsv("routes.csv", ["route", "label", "declared_status", "page_exists", "e2e_specs", "finding"], routeRows);

// ---- feature evidence: which source cites each feature id
function scanIds(files) {
  const map = new Map();
  for (const p of files) {
    const text = readFileSync(p, "utf8");
    for (const id of new Set(text.match(/\bF\d{3}\b/g) ?? [])) {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(rel(p));
    }
  }
  return map;
}
const webMentions = scanIds(walk(join(root, "apps/web/src"), (p) => /\.tsx?$/.test(p) && !isTestFile(p)));
const apiMentions = scanIds(walk(join(root, "services/api/src"), (p) => /\.(m?js|ts)$/.test(p) && !isTestFile(p)));

const capOf = new Map();
for (const c of capabilities) for (const f of c.feature_ids.split(";")) capOf.set(f, c.capability_id);

const featureRows = features.map((f) => {
  const web = webMentions.get(f.feature_id) ?? [];
  const api = apiMentions.get(f.feature_id) ?? [];
  const status = web.length > 0 ? "IMPLEMENTED_UNVERIFIED" : api.length > 0 ? "PARTIAL" : "NOT_STARTED";
  return {
    feature_id: f.feature_id,
    module: f.module,
    feature_name: f.feature_name,
    capability_id: capOf.get(f.feature_id) ?? "",
    web_source_files: web.length,
    api_source_files: api.length,
    sample_web_file: web[0] ?? "",
    e2e_mentions: [...new Set(specs.filter((s) => s.text.includes(f.feature_id)).map((s) => s.file))].join(";"),
    unit_mentions: [...new Set(unitTexts.filter((s) => s.text.includes(f.feature_id)).map((s) => s.file))].join(";"),
    register_claims: `${f.implementation_status}/${f.product_status} (reference only)`,
    status,
    notes:
      web.length > 0
        ? "Web source cites this feature id; behaviour not yet verified by an acceptance run"
        : api.length > 0
          ? "Only backend source cites this id; no web surface found"
          : "No source cites this feature id (it may still be built without citing it); needs review",
  };
});
writeCsv("feature-status.csv", ["feature_id", "module", "feature_name", "capability_id", "web_source_files", "api_source_files", "sample_web_file", "e2e_mentions", "unit_mentions", "register_claims", "status", "notes"], featureRows);
const featureStatus = new Map(featureRows.map((r) => [r.feature_id, r]));

const uxById = new Map(ux.map((r) => [r.requirement_id, r]));
const matrixRows = requirements.map((r) => {
  const f = featureStatus.get(r.feature_id);
  const u = uxById.get(r.requirement_id);
  return {
    requirement_id: r.requirement_id,
    feature_id: r.feature_id,
    capability_id: r.capability_id,
    module: f?.module ?? "",
    requirement_type: r.requirement_type,
    priority: r.priority,
    ui_relevance: u?.ui_relevance ?? "",
    test_ids: r.test_ids,
    status: f?.status ?? "NOT_STARTED",
  };
});
writeCsv("requirement-matrix.csv", ["requirement_id", "feature_id", "capability_id", "module", "requirement_type", "priority", "ui_relevance", "test_ids", "status"], matrixRows);

const tally = (rows, key) => rows.reduce((a, r) => ((a[r[key]] = (a[r[key]] ?? 0) + 1), a), {});
const moduleStatus = {};
for (const r of featureRows) {
  moduleStatus[r.module] ??= {};
  moduleStatus[r.module][r.status] = (moduleStatus[r.module][r.status] ?? 0) + 1;
}
const counts = {
  commit,
  generated_by: "scripts/ux/build-implementation-inventory.mjs",
  registers: {
    features: features.length,
    semantic_subcapabilities: semantic.length,
    requirements: requirements.length,
    flows: flows.length,
    state_transitions: transitions.length,
    capabilities: capabilities.length,
    shared_platform_rows: shared.length,
    ux_traceability_rows: ux.length,
    duplicate_requirement_ids: dupes(requirements, "requirement_id"),
    duplicate_feature_ids: dupes(features, "feature_id"),
    ux_rows_minus_requirements_and_shared: ux.length - (requirements.length + shared.length),
  },
  routes: { registry_entries: routeRows.length, ...tally(routeRows, "declared_status"), page_exists: routeRows.filter((r) => r.page_exists === "yes").length, findings: tally(routeRows.filter((r) => r.finding), "finding") },
  feature_status: tally(featureRows, "status"),
  feature_status_by_module: moduleStatus,
  requirement_status: tally(matrixRows, "status"),
  ux_relevance: tally(ux, "ui_relevance"),
  e2e_spec_files: specs.length,
};
writeFileSync(join(out, "counts.json"), JSON.stringify(counts, null, 2) + "\n");
console.log(JSON.stringify(counts, null, 2));
