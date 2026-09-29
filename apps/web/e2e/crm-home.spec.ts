import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";

import { BASE_URL } from "./base-url";
import { getCrmWorld, openCrmSession, withCrmDb } from "./crm-mvp-fixtures";

// CRM Home (/crm) is the one CRM overview: scope and period controls, four
// KPIs, four charts and Needs attention. Every figure is a server
// aggregate from GET /api/crm/dashboard, and every figure drills into the
// list behind it. /crm/dashboard only redirects here.

type Dashboard = {
  scope: string;
  period: { from: string; to: string };
  metrics: Record<string, number | string | null>;
  stages: Array<{ id: string; name: string; opportunityCount: number }>;
  qualification: Array<{ key: string; count: number }>;
  leadTrend: Array<{ month: string; created: number; converted: number }>;
  sourcePerformance: Array<{ name: string; leadCount: number }>;
};

const origin = new URL(BASE_URL).origin;

async function dashboardFor(page: Page, query: string): Promise<Dashboard> {
  const response = await page.request.get(
    `${origin}/api/crm/dashboard?${query}`,
  );
  expect(response.status()).toBe(200);
  return (await response.json()).dashboard as Dashboard;
}

async function openHome(page: Page, path = "/crm") {
  const request = page.waitForRequest(
    (req) => req.url().includes("/api/crm/dashboard"),
    { timeout: 150_000 },
  );
  await page.goto(path, { waitUntil: "domcontentloaded", timeout: 150_000 });
  const first = await request;
  await expect(
    page.getByRole("heading", { level: 1, name: "CRM" }),
  ).toBeVisible({
    timeout: 120_000,
  });
  await expect(
    page.getByRole("heading", { name: "Pipeline by stage" }),
  ).toBeVisible({
    timeout: 60_000,
  });
  return new URL(first.url());
}

const scopeButton = (page: Page, name: string) =>
  page
    .getByRole("group", { name: "Scope" })
    .getByRole("button", { name, exact: true });

const monthLabel = (month: string) => {
  const [year, monthNumber] = month.split("-").map(Number);
  return new Intl.DateTimeFormat("en-IN", {
    month: "short",
    year: "2-digit",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(year, monthNumber - 1, 1)));
};

test.describe("CRM Home", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  test("is the one CRM overview: no Dashboard item, no sitemap, defaults to Mine, and never downloads raw records", async ({
    page,
  }) => {
    const listCalls: string[] = [];
    page.on("request", (req) => {
      if (
        /\/api\/crm\/(leads|opportunities|accounts|contacts)(\?|$)/.test(
          req.url(),
        )
      )
        listCalls.push(req.url());
    });
    const request = await openHome(page);
    expect(
      request.searchParams.get("scope"),
      "Home asks for Mine explicitly",
    ).toBe("mine");
    await expect(scopeButton(page, "Mine")).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByText(/Welcome back/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create" })).toBeVisible();

    // The CRM sidebar may start collapsed at this width.
    const showNav = page.getByRole("button", { name: "Show CRM navigation" });
    if (await showNav.isVisible()) await showNav.click();
    const nav = page.getByRole("navigation", { name: "CRM navigation" });
    await expect(
      nav.getByRole("link", { name: "Home", exact: true }),
    ).toBeVisible();
    await expect(
      nav.getByRole("link", { name: "Dashboard", exact: true }),
    ).toHaveCount(0);
    await expect(
      nav.getByRole("link", { name: "Reports", exact: true }),
    ).toBeVisible();
    // The old sitemap of navigation cards is gone from the page itself.
    const main = page.locator("main");
    for (const name of [
      "Duplicate Management",
      "Imports & Exports",
      "Pipeline Stages",
    ])
      await expect(main.getByRole("link", { name, exact: true })).toHaveCount(
        0,
      );

    for (const name of [
      "Pipeline by stage",
      "Lead qualification",
      "Lead momentum",
      "Lead source performance",
      "Needs attention",
    ])
      await expect(page.getByRole("heading", { name })).toBeVisible();
    expect(listCalls, "every Home figure is a server aggregate").toEqual([]);
  });

  test("/crm/dashboard redirects to Home, keeping only the scope and period", async ({
    page,
  }) => {
    await page.goto("/crm/dashboard?scope=team&period=last_month&unrelated=1", {
      waitUntil: "domcontentloaded",
      timeout: 150_000,
    });
    await expect(page).toHaveURL(/\/crm\?scope=team&period=last_month$/, {
      timeout: 120_000,
    });
    await expect(scopeButton(page, "My team")).toHaveAttribute(
      "aria-pressed",
      "true",
      {
        timeout: 120_000,
      },
    );
  });

  test("Mine, My team and All each ask the server for that scope and are kept in the URL", async ({
    page,
  }) => {
    await openHome(page);
    // Mine was loaded on arrival (and stays cached for 30s), so only Team
    // and All must go to the server; every switch lands in the URL.
    for (const [label, scope, fetches] of [
      ["My team", "team", true],
      ["All I can see", "all", true],
      ["Mine", "mine", false],
    ] as const) {
      const request = page.waitForRequest(
        (req) =>
          req.url().includes("/api/crm/dashboard") &&
          new URL(req.url()).searchParams.get("scope") === scope,
      );
      await scopeButton(page, label).click();
      if (fetches) await request;
      else request.catch(() => undefined);
      await expect(page).toHaveURL(new RegExp(`scope=${scope}`));
      await expect(scopeButton(page, label)).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    }
  });

  test("charts show the server's own figures, with an accessible table for each", async ({
    page,
  }) => {
    await openHome(page, "/crm?scope=all");
    const dashboard = await dashboardFor(page, "scope=all");

    // Lead momentum: exactly six calendar months, zero months included.
    expect(dashboard.leadTrend).toHaveLength(6);
    const momentum = page.getByRole("region", { name: "Lead momentum" });
    if (dashboard.leadTrend.some((m) => m.created + m.converted > 0)) {
      const table = momentum.getByRole("table", {
        name: "New and converted leads per month",
      });
      await expect(table.locator("tbody tr")).toHaveCount(6);
      for (const month of dashboard.leadTrend) {
        const row = table.getByRole("row", {
          name: new RegExp(`^${monthLabel(month.month)}\\b`),
        });
        await expect(row.getByRole("cell").first()).toHaveText(
          month.created.toLocaleString("en-IN"),
        );
        await expect(row.getByRole("cell").nth(1)).toHaveText(
          month.converted.toLocaleString("en-IN"),
        );
      }
    } else {
      await expect(
        momentum.getByText("No leads were created in the last six months."),
      ).toBeVisible();
    }

    // Lead qualification: every bucket's exact count and share, in words.
    const qualificationTotal = dashboard.qualification.reduce(
      (sum, row) => sum + row.count,
      0,
    );
    expect(qualificationTotal).toBe(Number(dashboard.metrics.openLeads));
    const qualification = page.getByRole("region", {
      name: "Lead qualification",
    });
    if (qualificationTotal > 0) {
      const list = qualification.getByRole("list", {
        name: "Active leads by qualification decision",
      });
      const labels = {
        qualified: "Qualified",
        not_reviewed: "Not reviewed",
        unqualified: "Unqualified",
      } as Record<string, string>;
      for (const row of dashboard.qualification) {
        const share =
          row.count === 0
            ? "0%"
            : row.count / qualificationTotal < 0.01
              ? "<1%"
              : `${Math.round((row.count / qualificationTotal) * 100)}%`;
        await expect(
          list
            .getByRole("listitem")
            .filter({ hasText: new RegExp(`^${labels[row.key]}`) }),
        ).toContainText(`${row.count.toLocaleString("en-IN")}${share}`);
      }
    } else {
      await expect(
        qualification.getByText("No lead qualification data yet."),
      ).toBeVisible();
    }

    // Pipeline by stage: real stage names and counts in configured order,
    // and the table's stage links open the filtered Opportunities list.
    const pipeline = page.getByRole("region", { name: "Pipeline by stage" });
    if (dashboard.stages.some((stage) => stage.opportunityCount > 0)) {
      await pipeline.getByRole("button", { name: "Show table" }).click();
      const table = pipeline.getByRole("table", { name: "Pipeline by stage" });
      await expect(table.locator("tbody th")).toHaveText(
        dashboard.stages.map((stage) => stage.name),
      );
      for (const stage of dashboard.stages)
        await expect(
          table
            .getByRole("row", { name: new RegExp(`^${stage.name}\\b`) })
            .getByRole("cell")
            .nth(2),
        ).toHaveText(stage.opportunityCount.toLocaleString("en-IN"));
      const busiest = dashboard.stages.find(
        (stage) => stage.opportunityCount > 0,
      )!;
      await table
        .getByRole("link", { name: busiest.name, exact: true })
        .click();
      await expect(page).toHaveURL(
        new RegExp(`/crm/opportunities\\?status=open&stageId=${busiest.id}$`),
        { timeout: 90_000 },
      );
    } else {
      await expect(
        pipeline.getByText("No open opportunities yet."),
      ).toBeVisible();
    }
  });

  test("a seller's Home counts only records they may open, and every KPI opens the list behind it", async ({
    browser,
  }) => {
    const world = await getCrmWorld();
    const stamp = `${world.suffix}home`;
    // Two leads for the seller (one qualified), one for the other seller.
    await withCrmDb(world.organizationId, async (db) => {
      const companyId = (
        await db.query(
          `SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`,
          [world.organizationId],
        )
      ).rows[0].id as string;
      const insert = (owner: string, n: number, qualified: boolean) =>
        db.query(
          `INSERT INTO tenant.crm_leads(organization_id,company_id,code,first_name,last_name,email,owner_user_id,qualification_state,qualification_decided_at,qualification_decided_by_user_id)
           VALUES ($1,$2,$3,'Home',$4,$5,$6,$7,$8,$9)`,
          [
            world.organizationId,
            companyId,
            `HOME-${stamp}-${n}`,
            `Lead ${stamp} ${n}`,
            `home.${stamp}.${n}@home.test`,
            owner,
            qualified ? "qualified" : "not_reviewed",
            qualified ? new Date() : null,
            qualified ? world.manager.userId : null,
          ],
        );
      await insert(world.rep.userId, 1, true);
      await insert(world.rep.userId, 2, false);
      await insert(world.rep2.userId, 3, false);
    });

    const rep = await openCrmSession(browser, world.rep);
    const manager = await openCrmSession(browser, world.manager);
    try {
      const page = rep.page;
      await openHome(page);
      const listTotal = async (p: Page, query: string) => {
        const response = await p.request.get(
          `${origin}/api/crm/leads?limit=1&${query}`,
        );
        expect(response.status()).toBe(200);
        return (await response.json()).total as number;
      };
      // "All I can see" for a seller is their own + unassigned leads — never a
      // colleague's. Each aggregate equals the list the seller can open.
      for (const scope of ["mine", "all"]) {
        const dashboard = await dashboardFor(page, `scope=${scope}`);
        const visible = await listTotal(
          page,
          scope === "mine" ? "ownerId=me" : "",
        );
        expect(Number(dashboard.metrics.openLeads), scope).toBe(visible);
        expect(
          dashboard.qualification.reduce((sum, row) => sum + row.count, 0),
          scope,
        ).toBe(visible);
      }
      const mine = await dashboardFor(page, "scope=mine");
      expect(Number(mine.metrics.openLeads)).toBeGreaterThanOrEqual(2);
      expect(
        mine.qualification.find((row) => row.key === "qualified")?.count,
      ).toBeGreaterThanOrEqual(1);
      // The manager's team scope includes both sellers' leads.
      const team = await dashboardFor(manager.page, "scope=team");
      expect(Number(team.metrics.openLeads)).toBeGreaterThanOrEqual(3);

      // KPI drill-downs open the exact filtered list.
      const openLeads = page.getByRole("link", {
        name: `${Number(mine.metrics.openLeads)} open leads, ${Number(mine.metrics.qualifiedLeads)} qualified. Open the list`,
      });
      await expect(openLeads).toHaveAttribute("href", "/crm/leads?ownerId=me");
      await openLeads.click();
      await expect(page).toHaveURL(/\/crm\/leads\?ownerId=me$/, {
        timeout: 90_000,
      });
      await expect(page.getByText(`Home Lead ${stamp} 1`).first()).toBeVisible({
        timeout: 60_000,
      });
      await expect(page.getByText(`Home Lead ${stamp} 3`)).toHaveCount(0);

      await openHome(page);
      const home = await dashboardFor(page, "scope=mine");
      await expect(
        page.getByRole("link", {
          name: /Open pipeline .*Open these opportunities$/,
        }),
      ).toHaveAttribute("href", "/crm/opportunities?status=open&ownerId=me");
      await expect(
        page.getByRole("link", { name: /^Won .*Open these opportunities$/ }),
      ).toHaveAttribute(
        "href",
        `/crm/opportunities?status=won&closedFrom=${home.period.from}&closedTo=${home.period.to}&ownerId=me`,
      );
      await expect(
        page.getByRole("link", { name: /open opportunit.*Open the list$/ }),
      ).toHaveAttribute("href", "/crm/opportunities?status=open&ownerId=me");
      // Needs attention: the awaiting-qualification item opens its list.
      const attention = page.getByRole("region", { name: "Needs attention" });
      await attention
        .getByRole("link", { name: /Leads awaiting qualification/ })
        .click();
      await expect(page).toHaveURL(
        /\/crm\/leads\?qualification=not_reviewed&ownerId=me$/,
        { timeout: 90_000 },
      );
    } finally {
      await rep.context.close();
      await manager.context.close();
    }
  });

  for (const size of [
    { name: "phone", width: 360, height: 800 },
    { name: "tablet", width: 768, height: 1024 },
    { name: "desktop", width: 1280, height: 900 },
  ])
    test(`charts fit a ${size.name} screen without sideways scrolling`, async ({
      page,
    }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openHome(page, "/crm?scope=all");
      await page.waitForTimeout(1_000);
      const overflow = await page.evaluate(
        () =>
          document.documentElement.scrollWidth -
          document.documentElement.clientWidth,
      );
      expect(
        overflow,
        `the page is ${overflow}px wider than the screen`,
      ).toBeLessThanOrEqual(1);
      await expect(page.getByRole("button", { name: "Create" })).toBeVisible();
    });

  test("has no critical or serious accessibility violations, with the chart tables open", async ({
    page,
  }) => {
    await openHome(page, "/crm?scope=all");
    // Each toggle becomes "Hide table" once opened.
    const showTable = page.getByRole("button", { name: "Show table" });
    while ((await showTable.count()) > 0) await showTable.first().click();
    await expect(
      page.getByRole("button", { name: "Hide table" }),
    ).not.toHaveCount(0);
    const results = await new AxeBuilder({ page })
      .withTags(["wcag2a", "wcag2aa"])
      .analyze();
    const blocking = results.violations.filter(
      (v) => v.impact === "critical" || v.impact === "serious",
    );
    expect(
      blocking,
      blocking
        .map(
          (v) =>
            `${v.id} (${v.impact}): ${v.help} — ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
        )
        .join("\n"),
    ).toEqual([]);
  });
});
