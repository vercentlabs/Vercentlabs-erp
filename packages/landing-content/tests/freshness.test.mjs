import assert from "node:assert/strict";
import test from "node:test";
import {
  CONTENT_FRESHNESS,
  getFreshness,
  hasFreshness,
  LANDING_MODULES,
  PLATFORM_PAGES,
  LANDING_INDUSTRIES,
  LANDING_SOLUTIONS,
  ROUTED_WORKFLOW_SLUGS,
} from "../src/index.js";

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function assertRealDate(value, label) {
  assert.match(value, DATE_PATTERN, `${label} must be an ISO YYYY-MM-DD date, got "${value}"`);
  const parsed = new Date(value);
  assert.ok(!Number.isNaN(parsed.getTime()), `${label} "${value}" does not parse to a real date`);
  return parsed;
}

test("every CONTENT_FRESHNESS entry has three real, parseable dates and a non-empty reviewReason", () => {
  for (const [path, freshness] of Object.entries(CONTENT_FRESHNESS)) {
    assertRealDate(freshness.publishedAt, `${path}.publishedAt`);
    assertRealDate(freshness.lastModifiedAt, `${path}.lastModifiedAt`);
    assertRealDate(freshness.lastReviewedAt, `${path}.lastReviewedAt`);
    assert.ok(
      freshness.reviewReason && freshness.reviewReason.length > 15,
      `${path}.reviewReason must be a real, specific statement, not empty or a placeholder`,
    );
  }
});

test("no CONTENT_FRESHNESS date is in the future", () => {
  const now = new Date();
  for (const [path, freshness] of Object.entries(CONTENT_FRESHNESS)) {
    for (const field of ["publishedAt", "lastModifiedAt", "lastReviewedAt"]) {
      const parsed = new Date(freshness[field]);
      assert.ok(parsed.getTime() <= now.getTime(), `${path}.${field} ("${freshness[field]}") is in the future`);
    }
  }
});

test("dates are logically ordered: publishedAt <= lastModifiedAt <= lastReviewedAt", () => {
  for (const [path, freshness] of Object.entries(CONTENT_FRESHNESS)) {
    const published = new Date(freshness.publishedAt).getTime();
    const modified = new Date(freshness.lastModifiedAt).getTime();
    const reviewed = new Date(freshness.lastReviewedAt).getTime();
    assert.ok(published <= modified, `${path}: publishedAt must not be after lastModifiedAt`);
    assert.ok(modified <= reviewed, `${path}: lastModifiedAt must not be after lastReviewedAt`);
  }
});

test("getFreshness throws a clear error for an unknown route instead of silently falling back", () => {
  assert.throws(() => getFreshness("/not-a-real-route"), /No CONTENT_FRESHNESS entry/);
});

test("hasFreshness correctly reports presence without throwing", () => {
  assert.equal(hasFreshness("/not-a-real-route"), false);
  assert.equal(hasFreshness("/"), true);
});

test("every real indexable route currently in the app has a CONTENT_FRESHNESS entry", () => {
  const requiredPaths = [
    "/",
    "/book-demo",
    "/product",
    "/modules",
    ...LANDING_MODULES.map((m) => `/modules/${m.key}`),
    ...PLATFORM_PAGES.map((p) => p.slug),
    "/industries",
    ...LANDING_INDUSTRIES.map((i) => `/industries/${i.slug}`),
    "/solutions",
    ...LANDING_SOLUTIONS.map((s) => `/solutions/${s.slug}`),
    "/workflows",
    ...ROUTED_WORKFLOW_SLUGS.map((slug) => `/workflows/${slug}`),
    "/implementation",
  ];
  const missing = requiredPaths.filter((path) => !hasFreshness(path));
  assert.deepEqual(missing, [], `Missing CONTENT_FRESHNESS entries for: ${missing.join(", ")}`);
});
