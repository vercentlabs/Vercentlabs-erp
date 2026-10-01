import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { QueryClient } from "@tanstack/react-query";

import { scopedQueryKey } from "../../../shell/workspace-context/queryKeys.ts";

// CRM query caches must never cross organizations or companies: every CRM
// server query key starts with [organizationId, companyId] (scopedQueryKey).
// These run against a real TanStack QueryClient, so they prove the matching
// the screens rely on, not just the key arrays.
const orgA = { organizationId: "org-a", companyId: "co-1" };
const orgB = { organizationId: "org-b", companyId: "co-1" };
const orgACompany2 = { organizationId: "org-a", companyId: "co-2" };

test("the same CRM query in two organizations or two companies uses different cache entries", () => {
  const client = new QueryClient();
  client.setQueryData(
    scopedQueryKey(orgA, "crm", "leads", "l1", "stage-reasons", "s2"),
    { reasons: ["a-only"] },
  );
  assert.equal(
    client.getQueryData(
      scopedQueryKey(orgB, "crm", "leads", "l1", "stage-reasons", "s2"),
    ),
    undefined,
  );
  assert.equal(
    client.getQueryData(
      scopedQueryKey(orgACompany2, "crm", "leads", "l1", "stage-reasons", "s2"),
    ),
    undefined,
  );
  assert.deepEqual(
    client.getQueryData(
      scopedQueryKey(orgA, "crm", "leads", "l1", "stage-reasons", "s2"),
    ),
    { reasons: ["a-only"] },
  );
  assert.deepEqual(
    scopedQueryKey({ organizationId: "org-a", companyId: null }, "crm").slice(
      0,
      2,
    ),
    ["org-a", "no-company"],
  );
});

test("invalidating a scoped CRM family touches that workspace's queries only", async () => {
  const client = new QueryClient();
  const keys = {
    aLeads: scopedQueryKey(orgA, "crm", "leads", "l1", "stage-reasons", "s2"),
    aPreview: scopedQueryKey(orgA, "crm-privacy-request-preview", "p1"),
    bLeads: scopedQueryKey(orgB, "crm", "leads", "l1", "stage-reasons", "s2"),
  };
  for (const key of Object.values(keys))
    client.setQueryData(key, { cached: true });
  await client.invalidateQueries({
    queryKey: scopedQueryKey(orgA, "crm", "leads"),
  });
  const invalid = (key: readonly unknown[]) =>
    client.getQueryState(key)?.isInvalidated;
  assert.equal(invalid(keys.aLeads), true);
  assert.equal(invalid(keys.bLeads), false);
  assert.equal(invalid(keys.aPreview), false);
  // A workspace switch drops the old organization's prefix without touching the new one.
  client.removeQueries({ queryKey: [orgA.organizationId] });
  assert.equal(client.getQueryData(keys.aLeads), undefined);
  assert.deepEqual(client.getQueryData(keys.bLeads), { cached: true });
});

test("RelatedRecordPicker search results from one workspace are not served in another", () => {
  const client = new QueryClient();
  client.setQueryData(
    scopedQueryKey(orgA, "crm", "related-search", "party", "acme"),
    [{ id: "acct-in-org-a" }],
  );
  assert.equal(
    client.getQueryData(
      scopedQueryKey(orgB, "crm", "related-search", "party", "acme"),
    ),
    undefined,
  );
});

test("the three corrected CRM queries build their keys with scopedQueryKey", () => {
  const read = (relative: string) =>
    fs.readFileSync(new URL(relative, import.meta.url), "utf8");
  const cases = [
    [
      "./ui/RelatedRecordPicker.tsx",
      /queryKey: scopedQueryKey\(\s*workspace,\s*"crm",\s*"related-search",\s*value\.entityType,\s*text,?\s*\)/,
    ],
    [
      "../customers/leads/components/LeadKanbanBoard.tsx",
      /queryKey: scopedQueryKey\(\s*workspace,\s*"crm",\s*"leads",\s*lead\.id,\s*"stage-reasons",\s*stage\.id,?\s*\)/,
    ],
    [
      "../setup/privacy-requests/screens/PrivacyRequestsSettingsScreen.tsx",
      /queryKey: scopedQueryKey\(\s*workspace,\s*"crm-privacy-request-preview",\s*request\?\.id,?\s*\)/,
    ],
  ] as const;
  for (const [file, pattern] of cases) assert.match(read(file), pattern, file);
  // The Kanban reason prompt shares the Lead detail key family (its data hook).
  assert.match(
    read("../customers/leads/detail/useLeadDetailData.ts"),
    /scopedQueryKey\(\s*workspace,\s*"crm",\s*"leads",\s*leadId,\s*"stage-reasons",/,
  );
});
