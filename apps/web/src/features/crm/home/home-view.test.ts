import { test } from "node:test";
import assert from "node:assert/strict";

import type { CrmDashboardMetrics } from "../dashboard/types.ts";
import {
  attentionItems,
  homeLinks,
  monthRange,
  presetRange,
  resolveHomeFilters,
} from "./home-view.ts";

const now = new Date("2026-09-29T10:00:00Z");
const params = (values: Record<string, string>) => (key: string) =>
  values[key] ?? null;

test("CRM Home opens on Mine and this month when the URL says nothing", () => {
  assert.deepEqual(resolveHomeFilters(params({}), now), {
    scope: "mine",
    preset: "this_month",
    from: "2026-09-01",
    to: "2026-09-29",
  });
});

test("scope and period come from the URL so a view can be bookmarked; junk falls back", () => {
  assert.equal(
    resolveHomeFilters(params({ scope: "team" }), now).scope,
    "team",
  );
  assert.equal(resolveHomeFilters(params({ scope: "all" }), now).scope, "all");
  assert.equal(
    resolveHomeFilters(params({ scope: "everyone" }), now).scope,
    "mine",
  );
  assert.deepEqual(resolveHomeFilters(params({ period: "last_month" }), now), {
    scope: "mine",
    preset: "last_month",
    from: "2026-08-01",
    to: "2026-08-31",
  });
  assert.deepEqual(
    resolveHomeFilters(
      params({ period: "custom", from: "2026-07-01", to: "2026-07-15" }),
      now,
    ),
    { scope: "mine", preset: "custom", from: "2026-07-01", to: "2026-07-15" },
  );
  assert.equal(
    resolveHomeFilters(
      params({ period: "custom", from: "2026-07-15", to: "2026-07-01" }),
      now,
    ).preset,
    "this_month",
    "an inverted custom range is not sent to the server",
  );
  assert.equal(
    resolveHomeFilters(params({ period: "forever" }), now).preset,
    "this_month",
  );
});

test("period presets resolve to explicit dates", () => {
  assert.deepEqual(presetRange("this_quarter", now), {
    from: "2026-07-01",
    to: "2026-09-29",
  });
  assert.deepEqual(presetRange("year_to_date", now), {
    from: "2026-01-01",
    to: "2026-09-29",
  });
  assert.deepEqual(presetRange("last_90_days", now), {
    from: "2026-07-02",
    to: "2026-09-29",
  });
  assert.equal(presetRange("custom", now), null);
});

test("a trend month drills into that calendar month exactly", () => {
  assert.deepEqual(monthRange("2026-02"), {
    from: "2026-02-01",
    to: "2026-02-28",
  });
  assert.deepEqual(monthRange("2026-12"), {
    from: "2026-12-01",
    to: "2026-12-31",
  });
});

test("every KPI and chart drill-down carries the scope's owner filter and the figure's own predicates", () => {
  const period = { from: "2026-09-01", to: "2026-09-29" };
  const mine = homeLinks("mine", period);
  assert.equal(
    mine.openOpportunities,
    "/crm/opportunities?status=open&ownerId=me",
  );
  assert.equal(mine.openLeads, "/crm/leads?ownerId=me");
  assert.equal(
    mine.wonInPeriod,
    "/crm/opportunities?status=won&closedFrom=2026-09-01&closedTo=2026-09-29&ownerId=me",
  );
  assert.equal(
    mine.stage("abc"),
    "/crm/opportunities?status=open&stageId=abc&ownerId=me",
  );
  assert.equal(
    mine.qualification("qualified"),
    "/crm/leads?qualification=qualified&ownerId=me",
  );
  assert.equal(
    mine.createdInMonth("2026-08"),
    "/crm/leads?includeConverted=true&createdFrom=2026-08-01&createdTo=2026-08-31&ownerId=me",
  );
  assert.equal(
    mine.convertedInMonth("2026-08"),
    "/crm/leads?status=converted&convertedFrom=2026-08-01&convertedTo=2026-08-31&ownerId=me",
  );
  assert.equal(
    mine.source("s1"),
    "/crm/leads?includeConverted=true&createdFrom=2026-09-01&createdTo=2026-09-29&sourceId=s1&ownerId=me",
  );
  assert.equal(
    mine.source(null),
    undefined,
    "Unspecified/Other have no exact filter, so no link",
  );
  assert.equal(mine.overdueTasks, "/crm/tasks?due=overdue&mine=true");

  const team = homeLinks("team", period);
  assert.equal(team.openLeads, "/crm/leads?ownerId=team");
  assert.equal(team.overdueTasks, "/crm/tasks?due=overdue&myTeam=true");

  const all = homeLinks("all", period);
  assert.equal(all.openLeads, "/crm/leads");
  assert.equal(all.overdueTasks, "/crm/tasks?due=overdue&mine=false");
});

test("Needs attention lists only non-zero actionable exceptions — never territories or hot leads", () => {
  const metrics = {
    overdueTasks: 2,
    stalledOpportunities: 0,
    unassignedLeads: 3,
    needsQualificationLeads: 5,
    dwellBreachedLeads: 0,
    highPriorityLeads: 9,
    uncoveredTerritories: 4,
  } as CrmDashboardMetrics;
  const items = attentionItems(
    metrics,
    homeLinks("all", { from: "2026-09-01", to: "2026-09-29" }),
  );
  assert.deepEqual(
    items.map((item) => [item.id, item.count, item.href]),
    [
      ["overdue-tasks", 2, "/crm/tasks?due=overdue&mine=false"],
      ["unassigned-leads", 3, "/crm/leads?ownerId=unassigned"],
      ["awaiting-qualification", 5, "/crm/leads?qualification=not_reviewed"],
    ],
  );
});
