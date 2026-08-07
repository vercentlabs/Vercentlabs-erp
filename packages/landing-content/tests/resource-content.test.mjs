import assert from "node:assert/strict";
import test from "node:test";
import { RESOURCE_GUIDES, getResourceGuide, LANDING_MODULES, LANDING_WORKFLOWS } from "../src/index.js";

const BANNED_PHRASES = [/coming soon/i, /lorem ipsum/i, /placeholder/i, /\btbd\b/i, /\btodo\b/i, /best[- ]in[- ]class/i, /world[- ]class/i, /industry[- ]leading/i, /#1\b/, /number one/i];

test("exactly 6 cornerstone resource guides exist, per the Phase 6 scope decision", () => {
  assert.equal(RESOURCE_GUIDES.length, 6);
});

test("every guide has a unique slug, title, metaDescription, and searchIntent", () => {
  const slugs = RESOURCE_GUIDES.map((g) => g.slug);
  const titles = RESOURCE_GUIDES.map((g) => g.title);
  const descriptions = RESOURCE_GUIDES.map((g) => g.metaDescription);
  assert.equal(new Set(slugs).size, slugs.length, "guide slugs must be unique");
  assert.equal(new Set(titles).size, titles.length, "guide titles must be unique");
  assert.equal(new Set(descriptions).size, descriptions.length, "guide metaDescriptions must be unique");
});

test("every guide has a real dek, at least 3 key takeaways, and at least 1 real section", () => {
  for (const guide of RESOURCE_GUIDES) {
    assert.ok(guide.dek && guide.dek.length > 30, `${guide.slug} needs a real dek`);
    assert.ok(guide.keyTakeaways.length >= 3, `${guide.slug} needs at least 3 key takeaways`);
    assert.ok(guide.sections.length >= 1, `${guide.slug} needs at least 1 section`);
    for (const section of guide.sections) {
      assert.ok(section.heading && section.heading.length > 5, `${guide.slug}'s section '${section.id}' needs a real heading`);
      assert.ok(section.paragraphs.length >= 1 && section.paragraphs.every((p) => p.length > 40), `${guide.slug}'s section '${section.id}' needs real, substantial paragraph text`);
    }
  }
});

test("every guide has at least 2 FAQs", () => {
  for (const guide of RESOURCE_GUIDES) {
    assert.ok(guide.faqs.length >= 2, `${guide.slug} needs at least 2 FAQs`);
  }
});

test("relatedModuleKeys, relatedWorkflowSlugs, and relatedResourceSlugs all resolve to real content", () => {
  const moduleKeys = new Set(LANDING_MODULES.map((m) => m.key));
  const workflowSlugs = new Set(LANDING_WORKFLOWS.map((w) => w.slug));
  const guideSlugs = new Set(RESOURCE_GUIDES.map((g) => g.slug));
  for (const guide of RESOURCE_GUIDES) {
    for (const key of guide.relatedModuleKeys) {
      assert.ok(moduleKeys.has(key), `${guide.slug}'s relatedModuleKeys references unknown module '${key}'`);
    }
    for (const slug of guide.relatedWorkflowSlugs) {
      assert.ok(workflowSlugs.has(slug), `${guide.slug}'s relatedWorkflowSlugs references unknown workflow '${slug}'`);
    }
    for (const slug of guide.relatedResourceSlugs) {
      assert.ok(guideSlugs.has(slug), `${guide.slug}'s relatedResourceSlugs references unknown guide '${slug}'`);
      assert.notEqual(slug, guide.slug, `${guide.slug} should not list itself in relatedResourceSlugs`);
    }
  }
});

test("erp-implementation-checklist stays generic/vendor-neutral and does not duplicate /implementation's Vercentlabs-specific framing", () => {
  const guide = getResourceGuide("erp-implementation-checklist");
  assert.ok(guide);
  const haystack = JSON.stringify(guide).toLowerCase();
  assert.ok(!haystack.includes("vercentlabs' own implementation journey") || guide.faqs.some((f) => f.answer.toLowerCase().includes("vercentlabs")), "the checklist should acknowledge but not duplicate the real /implementation page");
});

test("resource guide content has no banned overclaiming or placeholder phrase", () => {
  const haystack = JSON.stringify(RESOURCE_GUIDES);
  for (const pattern of BANNED_PHRASES) {
    assert.ok(!pattern.test(haystack), `resource guide content contains a banned phrase matching ${pattern}`);
  }
});

test("getResourceGuide returns null for an unknown slug instead of throwing", () => {
  assert.equal(getResourceGuide("not-a-real-guide"), null);
});
