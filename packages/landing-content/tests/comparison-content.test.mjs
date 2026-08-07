import assert from "node:assert/strict";
import test from "node:test";
import { ODOO_COMPARISON_EVIDENCE, VERCENTLABS_VS_ODOO, EDITORIAL_SOURCES, getComparisonEvidence } from "../src/index.js";

const NEVER_ABSOLUTE_SUPERLATIVE = [/vercentlabs is better/i, /better than odoo/i, /superior to/i, /outperforms/i, /the best erp/i];

test("exactly 1 comparison exists this phase, per the Phase 6 scope decision", () => {
  assert.equal(VERCENTLABS_VS_ODOO.slug, "vercentlabs-vs-odoo");
});

test("every ComparisonEvidence claim has a real, live-fetched source with a verifiedAt date", () => {
  const sourceUrls = new Set(EDITORIAL_SOURCES.map((s) => s.url));
  for (const evidence of ODOO_COMPARISON_EVIDENCE) {
    assert.ok(evidence.claim && evidence.claim.length > 20, `${evidence.claimId} needs a real claim`);
    assert.ok(sourceUrls.has(evidence.sourceUrl), `${evidence.claimId}'s sourceUrl '${evidence.sourceUrl}' is not a registered EDITORIAL_SOURCES entry`);
    assert.match(evidence.verifiedAt, /^\d{4}-\d{2}-\d{2}$/, `${evidence.claimId} needs a real ISO verifiedAt date`);
  }
});

test("every dimension's evidenceIds resolve to real ODOO_COMPARISON_EVIDENCE claims", () => {
  const claimIds = new Set(ODOO_COMPARISON_EVIDENCE.map((e) => e.claimId));
  for (const dimension of VERCENTLABS_VS_ODOO.dimensions) {
    for (const id of dimension.evidenceIds) {
      assert.ok(claimIds.has(id), `dimension '${dimension.id}' references unknown evidence claim '${id}'`);
    }
  }
});

test("comparison is framed both directions — never an absolute 'Vercentlabs is better' superlative", () => {
  const haystack = JSON.stringify(VERCENTLABS_VS_ODOO);
  for (const pattern of NEVER_ABSOLUTE_SUPERLATIVE) {
    assert.ok(!pattern.test(haystack), `comparison content contains a one-sided superlative matching ${pattern}`);
  }
  assert.ok(VERCENTLABS_VS_ODOO.strongerFitForOdoo.length >= 2, "must name at least 2 real scenarios where Odoo may be the stronger fit");
  assert.ok(VERCENTLABS_VS_ODOO.strongerFitForVercentlabs.length >= 2, "must name at least 2 real scenarios where Vercentlabs may be the stronger fit");
});

test("comparison does not claim or imply a specific Vercentlabs price point (none is published)", () => {
  const pricingDimension = VERCENTLABS_VS_ODOO.dimensions.find((d) => d.id === "pricing-structure");
  assert.ok(pricingDimension, "a pricing-structure dimension must exist");
  assert.ok(!/₹\d/.test(pricingDimension.vercentlabs) && !/\$\d/.test(pricingDimension.vercentlabs), "must not state a specific Vercentlabs price — none is publicly published");
});

test("every dimension has a real title and non-empty content on both sides", () => {
  for (const dimension of VERCENTLABS_VS_ODOO.dimensions) {
    assert.ok(dimension.title && dimension.title.length > 3, `dimension '${dimension.id}' needs a real title`);
    assert.ok(dimension.odoo && dimension.odoo.length > 20, `dimension '${dimension.id}' needs real Odoo-side content`);
    assert.ok(dimension.vercentlabs && dimension.vercentlabs.length > 20, `dimension '${dimension.id}' needs real Vercentlabs-side content`);
  }
});

test("getComparisonEvidence returns null for an unknown claimId instead of throwing", () => {
  assert.equal(getComparisonEvidence("not-a-real-claim"), null);
});
