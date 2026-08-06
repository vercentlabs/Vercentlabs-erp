import assert from "node:assert/strict";
import test from "node:test";
import { cx } from "../lib/utils.ts";
import { absoluteUrl, SITE_URL } from "../lib/site.ts";
import { buildPageMetadata } from "../lib/metadata.ts";
import { organizationJsonLd, websiteJsonLd, breadcrumbJsonLd, jsonLdScriptProps } from "../lib/seo/json-ld.ts";
import { getApprovedScreenshot, APPROVED_SCREENSHOTS } from "../lib/product/screenshots.ts";

test("cx combines strings and conditional objects, skipping falsy values", () => {
  assert.equal(cx("a", null, undefined, false, "b", { c: true, d: false }), "a b c");
});

test("absoluteUrl resolves against SITE_URL", () => {
  assert.equal(absoluteUrl("/modules/crm"), new URL("/modules/crm", SITE_URL).toString());
});

test("buildPageMetadata sets a self-referencing canonical and index:true by default", () => {
  const metadata = buildPageMetadata({ title: "CRM", description: "CRM module", path: "/modules/crm" });
  assert.equal(metadata.alternates?.canonical, absoluteUrl("/modules/crm"));
  assert.deepEqual(metadata.robots, { index: true, follow: true });
});

test("buildPageMetadata marks noindex pages correctly", () => {
  const metadata = buildPageMetadata({ title: "Design System", description: "Internal", path: "/design-system", index: false });
  assert.deepEqual(metadata.robots, { index: false, follow: false, nocache: true });
});

test("organizationJsonLd and websiteJsonLd never include fabricated fields (ratings, reviews, pricing)", () => {
  const org = organizationJsonLd();
  const site = websiteJsonLd();
  for (const value of [org, site]) {
    assert.equal(value.aggregateRating, undefined);
    assert.equal(value.review, undefined);
    assert.equal(value.offers, undefined);
  }
  assert.equal(org["@type"], "Organization");
  assert.equal(site["@type"], "WebSite");
});

test("breadcrumbJsonLd produces a correctly ordered ListItem sequence", () => {
  const data = breadcrumbJsonLd([
    { name: "Modules", path: "/modules" },
    { name: "CRM", path: "/modules/crm" },
  ]);
  assert.equal(data.itemListElement.length, 2);
  assert.equal(data.itemListElement[0].position, 1);
  assert.equal(data.itemListElement[1].position, 2);
  assert.equal(data.itemListElement[1].item, absoluteUrl("/modules/crm"));
});

test("jsonLdScriptProps escapes '<' so a payload value can't close the script tag early", () => {
  const props = jsonLdScriptProps({ name: "</script><script>alert(1)</script>" });
  assert.ok(!props.dangerouslySetInnerHTML.__html.includes("</script>"));
});

test("getApprovedScreenshot returns null for an id with no approved entry", () => {
  assert.equal(getApprovedScreenshot("no-such-screenshot-id"), null);
});

test("every approved screenshot is marked approvedForMarketing and resolves by id", () => {
  assert.ok(APPROVED_SCREENSHOTS.length > 0);
  for (const screenshot of APPROVED_SCREENSHOTS) {
    assert.equal(screenshot.approvedForMarketing, true);
    assert.equal(getApprovedScreenshot(screenshot.id)?.id, screenshot.id);
  }
});
