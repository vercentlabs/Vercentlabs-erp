import assert from "node:assert/strict";
import test from "node:test";

import {
  resolvePublicQuoteToken,
  scanExpiredQuotations,
} from "../src/modules/sales/index.js";

const org = "11111111-1111-4111-8111-111111111111";
const quotationId = "22222222-2222-4222-8222-222222222222";
const versionId = "33333333-3333-4333-8333-333333333333";
const linkId = "44444444-4444-4444-8444-444444444444";
const tokenHash = "hash-1";

const manager = {
  organizationId: org,
  userId: "user-1",
  activeCompanyId: null,
  activeBranchId: null,
  allowAllCompanies: true,
  permissions: ["sales.view", "sales.settings.manage"],
  roleSlugs: [],
};

function futureDate(days) {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}
function pastDate(days) {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}

function tokenClient({ validUntil, linkExpiresAt = futureDate(30) } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.includes("FROM tenant.sales_quote_share_links") && sql.includes("FOR UPDATE"))
        return {
          rows: [
            {
              id: linkId,
              organization_id: org,
              quotation_id: quotationId,
              quotation_version_id: versionId,
              token_hash: tokenHash,
              revoked_at: null,
              expires_at: `${linkExpiresAt}T00:00:00Z`,
              first_viewed_at: null,
              view_count: 0,
            },
          ],
        };
      if (sql.startsWith("SELECT * FROM tenant.sales_quotations") && sql.includes("FOR UPDATE"))
        return {
          rows: [
            {
              id: quotationId,
              organization_id: org,
              current_version_id: versionId,
              lifecycle_status: "sent",
              valid_until: validUntil,
              quotation_number: "QUO-0001",
            },
          ],
        };
      if (sql.includes("FROM tenant.sales_quotations quotation") && sql.includes("JOIN tenant.sales_quotation_versions version"))
        return {
          rows: [
            {
              id: quotationId,
              quotation_id: quotationId,
              current_version_id: versionId,
              lifecycle_status: "sent",
              valid_until: validUntil,
            },
          ],
        };
      if (sql.includes("FROM tenant.sales_quotation_lines")) return { rows: [] };
      if (sql.includes("FROM tenant.sales_quotation_charges")) return { rows: [] };
      if (sql.startsWith("UPDATE tenant.sales_quote_share_links")) return { rows: [] };
      if (sql.startsWith("UPDATE tenant.sales_quotations")) return { rows: [] };
      if (sql.includes("INSERT INTO tenant.sales_document_events")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F038: resolving a token for a quotation still within its validity window succeeds", async () => {
  const client = tokenClient({ validUntil: futureDate(10) });
  const result = await resolvePublicQuoteToken(client, manager, tokenHash, false);
  assert.equal(result.quotation.quotation.id, quotationId);
});

test("F038: resolving a token for a quotation past its own valid_until is rejected, even with a still-live share link", async () => {
  const client = tokenClient({ validUntil: pastDate(1), linkExpiresAt: futureDate(30) });
  await assert.rejects(
    resolvePublicQuoteToken(client, manager, tokenHash, false),
    (error) => error.status === 410 && /expired/i.test(error.message),
  );
});

test("F038: a quotation expiring today is still acceptable (valid_until is inclusive)", async () => {
  const client = tokenClient({ validUntil: futureDate(0) });
  const result = await resolvePublicQuoteToken(client, manager, tokenHash, false);
  assert.equal(result.quotation.quotation.id, quotationId);
});

function scanClient({ expiredRows = [] } = {}) {
  const calls = [];
  return {
    calls,
    async query(sql, values = []) {
      calls.push({ sql, values });
      if (sql.startsWith("UPDATE tenant.sales_quotations") && sql.includes("lifecycle_status='expired'"))
        return { rows: expiredRows, rowCount: expiredRows.length };
      if (sql.includes("INSERT INTO tenant.sales_document_events")) return { rows: [] };
      return { rows: [] };
    },
  };
}

test("F038: scanExpiredQuotations transitions past-due sent/viewed/approved quotations to expired", async () => {
  const client = scanClient({
    expiredRows: [
      { id: quotationId, current_version_id: versionId },
    ],
  });
  const result = await scanExpiredQuotations(client, manager);
  assert.equal(result.expired, 1);
  const update = client.calls.find((c) => c.sql.includes("lifecycle_status='expired'"));
  assert.match(update.sql, /lifecycle_status IN \('approved','sent','viewed'\)/);
  assert.match(update.sql, /valid_until < current_date/);
  const event = client.calls.find((c) => c.sql.includes("INSERT INTO tenant.sales_document_events"));
  assert.ok(event, "expected a quotation.expired audit event");
});

test("F038: scanExpiredQuotations with nothing to expire is a clean no-op", async () => {
  const client = scanClient({ expiredRows: [] });
  const result = await scanExpiredQuotations(client, manager);
  assert.deepEqual(result, { scanned: 0, expired: 0 });
  assert.equal(client.calls.some((c) => c.sql.includes("INSERT INTO tenant.sales_document_events")), false);
});

test("F038: scanExpiredQuotations requires sales.settings.manage", async () => {
  const restricted = { ...manager, permissions: ["sales.view"] };
  const client = scanClient();
  await assert.rejects(
    scanExpiredQuotations(client, restricted),
    (error) => error.status === 403,
  );
});
