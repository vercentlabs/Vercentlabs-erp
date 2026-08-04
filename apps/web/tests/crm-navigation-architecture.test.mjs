import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const shell = fs.readFileSync("src/components/app-shell.tsx", "utf8");
const section = fs.readFileSync(
  "src/components/navigation-section.tsx",
  "utf8",
);
const navigation = fs.readFileSync(
  "src/components/navigation-link.tsx",
  "utf8",
);
const contextBar = fs.readFileSync(
  "src/components/module-context-bar.tsx",
  "utf8",
);
const crmTabs = fs.readFileSync("src/components/crm-section-tabs.tsx", "utf8");
const crmLayout = fs.readFileSync("src/app/(app)/crm/layout.tsx", "utf8");
const theme = fs.readFileSync("src/app/operator-workbench.css", "utf8");

test("CRM sidebar follows customer, sales, engagement, insight and admin workflows", () => {
  for (const group of [
    "Customers",
    "Sales",
    "Engagement",
    "Insights",
    "Administration",
  ]) {
    assert.match(shell, new RegExp(`group: "${group}"`));
  }

  for (const label of [
    "Accounts",
    "Contacts",
    "Pipeline & forecasting",
    "Partner management",
    "CRM intelligence",
  ]) {
    assert.match(
      shell,
      new RegExp(`label: "${label.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&")}"`),
    );
  }
});

test("advanced capabilities no longer crowd the primary CRM sidebar", () => {
  for (const legacyLabel of [
    "Lead acquisition",
    "Lead intelligence",
    "Opportunity intelligence",
    "Conversation intelligence",
    "Partner & engagement",
    "CRM readiness",
  ]) {
    assert.doesNotMatch(shell, new RegExp(`label: "${legacyLabel}"`));
  }

  assert.match(
    shell,
    /activePrefixes: \["\/crm\/lead-acquisition", "\/crm\/lead-intelligence"\]/,
  );
  assert.match(shell, /activePrefixes: \["\/crm\/opportunity-revenue"\]/);
  assert.match(shell, /activePrefixes: \["\/crm\/conversation-intelligence"\]/);
  assert.match(
    shell,
    /activePrefixes: \["\/crm\/mobile-readiness"\]/,
  );
});

test("hidden advanced areas remain discoverable inside their parent workflows", () => {
  for (const route of [
    "/crm/lead-acquisition",
    "/crm/lead-intelligence",
    "/crm/opportunity-revenue",
    "/crm/conversation-intelligence",
    "/crm/mobile-readiness",
  ]) {
    assert.match(crmTabs, new RegExp(route.replaceAll("/", "\\/")));
  }

  assert.match(crmTabs, /All leads/);
  assert.match(crmTabs, /Scoring, SLA & nurture/);
  assert.match(crmTabs, /Forecasting & revenue/);
  assert.match(crmTabs, /Calls & conversations/);
  assert.match(crmTabs, /Release readiness/);
  assert.match(crmLayout, /<CrmSectionTabs \/>/);
});

test("active aliases work in the desktop, mobile and module-context navigation", () => {
  assert.match(section, /activePrefixes\?: string\[\]/);
  assert.match(section, /item\.activePrefixes\?\.some/);
  assert.match(navigation, /activePrefixes = \[\]/);
  assert.match(navigation, /const aliasMatch = activePrefixes\.some/);
  assert.match(contextBar, /activePrefixes\?: string\[\]/);
  assert.match(contextBar, /item\.activePrefixes\?\.some/);
});

test("CRM navigation additions preserve the operator-workbench visual system", () => {
  assert.match(theme, /\.nav-subgroup-label/);
  assert.match(theme, /\.crm-section-tabs-shell/);
  assert.match(theme, /\.crm-section-tabs a\.active/);
  assert.match(theme, /@media \(max-width: 960px\)[\s\S]*\.crm-section-tabs/);
});
