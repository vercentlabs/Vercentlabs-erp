import assert from "node:assert/strict";
import test from "node:test";
import { ERP_MODULE_CATALOG } from "@vercentlabs/shared-types";
import * as content from "../src/index.js";

const {
  LAUNCH_CAPABILITIES,
  LAUNCH_CAPABILITY_COUNTS,
  LAUNCH_CAPABILITY_OWNERS,
  LAUNCH_CAPABILITY_TOTAL,
  LAUNCH_CAPABILITY_SUMMARY,
  LAUNCH_BUSINESS_MODULE_COUNT,
  SHARED_PLATFORM_KEY,
  getLaunchCapability,
  launchCapabilityNames,
  getRoutedWorkflows,
} = content;

// The product owner's approved MVP list. These per-owner numbers are the
// approved definition; the register must reproduce them exactly.
const APPROVED_COUNTS = {
  crm: 16,
  sales: 15,
  procurement: 9,
  stock: 17,
  manufacturing: 10,
  projects: 9,
  assets: 13,
  "point-of-sale": 19,
  quality: 12,
  support: 14,
  "hr-payroll": 23,
  accounting: 19,
  [SHARED_PLATFORM_KEY]: 46,
};

test("each owner has exactly its approved number of launch capabilities", () => {
  assert.deepEqual({ ...LAUNCH_CAPABILITY_COUNTS }, APPROVED_COUNTS);
});

test("the total is 222 and is derived from the register, not typed separately", () => {
  assert.equal(LAUNCH_CAPABILITY_TOTAL, 222);
  assert.equal(LAUNCH_CAPABILITY_TOTAL, LAUNCH_CAPABILITIES.length);
  assert.equal(
    Object.values(LAUNCH_CAPABILITY_COUNTS).reduce((sum, count) => sum + count, 0),
    LAUNCH_CAPABILITY_TOTAL,
  );
  assert.equal(LAUNCH_CAPABILITY_SUMMARY, "222 approved MVP capabilities across 12 business modules and the Shared Platform");
});

// Semantic fidelity, not just arithmetic: the counts above could be hit by
// splitting or merging approved capabilities. These pin the approved
// boundaries where that has already gone wrong once or is easy to get wrong.
const namesFor = (ownerKey) => content.getLaunchCapabilitiesForOwner(ownerKey).map((capability) => capability.name);
const occurrences = (names, name) => names.filter((candidate) => candidate === name).length;

test("Shared Platform keeps the approved capability boundaries", () => {
  const platform = namesFor(SHARED_PLATFORM_KEY);
  for (const name of ["Loading / Empty / Error States", "Monitoring", "Health Checks", "Responsive UI", "Permission-Aware Navigation"]) {
    assert.equal(occurrences(platform, name), 1, `Shared Platform must contain exactly one "${name}"`);
  }
  for (const split of ["Loading States", "Empty States", "Error States", "Monitoring / Health Checks"]) {
    assert.equal(occurrences(platform, split), 0, `"${split}" is not an approved Shared Platform capability`);
  }
  assert.equal(getLaunchCapability("platform-loading-empty-error-states")?.name, "Loading / Empty / Error States");
  assert.equal(getLaunchCapability("platform-monitoring")?.name, "Monitoring");
  assert.equal(getLaunchCapability("platform-health-checks")?.name, "Health Checks");
  assert.equal(getLaunchCapability("platform-responsive-ui")?.name, "Responsive UI");
  assert.equal(getLaunchCapability("platform-permission-aware-navigation")?.name, "Permission-Aware Navigation");
  assert.equal(platform.length, 46);
});

test("Shared Platform matches the approved list exactly, in order", () => {
  assert.deepEqual(namesFor(SHARED_PLATFORM_KEY), [
    "Tenant Management", "Company Management", "Authentication", "Login / Logout", "Forgot / Reset Password",
    "Session Management", "User Management", "User Invitation", "Activation / Deactivation", "Roles", "Permissions",
    "Record-Level Access", "Company / Branch Access", "Module Enable / Disable", "Subscription / Plan Enforcement",
    "Company Settings", "Currency", "Timezone", "Date / Time Formats", "Tax Configuration", "Document Numbering",
    "PDF / Print Infrastructure", "Comments", "Attachments", "Activity History", "Notifications", "Audit Logs", "Import",
    "Export", "Search", "Filtering", "Sorting", "Pagination", "Validation", "Transaction Safety", "Idempotency",
    "Concurrency Protection", "Error Handling", "Loading / Empty / Error States", "Backups", "Restore Process", "Logging",
    "Monitoring", "Health Checks", "Responsive UI", "Permission-Aware Navigation",
  ]);
});

test("POS payments are exactly three capabilities: Cash, Card, and UPI / Digital", () => {
  const pos = namesFor("point-of-sale");
  const tenderCapabilities = pos.filter((name) => /^(Cash|Card|UPI|Digital)\b/.test(name));
  assert.deepEqual(tenderCapabilities, ["Cash Payments", "Card Payments", "UPI / Digital Payments"]);
  for (const split of ["Cash", "Card", "UPI", "Digital Payments", "UPI Payments"]) {
    assert.equal(occurrences(pos, split), 0, `"${split}" would split an approved POS payment capability`);
  }
  assert.equal(pos.length, 19);
});

test("capability names are unique within each owner (no duplicated capabilities)", () => {
  for (const owner of LAUNCH_CAPABILITY_OWNERS) {
    const names = namesFor(owner.key);
    assert.equal(new Set(names).size, names.length, `${owner.key} lists a capability twice`);
  }
});

test("capability IDs are unique, stable, human-readable slugs", () => {
  const ids = LAUNCH_CAPABILITIES.map((capability) => capability.id);
  assert.equal(new Set(ids).size, ids.length, "duplicate launch capability ID");
  for (const id of ids) assert.match(id, /^[a-z]+(-[a-z0-9]+)+$/, `"${id}" is not a stable kebab-case ID`);
});

test("every capability belongs to one of the 12 ERP modules or the Shared Platform", () => {
  const catalogKeys = ERP_MODULE_CATALOG.map((module) => module.key);
  assert.equal(LAUNCH_BUSINESS_MODULE_COUNT, 12);
  assert.deepEqual(
    LAUNCH_CAPABILITY_OWNERS.map((owner) => owner.key),
    [...catalogKeys, SHARED_PLATFORM_KEY],
    "owners must be the canonical ERP module keys plus the Shared Platform — no second module identity",
  );
  const owners = new Set(LAUNCH_CAPABILITY_OWNERS.map((owner) => owner.key));
  for (const capability of LAUNCH_CAPABILITIES) {
    assert.ok(owners.has(capability.moduleKey), `${capability.id} has unknown owner "${capability.moduleKey}"`);
    assert.ok(capability.name.trim().length > 0, `${capability.id} has no name`);
  }
});

test("capability records describe approved scope only — no implementation-status claims", () => {
  for (const capability of LAUNCH_CAPABILITIES) {
    assert.deepEqual(Object.keys(capability).sort(), ["id", "moduleKey", "name"], `${capability.id} carries unexpected fields`);
    assert.ok(Object.isFrozen(capability), `${capability.id} must be immutable`);
  }
  assert.ok(Object.isFrozen(LAUNCH_CAPABILITIES));
});

test("lookups resolve real IDs and reject unknown ones", () => {
  assert.equal(getLaunchCapability("crm-leads")?.name, "Leads");
  assert.equal(getLaunchCapability("not-a-capability"), null);
  assert.throws(() => launchCapabilityNames(["procurement-purchase-requisitions"]), /Unknown launch capability id/);
});

test("routed workflows only rely on approved launch capabilities", () => {
  for (const workflow of getRoutedWorkflows()) {
    assert.ok(workflow.capabilityIds?.length > 0, `${workflow.slug} must list the launch capabilities it relies on`);
    for (const id of workflow.capabilityIds) {
      assert.ok(getLaunchCapability(id), `${workflow.slug} references unknown launch capability "${id}"`);
    }
  }
});

// --- Public product-claim regressions ---------------------------------------

// Everything the website renders from this package. Glossary definitions and
// AEO answers are general ERP education and may describe concepts Vercentlabs
// doesn't offer, so only their Vercentlabs-specific claim field is checked.
function publicProductClaims() {
  const { AEO_ANSWERS, GLOSSARY_TERMS, ...rest } = content;
  const glossaryClaims = GLOSSARY_TERMS.map((term) => ({ term: term.term, vercentlabsHandling: term.vercentlabsHandling }));
  return JSON.stringify({ ...rest, glossaryClaims });
}

test("no public content uses the historical 991 / 897 / 94 requirement allocation as product proof", () => {
  const haystack = publicProductClaims();
  for (const pattern of [/\b991\b/, /\b897\b/, /\b94\b[^%]*requirement/i, /documented requirements/i, /operational requirements/i, /shared[- ]platform requirements/i, /requirementCount/]) {
    assert.ok(!pattern.test(haystack), `public content still matches ${pattern}`);
  }
});

// Affirmative claims about functionality outside the approved launch scope.
// Phrased specifically enough that honest "not part of the launch product"
// statements don't trip them.
const REMOVED_CLAIMS = [
  [/requisition-to-(order|payment)|requisition is (drafted|submitted)/i, "purchase requisitions"],
  [/RFQ invitations|bids, (and )?evaluations|award(s|ed)? (to|the) supplier/i, "RFQ / bid / award sourcing"],
  [/supplier scorecards? (is|are|track|rate)|periodic supplier scorecards/i, "supplier scorecards"],
  [/\b4-way match|four-way match|2\/3\/4-way/i, "4-way matching"],
  [/maverick/i, "maverick-spend controls"],
  [/spend analys/i, "spend analytics"],
  [/live (gross )?margin|profitability is computed|billing milestones? (use|are)|idempotency-keyed billing/i, "project profitability / billing"],
  [/budgets? split into|budget versioning/i, "project budgets"],
  [/SLA-(driven|tracked|timed)|business-hours SLA|escalates? automatically|policy-driven due dates/i, "support SLA / automatic escalation"],
  [/round-robin|least-loaded|skills-based assignment/i, "support routing strategies"],
  [/versioned articles|knowledge base (is|with|articles)/i, "knowledge base"],
  [/offline-capable|natively offline|native and offline|conflict-safe (sync|queu)|fingerprint-required|biometric re-lock|secure-browser handoff/i, "native / offline mobile"],
  [/PF\/ESI|professional tax\/TDS|gratuity\/bonus|jurisdiction-aware statutory/i, "statutory payroll"],
  [/employee expense tracking|approved (timesheets and )?expenses/i, "HR / project expenses"],
  [/dunning/i, "dunning"],
  [/TDS\/TCS|e-way[- ]bill|e-invoic/i, "TDS/TCS, e-invoice, e-way bill"],
  [/supports (real )?multi-entity consolidation|consolidation and intercompany posting (is|are|available)/i, "consolidation / intercompany"],
  [/cash-forecast scenarios|budget lifecycle/i, "budgeting / cash forecasting"],
  [/declining-balance|units-of-production/i, "non-straight-line depreciation"],
  [/planning runs produce|MRP-style planning|Vercentlabs'? (material and capacity )?planning runs/i, "MRP / capacity planning"],
  [/routings? with work centers?|work-center rate|ordered operations with timing/i, "routings / work centers"],
  [/linked CAPA|CAPA with root-cause|structured (supplier )?audits/i, "CAPA / supplier audits"],
  [/lead scoring|scored automatically|automatic scoring/i, "lead scoring"],
  [/credit[- ](check|exposure)|credit-checked/i, "credit checks"],
  [/digital signature|typed signature/i, "digital / typed signature acceptance"],
  [/command registry|approval engine (is|that)|approval-requests system/i, "generic approval engine"],
  [/twelve seeded|12 seeded|seeds roughly 12|seeded system roles/i, "role-count claim"],
  [/time-bound role|role assignments? can (expire|carry a start)/i, "time-bound role assignments"],
  [/(company|branch)[^.]{0,40}(isolation|scoping) is (structural|enforced at the data)|database-level isolation between companies/i, "database-level company/branch isolation"],
  [/every record change (is|writes)/i, "every-record-change audit claim"],
  [/quote-based/i, "quote-based pricing"],
  [/telephony|click-to-call|call transcription/i, "telephony integration"],
  [/OAuth|signed (inbound )?webhooks|public lead-capture API/i, "integration APIs / webhooks"],
  [/churn-risk|AI-assisted|AI governance|AI PII/i, "AI / predictive features"],
];

test("public content makes no claims for functionality outside the approved launch scope", () => {
  const haystack = publicProductClaims();
  const violations = [];
  for (const [pattern, concept] of REMOVED_CLAIMS) {
    for (const match of haystack.matchAll(new RegExp(pattern.source, `${pattern.flags}g`))) {
      violations.push(`${concept}: "…${haystack.slice(Math.max(0, match.index - 60), match.index + 60)}…"`);
    }
  }
  assert.deepEqual(violations, [], `public content claims functionality outside the approved launch scope:\n${violations.join("\n")}`);
});
