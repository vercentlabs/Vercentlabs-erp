import assert from "node:assert/strict";
import test from "node:test";
import { GLOSSARY_TERMS, STANDALONE_GLOSSARY_SLUGS, getGlossaryTerm, LANDING_MODULES, LANDING_WORKFLOWS } from "../src/index.js";

const BANNED_PHRASES = [/coming soon/i, /lorem ipsum/i, /placeholder/i, /\btbd\b/i, /\btodo\b/i, /best[- ]in[- ]class/i, /world[- ]class/i, /industry[- ]leading/i, /#1\b/, /number one/i];

test("glossary has a controlled term count — not hundreds of pages", () => {
  assert.ok(GLOSSARY_TERMS.length >= 20 && GLOSSARY_TERMS.length <= 40, `expected a controlled glossary size, got ${GLOSSARY_TERMS.length} terms`);
  assert.equal(STANDALONE_GLOSSARY_SLUGS.length, 11, "exactly 11 standalone glossary pages, per the Phase 6 scope decision");
});

test("every glossary term has a real, non-empty shortDefinition and a unique term name", () => {
  const names = GLOSSARY_TERMS.map((t) => t.term);
  assert.equal(new Set(names).size, names.length, "glossary term names must be unique");
  for (const entry of GLOSSARY_TERMS) {
    assert.ok(entry.shortDefinition && entry.shortDefinition.length > 20, `${entry.term} needs a real shortDefinition`);
  }
});

test("every standalone entry has the full 9-part shape and a unique slug", () => {
  const standalone = GLOSSARY_TERMS.filter((t) => t.standalone);
  const slugs = standalone.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length, "standalone slugs must be unique");
  for (const entry of standalone) {
    assert.ok(entry.slug, `${entry.term} needs a slug`);
    assert.ok(entry.definition && entry.definition.length > 40, `${entry.term} needs a real definition`);
    assert.ok(entry.whyItMatters && entry.whyItMatters.length > 20, `${entry.term} needs whyItMatters`);
    assert.ok(entry.howItWorks && entry.howItWorks.length > 20, `${entry.term} needs howItWorks`);
    assert.ok(entry.example && entry.example.length > 20, `${entry.term} needs a real example`);
    assert.ok(Array.isArray(entry.relatedTerms), `${entry.term}'s relatedTerms must be an array`);
    assert.ok(Array.isArray(entry.relatedModules) && entry.relatedModules.length >= 1, `${entry.term} needs at least 1 related module`);
    assert.ok(entry.vercentlabsHandling && entry.vercentlabsHandling.length > 40, `${entry.term} needs a real vercentlabsHandling claim`);
    assert.ok(entry.lastReviewedAt, `${entry.term} needs a lastReviewedAt date`);
  }
});

test("standalone entries' relatedModules and relatedWorkflow resolve to real content", () => {
  const moduleKeys = new Set(LANDING_MODULES.map((m) => m.key));
  const workflowSlugs = new Set(LANDING_WORKFLOWS.map((w) => w.slug));
  for (const entry of GLOSSARY_TERMS.filter((t) => t.standalone)) {
    for (const key of entry.relatedModules) {
      assert.ok(moduleKeys.has(key), `${entry.term}'s relatedModules references unknown module '${key}'`);
    }
    if (entry.relatedWorkflow) {
      assert.ok(workflowSlugs.has(entry.relatedWorkflow), `${entry.term}'s relatedWorkflow references unknown workflow '${entry.relatedWorkflow}'`);
    }
  }
});

test("standalone entries' relatedTerms reference other real standalone slugs, never themselves", () => {
  const slugSet = new Set(STANDALONE_GLOSSARY_SLUGS);
  for (const entry of GLOSSARY_TERMS.filter((t) => t.standalone)) {
    for (const relatedSlug of entry.relatedTerms) {
      assert.ok(slugSet.has(relatedSlug), `${entry.term}'s relatedTerms references unknown standalone slug '${relatedSlug}'`);
      assert.notEqual(relatedSlug, entry.slug, `${entry.term} should not list itself in relatedTerms`);
    }
  }
});

test("getGlossaryTerm resolves real standalone slugs and returns null for unknown/index-only slugs", () => {
  for (const slug of STANDALONE_GLOSSARY_SLUGS) {
    assert.ok(getGlossaryTerm(slug), `getGlossaryTerm('${slug}') should resolve`);
  }
  assert.equal(getGlossaryTerm("not-a-real-term"), null);
});

test("index-only entries with a relatedRoute point to a real, plausible route shape", () => {
  for (const entry of GLOSSARY_TERMS.filter((t) => !t.standalone)) {
    if (entry.relatedRoute) {
      assert.match(entry.relatedRoute, /^\/(modules|workflows|solutions|industries|resources)\//, `${entry.term}'s relatedRoute '${entry.relatedRoute}' doesn't look like a real route`);
    }
  }
});

test("glossary content has no banned overclaiming or placeholder phrase", () => {
  const haystack = JSON.stringify(GLOSSARY_TERMS);
  for (const pattern of BANNED_PHRASES) {
    assert.ok(!pattern.test(haystack), `glossary content contains a banned phrase matching ${pattern}`);
  }
});

test("Lead to Cash and Procure to Pay are deliberately index-only, not standalone (avoids duplicating the real workflow pages)", () => {
  const leadToCash = GLOSSARY_TERMS.find((t) => t.term === "Lead to Cash");
  const procureToPay = GLOSSARY_TERMS.find((t) => t.term === "Procure to Pay");
  assert.ok(leadToCash && !leadToCash.standalone, "Lead to Cash must be index-only");
  assert.ok(procureToPay && !procureToPay.standalone, "Procure to Pay must be index-only");
  assert.equal(leadToCash.relatedRoute, "/workflows/lead-to-cash");
  assert.equal(procureToPay.relatedRoute, "/workflows/procure-to-pay");
});
