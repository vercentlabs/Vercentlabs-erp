import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const read = (file) => fs.readFileSync(file, "utf8");

test("public hero markets the released CRM, Sales, Accounting and Procurement scope", () => {
  const hero = read("src/components/home/hero-section.tsx");
  assert.match(hero, /Released CRM, Sales, Accounting & Procurement/);
  assert.match(hero, /label: "Released modules", value: "4"/);
  assert.match(hero, /label: "Roadmap modules", value: "8"/);
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

test("feature marketing reflects the released CRM, Sales, Accounting and Procurement scope", () => {
  const features = read("src/app/features/page.tsx");
  assert.match(features, /Released early-access scope/);
  assert.match(features, /Governed approvals/);
  assert.match(features, /Sales order-to-cash/);
  assert.match(features, /Accounting and financial control/);
  assert.match(features, /Procurement source-to-pay/);
  assert.match(features, /Eight modules remain future scope/);
  assert.doesNotMatch(features, /Nine modules remain future scope/);
  assert.doesNotMatch(features, /Run every core operation/);
});
