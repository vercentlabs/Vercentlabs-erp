// Integrity closeout (Prompts 1-5): the Opportunity 360 page and the mobile
// Opportunity detail route each used to run their own unguarded raw
// `SELECT * FROM tenant.crm_communications ... WHERE opportunity_id=$2`
// query, returning full communication content (subject/body/recipients) to
// any user who could open the Opportunity — regardless of whether they held
// crm.leads.view_sensitive, the same content-sensitivity permission
// getLeadDetailData already enforces for Lead-linked communications.
//
// Blocker B (canonical Opportunity projection) subsequently replaced both
// independent implementations with one shared getOpportunityDetailData()
// function (apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-detail-data.ts) —
// these tests now prove (a) that function applies the sensitive-content and
// Sales-quotation gates and bounds every related query, and (b) both web
// and mobile actually route through it rather than re-deriving either gate
// independently, which is what let them drift the first time.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const root = path.resolve(import.meta.dirname, "../../..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("getOpportunityDetailData: communications are gated behind crm.leads.view_sensitive, not just crm.view", () => {
  const detailData = read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-detail-data.ts");
  assert.match(
    detailData,
    /canSeeSensitiveContent\s*=\s*canSeeOpportunitySensitiveContent\(context\)/,
    "must derive a dedicated sensitive-content flag",
  );
  assert.match(
    detailData,
    /canSeeSensitiveContent\s*\n?\s*\?\s*db\.query\(\s*\n?\s*`SELECT \* FROM tenant\.crm_communications/,
    "the communications query must be conditioned on the sensitive-content flag",
  );
  assert.match(
    detailData,
    /canSeeOpportunitySensitiveContent\s*=\s*canViewSensitiveLeadContent/,
    "must reuse the same crm.leads.view_sensitive check getLeadDetailData already applies, not a re-derived equivalent",
  );
});

// CRM vNext Prompt 6 (F019, CRM-VNEXT-129): re-auditing this file for the
// canonical cross-entity timeline surfaced that the `activities` query —
// unlike `communications` right below it — had NO sensitive-content gate
// at all: any caller who could merely view the Opportunity could read
// every linked Call/Meeting/Task/Follow-up subject/detail, a real
// divergence from Lead's own equivalent query (getLeadDetailData's
// `activities` query is correctly gated). This was a genuine unguarded
// leak, not a stylistic inconsistency — closed alongside the communications
// gate above, using the exact same `canSeeSensitiveContent` flag.
test("getOpportunityDetailData: activities (Calls/Meetings/Tasks/Follow-ups) are gated behind crm.leads.view_sensitive, matching Lead's own equivalent query — CRM-VNEXT-129", () => {
  const detailData = read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-detail-data.ts");
  assert.match(
    detailData,
    /canSeeSensitiveContent\s*\n?\s*\?\s*db\.query\(\s*\n?\s*`SELECT \* FROM tenant\.crm_activities/,
    "the activities query must be conditioned on the sensitive-content flag, not returned unconditionally",
  );
});

test("getOpportunityDetailData: the linked Sales quotation preview is gated behind a dedicated Sales-visibility check (sales.view), the same permission the Sales quotations list itself requires", () => {
  const detailData = read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-detail-data.ts");
  assert.match(
    detailData,
    /canSeeSalesQuotations\s*=\s*canSeeOpportunitySalesQuotations\(context\)/,
    "must derive a dedicated Sales-visibility flag",
  );
  assert.match(
    detailData,
    /permissions\?\.includes\("sales\.view"\)/,
    "the Sales-visibility check must key off sales.view",
  );
  assert.match(
    detailData,
    /canSeeSalesQuotations\s*\n?\s*\?\s*db\.query\(\s*\n?\s*`SELECT id,quotation_number,lifecycle_status,created_at FROM tenant\.sales_quotations/,
    "the quotations query must be conditioned on the Sales-visibility flag",
  );
});

test("getOpportunityDetailData: every raw related-collection query is bounded, not unlimited", () => {
  const detailData = read("apps/web/src/modules/crm/opportunity-and-pipeline-governance/opportunity-detail-data.ts");
  const rawQueries = detailData.match(/db\.query\(\s*\n?\s*`[^`]*`/g) || [];
  assert.ok(rawQueries.length >= 4, "expected the history/probabilityHistory/activities/communications/quotations raw queries");
  for (const query of rawQueries) {
    assert.match(query, /LIMIT \d+/, `every raw related query must be bounded: ${query.slice(0, 80)}...`);
  }
});

test("Opportunity 360 (web) and mobile detail both route through the one canonical getOpportunityDetailData projection, not independent copies", () => {
  const page = read("apps/web/src/app/(app)/crm/opportunities/[id]/page.tsx");
  const mobileRoute = read("apps/web/src/app/api/mobile/v1/crm/[resource]/[id]/route.ts");
  for (const source of [page, mobileRoute]) {
    assert.match(
      source,
      /getOpportunityDetailData/,
      "must import and call the canonical projection rather than re-deriving its own related-data queries",
    );
  }
  // Neither surface should still contain its own copy of the raw
  // communications query — that would mean a second, independent
  // implementation exists alongside the canonical one.
  assert.doesNotMatch(page, /SELECT \* FROM tenant\.crm_communications/);
  assert.doesNotMatch(mobileRoute, /SELECT \* FROM tenant\.crm_communications/);
});
