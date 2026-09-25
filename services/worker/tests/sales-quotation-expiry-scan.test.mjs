import assert from "node:assert/strict";
import test from "node:test";

import { detectExpiredQuotationsHandler } from "../src/handlers/sales-quotation-expiry-scan.js";

const org = "11111111-1111-4111-8111-111111111111";

function mockClient(expiredRows = []) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (sql.startsWith("UPDATE tenant.sales_quotations") && sql.includes("lifecycle_status='expired'"))
        return { rows: expiredRows, rowCount: expiredRows.length };
      if (sql.includes("INSERT INTO tenant.sales_document_events")) return { rows: [] };
      // Expiry also revokes the quotation's public share links (sales/index.js revokeQuoteLinks).
      if (sql.startsWith("UPDATE tenant.sales_quote_share_links")) return { rows: [] };
      if (sql.startsWith("UPDATE public.sales_public_quote_tokens")) return { rows: [] };
      throw new Error(`Unexpected query: ${sql}`);
    },
  };
}

test("detectExpiredQuotationsHandler: scopes the scan to the caller's own organization", async () => {
  const client = mockClient([]);
  await detectExpiredQuotationsHandler(client, { organizationId: org }, {});
  assert.equal(client.queries[0].params[0], org);
});

test("detectExpiredQuotationsHandler: builds an elevated scan context so it is not forbidden by the least-privilege system context", async () => {
  const client = mockClient([]);
  const result = await detectExpiredQuotationsHandler(
    client,
    { organizationId: org, roleSlugs: ["system_worker"], permissions: [] },
    {},
  );
  assert.deepEqual(result, { scanned: 0, expired: 0 });
});

test("detectExpiredQuotationsHandler: no expired quotations is a clean no-op, not an error", async () => {
  const client = mockClient([]);
  const result = await detectExpiredQuotationsHandler(client, { organizationId: org }, {});
  assert.deepEqual(result, { scanned: 0, expired: 0 });
});

test("detectExpiredQuotationsHandler: expiring quotations are counted and audited", async () => {
  const client = mockClient([
    { id: "quote-1", current_version_id: "version-1" },
    { id: "quote-2", current_version_id: "version-2" },
  ]);
  const result = await detectExpiredQuotationsHandler(client, { organizationId: org }, {});
  assert.deepEqual(result, { scanned: 2, expired: 2 });
  const events = client.queries.filter((q) => q.sql.includes("INSERT INTO tenant.sales_document_events"));
  assert.equal(events.length, 2);
  const revocations = client.queries.filter((q) => q.sql.startsWith("UPDATE tenant.sales_quote_share_links"));
  assert.deepEqual(revocations.map((q) => q.params[1]), ["quote-1", "quote-2"], "each expired quotation's share links are revoked");
});
