import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("public hero markets the released CRM scope without claiming roadmap modules", () => {
  const hero = read("src/components/home/hero-section.tsx");
  assert.match(hero, /Released CRM early access/);
  assert.match(hero, /Roadmap modules/);
  assert.match(hero, /value: "11"/);
  assert.doesNotMatch(hero, /Run every core operation/);
  assert.doesNotMatch(hero, /value: "12"/);
});

test("public pricing describes CRM and permissions rather than unreleased approvals", () => {
  const pricing = read("src/app/pricing/page.tsx");
  assert.match(pricing, /CRM and business master data/);
  assert.match(pricing, /Roles, permissions and audit history/);
  assert.doesNotMatch(pricing, /Roles, approvals and audit history/);
});

test("standalone packaging supports applications without a public directory", () => {
  const packaging = read("scripts/prepare-hostinger-output.mjs");
  assert.match(packaging, /await access\(publicDirectory\)/);
  assert.match(packaging, /error\?\.code !== "ENOENT"/);
});

test("feature marketing contains only released platform and CRM claims", () => {
  const features = read("src/app/features/page.tsx");
  assert.match(features, /Released early-access scope/);
  assert.match(features, /Governed approvals/);
  assert.match(features, /Eleven modules remain future scope/);
  assert.doesNotMatch(features, /Multi-level approvals/);
  assert.doesNotMatch(features, /Delegate approvals/);
  assert.doesNotMatch(features, /closed or controlled accounting periods/);
});
