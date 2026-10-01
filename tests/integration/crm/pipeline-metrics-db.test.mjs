// F024 canonical metric layer against real PostgreSQL on the runtime role.
// A hand-computed golden dataset proves: KPI = drill-down total = breakdown
// sum; currency conversion with dated rates; unconverted currencies are
// disclosed, never added at face value; team hierarchy filters; record
// visibility for rep/manager/admin; quota resolution and proration.
import assert from "node:assert/strict";
import test from "node:test";

import {
  getMetricDrilldown,
  getPipelineBreakdown,
  getPipelineDashboard,
  getPipelineMetrics,
} from "../../../services/api/src/modules/crm/analytics/pipeline-metrics.js";
import { getCrmReport } from "../../../services/api/src/modules/crm/analytics/analytics-service.js";
import { createRuntimeKit, expectCode } from "../shared-runtime/runtime-kit.mjs";
import { ADMIN, crmFixtures, MANAGER, REP } from "./crm-fixtures.mjs";

const PERIOD = { from: "2026-07-01", to: "2026-09-30", asOf: "2026-09-29" };
const daysAgo = (days) => new Date(Date.now() - days * 86_400_000).toISOString();

test("F024 pipeline metrics reconcile", async (t) => {
  const kit = await createRuntimeKit();
  try {
    const org = await kit.organization(["admin", "alice", "bob", "carol", "manny"]);
    const other = await kit.organization(["mallory"]);
    const fx = crmFixtures(kit, org);
    const { alice, bob, carol, manny } = org.ids;
    const pipe = await fx.pipeline();
    const india = await fx.team("India");
    const west = await fx.team("West", { managerId: manny, parentId: india });
    const south = await fx.team("South", { parentId: india });
    await fx.member(west, alice);
    await fx.member(west, bob);
    await fx.member(south, carol);
    await fx.rate("USD", "INR", 80, "2000-01-01");
    await fx.rate("USD", "INR", 90, "2026-08-15");

    const ids = {};
    ids.o1 = await fx.opportunity(pipe, { ownerId: alice, amount: 1000, probability: 50, expectedClose: "2026-08-10", category: "committed" });
    ids.o2 = await fx.opportunity(pipe, { ownerId: alice, amount: 100, currency: "USD", probability: 20, expectedClose: "2026-09-15", category: "best_case" });
    ids.o3 = await fx.opportunity(pipe, { ownerId: bob, amount: 5000, probability: 10, expectedClose: "2026-12-01" });
    ids.o4 = await fx.opportunity(pipe, { ownerId: carol, amount: 200, currency: "EUR", expectedClose: "2026-08-20", category: "committed" });
    ids.o5 = await fx.opportunity(pipe, { ownerId: alice, amount: 3000, status: "won", actualClose: "2026-08-05", probability: 100, category: "closed" });
    ids.o6 = await fx.opportunity(pipe, { ownerId: bob, amount: 50, currency: "USD", status: "won", actualClose: "2026-08-01", probability: 100, category: "closed" });
    ids.o7 = await fx.opportunity(pipe, { ownerId: carol, amount: 700, status: "lost", actualClose: "2026-07-10", probability: 0, category: "omitted" });
    ids.o8 = await fx.opportunity(pipe, { amount: 400, probability: 50 });
    ids.o9 = await fx.opportunity(pipe, { ownerId: alice, amount: 600, probability: 50, stageEnteredAt: daysAgo(60) });
    ids.o10 = await fx.opportunity(pipe, { ownerId: carol, amount: 2000, status: "won", actualClose: "2026-10-05", probability: 100, category: "closed" });
    // Another organisation's deals are never counted.
    await crmFixtures(kit, other).opportunity(await crmFixtures(kit, other).pipeline(), { ownerId: other.ids.mallory, amount: 999999 });

    await fx.quota({ userId: alice, start: "2026-07-01", end: "2026-09-30", amount: 9200 });
    await fx.quota({ userId: bob, start: "2026-07-01", end: "2026-12-31", amount: 100, currency: "USD" });
    await fx.quota({ teamId: south, start: "2026-07-01", end: "2026-09-30", amount: 5000 });

    const admin = org.session("admin", ADMIN);
    const rep = org.session("alice", REP);
    const manager = org.session("manny", MANAGER);
    const run = (session, work) => kit.tenant(org.organizationId, (client) => work(client, session));
    const metrics = (session, filters = {}) => run(session, (client, ctx) => getPipelineMetrics(client, ctx, { ...PERIOD, ...filters }));

    await t.test("golden KPIs for an organisation-wide viewer", async () => {
      const { metrics: m, currency } = await metrics(admin);
      assert.deepEqual(
        { ...m },
        {
          open_opportunities: 6,
          open_pipeline: 16000,
          weighted_pipeline: 3300,
          closing_opportunities: 3,
          closing_in_period: 10000,
          weighted_closing: 2300,
          commit: 1000,
          best_case: 10000,
          forecast_pipeline: 10000,
          won_amount: 7000,
          won_count: 2,
          lost_amount: 700,
          lost_count: 1,
          win_rate: 66.67,
          stalled_opportunities: 1,
          unassigned_opportunities: 1,
        },
      );
      assert.equal(currency.reportingCurrency, "INR");
      assert.equal(currency.unconvertedCount, 1, "the EUR deal has no rate");
      assert.deepEqual(currency.unconvertedCurrencies, ["EUR"]);
    });

    await t.test("every KPI equals its drill-down total and its breakdown sum", async () => {
      for (const metric of ["open_pipeline", "weighted_pipeline", "closing_in_period", "commit", "best_case", "won_amount", "lost_amount", "open_opportunities", "stalled_opportunities", "unassigned_opportunities"]) {
        const kpi = (await metrics(admin)).metrics[metric];
        const records = [];
        let cursor = null;
        let first;
        do {
          const page = await run(admin, (client, ctx) => getMetricDrilldown(client, ctx, { metric, filters: PERIOD, cursor, limit: 2 }));
          first ??= page;
          records.push(...page.records);
          cursor = page.nextCursor;
        } while (cursor);
        assert.equal(first.summary.value, kpi, `${metric}: drill-down summary = KPI`);
        assert.equal(records.length, first.summary.count, `${metric}: paging returns every record exactly once`);
        assert.equal(new Set(records.map((record) => record.id)).size, records.length);
        if (!metric.endsWith("opportunities")) {
          const field = metric.startsWith("weighted") ? "weightedReporting" : "amountReporting";
          const sum = Math.round(records.reduce((total, record) => total + (record[field] ?? 0), 0) * 100) / 100;
          assert.equal(sum, kpi, `${metric}: sum of drill-down rows = KPI`);
          const breakdown = await run(admin, (client, ctx) => getPipelineBreakdown(client, ctx, { metric, dimension: "owner", filters: PERIOD }));
          assert.equal(Math.round(breakdown.rows.reduce((total, row) => total + row.value, 0) * 100) / 100, kpi, `${metric}: breakdown sums to KPI`);
        }
      }
    });

    await t.test("conversion uses the rate on the valuation date: close date for won, as-of for open", async () => {
      const won = await run(admin, (client, ctx) => getMetricDrilldown(client, ctx, { metric: "won_amount", filters: PERIOD }));
      const usdWon = won.records.find((record) => record.id === ids.o6);
      assert.equal(usdWon.fxRate, 80, "closed 2026-08-01, before the 90 rate took effect");
      assert.equal(usdWon.amountReporting, 4000);
      const open = await run(admin, (client, ctx) => getMetricDrilldown(client, ctx, { metric: "open_pipeline", filters: PERIOD }));
      const usdOpen = open.records.find((record) => record.id === ids.o2);
      assert.equal(usdOpen.fxRate, 90);
      const eur = open.records.find((record) => record.id === ids.o4);
      assert.equal(eur.amountReporting, null, "unconverted deals stay visible in the drill-down with no converted value");
      assert.equal(open.summary.unconvertedCount, 1);
    });

    await t.test("team filters roll up the hierarchy without double counting", async () => {
      assert.equal((await metrics(admin, { teamId: west })).metrics.open_pipeline, 15600);
      const india_ = (await metrics(admin, { teamId: india })).metrics;
      assert.equal(india_.open_pipeline, 15600, "parent = West + South (South's only open deal is EUR, unconverted)");
      assert.equal(india_.open_opportunities, 5, "the unassigned deal belongs to no team");
      assert.equal((await metrics(admin, { teamId: south })).metrics.won_amount, 0, "carol's won deal is outside the period");
      const byTeam = await run(admin, (client, ctx) => getPipelineBreakdown(client, ctx, { metric: "open_opportunities", dimension: "team", filters: PERIOD }));
      assert.equal(byTeam.rows.reduce((total, row) => total + row.count, 0), 6);
    });

    await t.test("a rep sees only what the Opportunities list shows them; a manager sees their team", async () => {
      const mine = (await metrics(rep)).metrics;
      assert.equal(mine.open_pipeline, 11000, "own + unassigned");
      assert.equal(mine.won_amount, 3000);
      assert.equal((await metrics(rep, { teamId: west })).metrics.open_pipeline, 10600, "a team filter never widens a rep's scope");
      const team = (await metrics(manager)).metrics;
      assert.equal(team.open_pipeline, 16000, "manager: West members + unassigned");
      assert.equal(team.won_amount, 7000);
      const drill = await run(rep, (client, ctx) => getMetricDrilldown(client, ctx, { metric: "open_pipeline", filters: PERIOD }));
      assert.ok(!drill.records.some((record) => [ids.o3, ids.o4].includes(record.id)), "no other seller's deal leaks through a drill-down");
    });

    await t.test("quota: user plans, proration, currency, team fallback, own-plan resolution and restriction", async () => {
      const dashboard = await run(admin, (client, ctx) => getPipelineDashboard(client, ctx, PERIOD));
      assert.equal(dashboard.quota.quota, 13700, "alice 9200 + bob USD 100 prorated 92/184 at 90 = 4500");
      assert.equal(dashboard.quota.attainmentPercent, 51.09);
      assert.equal((await run(admin, (client, ctx) => getPipelineDashboard(client, ctx, { ...PERIOD, teamId: west }))).quota.quota, 13700, "no West plan: members' plans");
      assert.equal((await run(admin, (client, ctx) => getPipelineDashboard(client, ctx, { ...PERIOD, teamId: south }))).quota.quota, 5000, "South's own plan");
      const own = await run(rep, (client, ctx) => getPipelineDashboard(client, ctx, { ...PERIOD, scope: "mine" }));
      assert.equal(own.quota.quota, 9200);
      assert.equal(own.quota.attainmentPercent, 32.61);
      const restricted = await run(rep, (client, ctx) => getPipelineDashboard(client, ctx, { ...PERIOD, teamId: west }));
      assert.deepEqual(restricted.quota, { available: false, reason: "restricted" });
    });

    await t.test("F030 pipeline/forecast/revenue-operations reports are rows of the same metrics", async () => {
      const kpi = (await metrics(admin)).metrics;
      const report = (key) => run(admin, (client, ctx) => getCrmReport(client, ctx, key, { from: PERIOD.from, to: PERIOD.to }));
      const sum = (rows, field) => Math.round(rows.reduce((total, row) => total + Number(row[field] || 0), 0) * 100) / 100;
      const pipeline = await report("pipeline");
      assert.equal(sum(pipeline.rows, "amount"), kpi.open_pipeline);
      assert.equal(sum(pipeline.rows, "weightedAmount"), kpi.weighted_pipeline);
      assert.equal(pipeline.currency.unconvertedCount, 1);
      const forecast = await report("forecast");
      assert.equal(sum(forecast.rows, "won"), kpi.won_amount);
      assert.equal(sum(forecast.rows, "commitAmount"), kpi.commit);
      assert.equal(sum(forecast.rows, "bestCase"), kpi.best_case);
      const revenue = await report("revenue-operations");
      const aliceRow = revenue.rows.find((row) => row.ownerUserId === alice);
      assert.equal(aliceRow.quota, 9200);
      assert.equal(aliceRow.won, 3000);
      assert.equal(aliceRow.quotaAttainmentPercent, 32.61);
      assert.equal(sum(revenue.rows, "won"), kpi.won_amount);
    });

    await t.test("malformed filters are a clear 400", async () => {
      await assert.rejects(metrics(admin, { teamId: "not-a-uuid" }), expectCode("CRM_ANALYTICS_FILTER_INVALID"));
      await assert.rejects(metrics(admin, { from: "2026-10-01", to: "2026-09-01" }), expectCode("CRM_ANALYTICS_RANGE_INVALID"));
      await assert.rejects(run(admin, (client, ctx) => getMetricDrilldown(client, ctx, { metric: "open_pipeline", filters: PERIOD, cursor: "garbage" })), expectCode("CRM_ANALYTICS_CURSOR_INVALID"));
      await assert.rejects(run(admin, (client, ctx) => getMetricDrilldown(client, ctx, { metric: "nope" })), expectCode("CRM_ANALYTICS_METRIC_UNKNOWN"));
    });
  } finally {
    await kit.close();
  }
});
