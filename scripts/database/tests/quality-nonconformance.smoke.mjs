// Quality MVP 36 (Nonconformance): an NCR moves OPEN → UNDER_REVIEW → ACTION_REQUIRED → VERIFICATION_PENDING → RESOLVED → CLOSED. Containment,
// root cause and a corrective action come before action is required; every action is done or cancelled before verification; the verifier
// did none of the actions; "not effective" sends it back with a new action; blocking dependencies and a different person close a major NCR;
// reopening keeps the history; permissions, concurrency, company isolation, dashboard, reports, export and search.
//
//   SMOKE_DATABASE=vercentlabs_verify pnpm test:quality-nonconformance     (the database URL comes from apps/web/.env.local MIGRATION_DATABASE_URL)
//
// Everything runs in ONE transaction as the restricted app role and is rolled back.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";

const ROOT = process.env.SMOKE_ROOT ?? fileURLToPath(new URL("../../../", import.meta.url)).replaceAll("\\", "/");
const require = createRequire(ROOT + "package.json");
const pg = require("pg");
const dotenv = require("dotenv");
const api = (path) => import(`file:///${ROOT}services/api/src/${path}`);

const env = dotenv.parse(readFileSync(ROOT + "apps/web/.env.local"));
const url = new URL(env.MIGRATION_DATABASE_URL);
url.pathname = "/" + (process.env.SMOKE_DATABASE || "vercentlabs_verify");
if (/_control$/.test(url.pathname) && process.env.SMOKE_ALLOW_LIVE !== "yes") throw new Error("Refusing to run the Quality suite on the live database. Set SMOKE_DATABASE to a scratch database.");
const client = new pg.Client({ connectionString: url.toString() });
await client.connect();

let passed = 0;
const failures = [];
async function check(name, work) {
  await client.query("SAVEPOINT smoke_check");
  try {
    await work();
    await client.query("RELEASE SAVEPOINT smoke_check");
    passed += 1;
    console.log("  ok   ", name);
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT smoke_check");
    failures.push(name);
    console.log("  FAIL ", name, "\n        ", String(error?.stack || error).split("\n").slice(0, 5).join("\n         "));
  }
}
function assert(condition, message) { if (!condition) throw new Error("assertion failed: " + message); }
async function refused(work, code) {
  await client.query("SAVEPOINT refused");
  try { await work(); } catch (error) { await client.query("ROLLBACK TO SAVEPOINT refused"); if (code && error.code !== code) throw new Error(`expected ${code}, got ${error.code}: ${error.message}`); return error; }
  await client.query("RELEASE SAVEPOINT refused");
  throw new Error(`expected rejection ${code ?? ""}`);
}

try {
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE vercent_app");
  const { registerOrganization } = await api("core/organization/registration.js");
  const tag = Math.random().toString(16).slice(2, 10);
  const register = (name) => registerOrganization(client, {
    fullName: "Smoke Owner", email: `${name}-${tag}@example.test`, password: "Tr1al-Workspace-Passphrase!", organizationName: `${name} ${tag}`, countryCode: "IN", baseCurrency: "INR",
    timezone: "Asia/Kolkata",
  });
  const other = await register("otherncr");
  const registered = await register("ncr");
  const organizationId = registered.organizationId;
  const switchTo = (org) => client.query("SELECT set_config('app.current_organization_id', $1, true)", [org]);
  await switchTo(organizationId);
  async function contextFor(userId, org = organizationId) {
    const { rows } = await client.query(
      `SELECT COALESCE(array_agg(DISTINCT role.slug), ARRAY[]::text[]) AS role_slugs,
              COALESCE(array_agg(DISTINCT grant_row.permission_key) FILTER (WHERE grant_row.permission_key IS NOT NULL), ARRAY[]::text[]) AS permissions
         FROM user_role_assignments assignment JOIN roles role ON role.id = assignment.role_id
         LEFT JOIN role_permissions grant_row ON grant_row.role_id = role.id
        WHERE assignment.organization_id = $1 AND assignment.user_id = $2`, [org, userId]);
    return { organizationId: org, userId, roleSlugs: rows[0].role_slugs, permissions: rows[0].permissions };
  }
  async function addMember(roleSlug, name) {
    const id = (await client.query(`INSERT INTO users (id, email, full_name, password_hash, status) VALUES (gen_random_uuid(), $1, $2, 'x', 'active') RETURNING id`,
      [`${name.split(" ")[0].toLowerCase()}-${tag}@example.test`, name])).rows[0].id;
    await client.query(`INSERT INTO organization_memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'member', 'active')`, [organizationId, id]);
    await client.query(`INSERT INTO user_role_assignments (organization_id, user_id, role_id, is_primary, status) SELECT $1, $2, id, true, 'active' FROM roles WHERE organization_id = $1 AND slug = $3`,
      [organizationId, id, roleSlug]);
    return contextFor(id);
  }
  const owner = await contextFor(registered.userId);
  const qm = await addMember("quality_manager", "Rita Manager");
  const qm2 = await addMember("quality_manager", "Ivy Closer");
  const sup = await addMember("quality_supervisor", "Zoya Supervisor");
  const ins = await addMember("quality_inspector", "Yusuf Inspector");
  const buyer = await addMember("purchase_manager", "Bina Buyer");
  const auditor = await addMember("auditor", "Arun Auditor");
  const nc = await api("modules/quality/nonconformance/index.js");
  const nos = (await client.query(`INSERT INTO tenant.units_of_measure (organization_id, code, name, category, decimal_places) VALUES ($1, 'NOS', 'Numbers', 'quantity', 0)
    ON CONFLICT (organization_id, code) DO UPDATE SET decimal_places = 0 RETURNING id`, [organizationId])).rows[0].id;
  const item = (await client.query(`INSERT INTO tenant.items (organization_id, code, name, item_type, uom_id, track_inventory) VALUES ($1, 'VALVE-01', 'Brass Valve', 'product', $2, true) RETURNING id`,
    [organizationId, nos])).rows[0].id;
  const get = (id, ctx = qm) => nc.getNonconformance(client, ctx, id);
  const step = async (fn, ctx, id, input = {}) => { const d = await get(id); return fn(client, ctx, id, { version: d.rowVersion, ...input }); };
  const raise = (ctx, extra = {}) => nc.createNonconformance(client, ctx, { title: "Valve thread out of tolerance", description: "Thread gauge fails on 20 of 200 valves", severity: "major",
    sourceType: "supplier", items: [{ itemId: item, quantity: 20 }], ownerUserId: sup.userId, ...extra });

  let main;
  await check("N1. Raising an NCR: number, affected population, owner, idempotent; an invalid severity or an owner outside the company is refused", async () => {
    main = await raise(ins, { idempotencyKey: `k-${tag}` });
    const again = await raise(ins, { idempotencyKey: `k-${tag}` });
    assert(/^NC/.test(main.nonconformance_number) && main.status === "OPEN" && again.replayed && again.id === main.id, JSON.stringify(main));
    const d = await get(main.id);
    assert(d.items.length === 1 && d.items[0].quantity === 20 && d.affected === 20 && d.owner.id === sup.userId && d.severity === "major", JSON.stringify(d.items));
    await refused(() => raise(ins, { severity: "catastrophic" }), "QUALITY_NC_INVALID");
    await refused(() => raise(ins, { ownerUserId: other.userId }), "QUALITY_NC_INVALID");
    await refused(() => raise(buyer), "QUALITY_NC_ACCESS_DENIED");
  });

  let correctiveId;
  await check("N2. The review: containment, root cause and a corrective action are required before action is required; each step is recorded", async () => {
    await step(nc.startNonconformanceReview, sup, main.id);
    await refused(() => step(nc.requireNonconformanceAction, sup, main.id), "QUALITY_NC_CONTAINMENT_REQUIRED");
    await step(nc.recordNonconformanceContainment, sup, main.id, { containmentAction: "All 200 valves of lot V-118 moved to quarantine; open POs paused", containmentDue: "2026-10-25" });
    await refused(() => step(nc.requireNonconformanceAction, sup, main.id), "QUALITY_NC_ROOT_CAUSE_REQUIRED");
    await step(nc.recordNonconformanceInvestigation, sup, main.id, { method: "FIVE_WHYS", rootCause: "Supplier changed the thread-rolling die without notice", summary: "Supplier visit 22 Oct" });
    await nc.addNonconformanceAction(client, sup, main.id, { actionType: "CONTAINMENT", description: "Sort the quarantined lot with the go / no-go gauge", ownerUserId: ins.userId });
    await refused(() => step(nc.requireNonconformanceAction, sup, main.id), "QUALITY_NC_ACTION_REQUIRED");
    correctiveId = (await nc.addNonconformanceAction(client, sup, main.id, { actionType: "CORRECTIVE", description: "Supplier to requalify the new die (first-article report)", ownerUserId: buyer.userId,
      dueDate: "2026-11-05" })).id;
    await nc.addNonconformanceAction(client, sup, main.id, { actionType: "PREVENTIVE", description: "Add change notification to the supplier quality agreement", ownerUserId: buyer.userId });
    await step(nc.requireNonconformanceAction, sup, main.id);
    const d = await get(main.id);
    assert(d.status === "ACTION_REQUIRED" && d.containment && d.investigation.methodLabel === "5 Whys" && d.actions.length === 3, JSON.stringify(d.actions.map((a) => a.type)));
  });

  await check("N3. Actions: the action's owner completes it without managing NCRs; completion needs a note; evidence must belong to the NCR; a cancelled action needs a reason; verification waits until none is open", async () => {
    const d = await get(main.id);
    const [contain, , preventive] = d.actions;
    await refused(() => nc.completeNonconformanceAction(client, buyer, main.id, { actionId: correctiveId }), "QUALITY_NC_EVIDENCE_REQUIRED");
    await refused(() => nc.completeNonconformanceAction(client, buyer, main.id, { actionId: correctiveId, note: "Done", evidenceFileIds: [randomUUID()] }), "QUALITY_NC_INVALID");
    await refused(() => nc.completeNonconformanceAction(client, buyer, main.id, { actionId: contain.id, note: "Not mine" }), "QUALITY_NC_ACCESS_DENIED");
    await nc.completeNonconformanceAction(client, buyer, main.id, { actionId: correctiveId, note: "First-article report FA-77 accepted" });
    await nc.completeNonconformanceAction(client, ins, main.id, { actionId: contain.id, note: "Sorted: 20 rejected, 180 good" });
    await refused(() => step(nc.submitNonconformanceForVerification, sup, main.id), "QUALITY_NC_ACTIONS_OPEN");
    await refused(() => nc.cancelNonconformanceAction(client, sup, main.id, { actionId: preventive.id }), "QUALITY_NC_REASON_REQUIRED");
    await nc.cancelNonconformanceAction(client, sup, main.id, { actionId: preventive.id, reason: "Moved to the supplier development plan" });
    await step(nc.submitNonconformanceForVerification, sup, main.id);
    assert((await get(main.id)).status === "VERIFICATION_PENDING", "pending verification");
  });

  await check("N4. Verification: someone who did an action doesn't verify; 'not effective' returns the NCR with a new action; then effective, with the resolution", async () => {
    await refused(() => step(nc.verifyNonconformance, ins, main.id, { effective: true, summary: "x", resolution: "y" }), "QUALITY_NC_ACCESS_DENIED");
    const inspectorVerifier = { ...ins, permissions: [...ins.permissions, "quality.nonconformance.verify"] };
    await refused(() => step(nc.verifyNonconformance, inspectorVerifier, main.id, { effective: true, summary: "x", resolution: "y" }), "QUALITY_NC_SELF_VERIFICATION");
    await refused(() => step(nc.verifyNonconformance, qm, main.id, { effective: false, summary: "Next lot still fails" }), "QUALITY_NC_ACTION_REQUIRED");
    await step(nc.verifyNonconformance, qm, main.id, { effective: false, summary: "Lot V-121 still has 4 failures", newAction: { actionType: "CORRECTIVE", description: "Supplier to replace the die", ownerUserId: buyer.userId } });
    let d = await get(main.id);
    assert(d.status === "ACTION_REQUIRED" && d.actions.filter((a) => a.effectiveness === "NOT_EFFECTIVE").length >= 1 && d.actions.length === 4, JSON.stringify(d.actions.map((a) => [a.status, a.effectiveness])));
    await nc.completeNonconformanceAction(client, buyer, main.id, { actionId: d.actions[3].id, note: "New die installed; FA-79 accepted" });
    await step(nc.submitNonconformanceForVerification, sup, main.id);
    await step(nc.verifyNonconformance, qm, main.id, { effective: true, summary: "Lots V-122 to V-125 inspected: no failures", resolution: "New die; change notification agreed" });
    d = await get(main.id);
    assert(d.status === "RESOLVED" && d.resolution.summary.includes("New die") && d.verification.by === "Rita Manager", JSON.stringify(d.verification));
  });

  await check("N5. Closure: a blocking dependency must be settled; the owner doesn't close a major NCR; reopening keeps everything; an NCR with work done isn't cancelled, a fresh one is", async () => {
    await nc.addNonconformanceLink(client, sup, main.id, { linkType: "SUPPLIER_CLAIM", reference: "SC-0042", note: "Debit for sorting cost", blocksClosure: true });
    await nc.addNonconformanceLink(client, sup, main.id, { linkType: "OTHER", reference: "Audit note", blocksClosure: false });
    await refused(() => step(nc.closeNonconformance, qm2, main.id, { note: "Done" }), "QUALITY_NC_DEPENDENCY_OPEN");
    const link = (await get(main.id)).dependencies.find((x) => x.reference === "SC-0042");
    await nc.completeNonconformanceLink(client, sup, main.id, { linkId: link.id, note: "Supplier accepted debit note DN-7" });
    const ownerCloser = { ...sup, permissions: [...sup.permissions, "quality.nonconformance.close"] };
    await refused(() => step(nc.closeNonconformance, ownerCloser, main.id, { note: "Done" }), "QUALITY_NC_SELF_CLOSURE");
    await refused(() => step(nc.closeNonconformance, qm2, main.id, {}), "QUALITY_NC_REASON_REQUIRED");
    await step(nc.closeNonconformance, qm2, main.id, { note: "Verified effective; claim settled" });
    assert((await get(main.id)).status === "CLOSED", "closed");
    await step(nc.reopenNonconformance, qm2, main.id, { reason: "Customer complaint on lot V-126" });
    const d = await get(main.id);
    assert(d.status === "UNDER_REVIEW" && d.reopened === 1 && d.actions.length === 4 && d.history.some((h) => h.type === "quality.nonconformance.closed"), JSON.stringify({ s: d.status, r: d.reopened }));
    await refused(() => step(nc.cancelNonconformance, sup, main.id, { reason: "x" }), "QUALITY_NC_STATE");
    const fresh = await raise(ins, { severity: "minor" });
    await refused(() => step(nc.cancelNonconformance, sup, fresh.id, {}), "QUALITY_NC_REASON_REQUIRED");
    await step(nc.cancelNonconformance, sup, fresh.id, { reason: "Raised twice" });
    assert((await get(fresh.id)).status === "CANCELLED", "cancelled");
  });

  await check("N6. Keys, concurrency and isolation: an auditor sees but doesn't change; an inspector doesn't close; a stale version is refused; another company sees nothing", async () => {
    const d = await get(main.id, auditor);
    assert(d.number && !d.can.edit && !d.can.close, JSON.stringify(d.can));
    await refused(() => nc.addNonconformanceAction(client, auditor, main.id, { actionType: "CORRECTIVE", description: "x" }), "QUALITY_NC_ACCESS_DENIED");
    await refused(() => step(nc.closeNonconformance, ins, main.id, { note: "x" }), "QUALITY_NC_ACCESS_DENIED");
    await refused(() => nc.updateNonconformance(client, sup, main.id, { version: 1, title: "Stale" }), "QUALITY_NC_CONCURRENT_CHANGE");
    await switchTo(other.organizationId);
    const outsider = await contextFor(other.userId, other.organizationId);
    assert((await nc.listNonconformances(client, outsider, {})).length === 0, "another company");
    await refused(() => nc.getNonconformance(client, outsider, main.id), "QUALITY_NC_NOT_FOUND");
    await switchTo(organizationId);
  });

  await check("N7. Queues, dashboard, the eleven reports, the export and search agree with the NCRs and their actions", async () => {
    const counts = await nc.getNonconformanceCounts(client, qm);
    const mine = await nc.listNonconformances(client, sup, { view: "mine" });
    assert(counts.review >= 1 && counts.cancelled === 1 && mine.some((r) => r.id === main.id), JSON.stringify(counts));
    const dash = await nc.getNonconformanceDashboard(client, qm);
    assert(dash.ineffectiveActions >= 1 && dash.reopened === 1 && dash.counts.open >= 1, JSON.stringify(dash));
    for (const kind of Object.keys(nc.NC_REPORTS)) {
      const r = await nc.getNonconformanceReport(client, qm, kind);
      assert(Array.isArray(r.rows) && r.title, kind);
    }
    const eff = await nc.getNonconformanceReport(client, qm, "effectiveness");
    assert(eff.rows.some((r) => r.effectiveness === "NOT_EFFECTIVE") && eff.rows.some((r) => r.effectiveness === "EFFECTIVE"), JSON.stringify(eff.rows.slice(0, 2)));
    const csv = await nc.exportNonconformanceReport(client, qm, "register");
    assert(csv.body.split("\n")[0].includes("ncr") && csv.body.includes(main.nonconformance_number), csv.body.split("\n")[0]);
    await refused(() => nc.exportNonconformanceReport(client, ins, "register"), "QUALITY_NC_ACCESS_DENIED");
    assert((await nc.listNonconformances(client, qm, { search: "thread" })).some((r) => r.id === main.id), "search");
    const opts = await nc.listNonconformanceOptions(client, qm);
    assert(opts.members.length >= 6 && opts.actionTypes.length === 4 && opts.canCreate, "options");
  });
} finally {
  await client.query("ROLLBACK").catch(() => null);
  await client.end();
}
console.log(`\n${passed} passed, ${failures.length} failed (transaction rolled back: the database is unchanged)`);
if (failures.length) process.exitCode = 1;
