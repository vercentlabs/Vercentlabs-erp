import { expect as baseExpect, test, type Page } from "@playwright/test";

import { getCrmWorld, openCrmSession } from "./crm-mvp-fixtures";

// The CRM information architecture as real people with the real built-in
// roles: a compact set of workspaces in the CRM sidebar, every other
// capability reached inside its workspace, legacy addresses still working,
// and nothing listed that the person may not open.
test.describe.configure({ mode: "serial", timeout: 600_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

// The unpinned CRM flyout opens while the pointer is over the module rail
// (a mouse user's path) and closes once the pointer and focus leave it.
async function openSidebar(page: Page) {
  const nav = page.getByRole("navigation", { name: "CRM navigation" });
  await expect(async () => {
    await page.mouse.move(1100, 650);
    await page.mouse.move(28, 360, { steps: 4 });
    await expect(nav).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 60_000 });
  return nav;
}

async function closeSidebar(page: Page) {
  await page.mouse.move(1100, 650, { steps: 4 });
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  await expect(
    page.getByRole("navigation", { name: "CRM navigation" }),
  ).toBeHidden();
}

async function sidebarLabels(page: Page) {
  const nav = await openSidebar(page);
  const labels = await nav.getByRole("link").allInnerTexts();
  await closeSidebar(page);
  return labels;
}

async function activeWorkspace(page: Page) {
  const nav = await openSidebar(page);
  const label = await nav.locator('a[aria-current="page"]').innerText();
  await closeSidebar(page);
  return label;
}

async function goToWorkspace(page: Page, label: string) {
  const nav = await openSidebar(page);
  await nav.getByRole("link", { name: label, exact: true }).click();
  await closeSidebar(page);
}

// Only the global rail and the CRM sidebar persist; a page may add its own
// breadcrumb and in-content view navigation, never another sidebar.
async function persistentNavigation(page: Page) {
  await openSidebar(page);
  const names = await page
    .getByRole("navigation")
    .evaluateAll((navs) =>
      navs.map((nav) => nav.getAttribute("aria-label") ?? ""),
    );
  return names.filter(
    (name) => !["Breadcrumb", "My Work", "Pagination"].includes(name),
  );
}

test("Journey 1 — a seller moves through the compact CRM workspaces", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const { context, page } = await openCrmSession(browser, world.rep);
  try {
    await page.goto("/crm");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      "Welcome back",
    );
    expect(await sidebarLabels(page)).toEqual([
      "Home",
      "Leads",
      "Accounts",
      "Contacts",
      "Opportunities",
      "My Work",
      "Forecast",
      "Reports",
    ]);
    expect(await activeWorkspace(page)).toBe("Home");

    for (const [label, path, heading] of [
      ["Leads", "/crm/leads", "Leads"],
      ["Accounts", "/crm/accounts", "Accounts"],
      ["Contacts", "/crm/contacts", "Contacts"],
      ["Opportunities", "/crm/opportunities", "Opportunities"],
    ] as const) {
      await goToWorkspace(page, label);
      // Lists may add their own paging state (e.g. ?offset=0).
      await expect(page).toHaveURL(new RegExp(`${path}(?:[?]|$)`));
      await expect(
        page.getByRole("heading", { level: 1, name: heading }),
      ).toBeVisible();
      expect(await activeWorkspace(page)).toBe(label);
    }

    // Opportunities: List and Pipeline are two views of one workspace.
    await page.getByRole("button", { name: "Pipeline", exact: true }).click();
    await expect(page).toHaveURL(/\/crm\/opportunities\?view=pipeline$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Pipeline" }),
    ).toBeVisible();
    expect(await activeWorkspace(page)).toBe("Opportunities");
    await page.getByRole("button", { name: "List", exact: true }).click();
    await expect(page).toHaveURL(/\/crm\/opportunities\?view=list$/);

    // My Work: Today, then the Tasks and Calls views, in the content area.
    await goToWorkspace(page, "My Work");
    await expect(page).toHaveURL(/\/crm\/work$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Today" }),
    ).toBeVisible();
    const views = page.getByRole("navigation", { name: "My Work" });
    await views.getByRole("link", { name: "Tasks" }).click();
    await expect(page).toHaveURL(/\/crm\/work\?view=tasks$/);
    await expect(views.getByRole("link", { name: "Tasks" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await views.getByRole("link", { name: "Calls" }).click();
    await expect(page).toHaveURL(/\/crm\/work\?view=calls$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "Calls" }),
    ).toBeVisible();
    expect(await activeWorkspace(page)).toBe("My Work");
    expect(await persistentNavigation(page)).toEqual([
      "Primary",
      "CRM navigation",
    ]);
  } finally {
    await context.close();
  }
});

test("Journey 2 — one searchable report picker, addressable by URL", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const { context, page } = await openCrmSession(browser, world.manager);
  try {
    await page.goto("/crm/reports?report=forecast");
    await expect(
      page.getByRole("heading", { level: 2, name: "Forecast by owner" }),
    ).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Report library" }),
    ).toHaveCount(0);

    const picker = page.getByRole("combobox", { name: "Report" });
    await picker.click();
    await picker.fill("pipeline");
    const listbox = page.getByRole("listbox");
    await expect(
      listbox.getByRole("option", { name: "Pipeline by stage" }),
    ).toBeVisible();
    await expect(
      listbox.getByRole("option", { name: "Lead sources" }),
    ).toHaveCount(0);
    await listbox.getByRole("option", { name: "Pipeline by stage" }).click();
    await expect(listbox).toBeHidden();
    await expect(page).toHaveURL(/report=pipeline(&|$)/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Pipeline by stage" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "Last 30 days" }).click();
    await expect(page).toHaveURL(/from=\d{4}-\d{2}-\d{2}/);
    const exportLink = page.getByRole("link", { name: /Export CSV/ });
    await expect(exportLink).toHaveAttribute(
      "href",
      /\/api\/crm\/reports\/pipeline\/export\?from=/,
    );

    await page.reload();
    await expect(
      page.getByRole("heading", { level: 2, name: "Pipeline by stage" }),
    ).toBeVisible();
    await expect(page).toHaveURL(/report=pipeline/);
    await page.goBack();
    await expect(page).toHaveURL(/report=pipeline(&|$)/);
    await page.goBack();
    await expect(page).toHaveURL(/report=forecast/);
    await expect(
      page.getByRole("heading", { level: 2, name: "Forecast by owner" }),
    ).toBeVisible();
    expect(await persistentNavigation(page)).toEqual([
      "Primary",
      "CRM navigation",
    ]);
  } finally {
    await context.close();
  }
});

test("Journey 3 — CRM Setup is a hub in the content area, not a third sidebar", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const { context, page } = await openCrmSession(browser, world.admin);
  try {
    await page.goto("/crm");
    await goToWorkspace(page, "CRM Setup");
    await expect(page).toHaveURL(/\/crm\/settings$/);
    await expect(
      page.getByRole("heading", { level: 1, name: "CRM Setup" }),
    ).toBeVisible();
    const categories = page.getByRole("list", { name: "CRM Setup categories" });
    await categories
      .getByRole("link", { name: /Routing & organization/ })
      .click();
    await expect(page).toHaveURL(/section=routing-organization$/);
    await page
      .getByRole("list", { name: "Routing & organization settings" })
      .getByRole("link", { name: /Territories & Sales Teams/ })
      .click();
    await expect(page).toHaveURL(/\/crm\/settings\/territories$/);
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb).toContainText("CRM Setup");
    await expect(breadcrumb).toContainText("Routing & organization");
    await expect(breadcrumb).toContainText("Territories & Sales Teams");
    expect(await activeWorkspace(page)).toBe("CRM Setup");
    expect(await persistentNavigation(page)).toEqual([
      "Primary",
      "CRM navigation",
    ]);
  } finally {
    await context.close();
  }
});

test("Journey 4 — legacy addresses resolve into their workspace", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const { context, page } = await openCrmSession(browser, world.admin);
  try {
    for (const [from, landsOn, workspace] of [
      [
        "/crm/pipeline",
        /\/crm\/opportunities\?view=pipeline$/,
        "Opportunities",
      ],
      [
        "/crm/tasks?due=overdue",
        /\/crm\/work\?due=overdue&view=tasks$/,
        "My Work",
      ],
      ["/crm/calls", /\/crm\/work\?view=calls$/, "My Work"],
      ["/crm/meetings", /\/crm\/work\?view=meetings$/, "My Work"],
      ["/crm/communications", /\/crm\/work\?view=inbox$/, "My Work"],
      ["/crm/dashboard?period=this_month", /\/crm\?period=this_month$/, "Home"],
      ["/crm/settings/assignment", /\/crm\/settings\/assignment$/, "CRM Setup"],
      ["/crm/data/duplicates", /\/crm\/data\/duplicates$/, "CRM Setup"],
    ] as const) {
      await page.goto(from);
      await expect(page).toHaveURL(landsOn);
      expect(await activeWorkspace(page), from).toBe(workspace);
    }
  } finally {
    await context.close();
  }
});

test("Journey 5 — nobody is shown a destination they cannot open", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const rep = await openCrmSession(browser, world.rep);
  try {
    await rep.page.goto("/crm");
    expect(await sidebarLabels(rep.page)).not.toContain("CRM Setup");
    await rep.page.goto("/search?q=territor");
    await expect(
      rep.page.getByRole("heading", { level: 1, name: /Search/ }),
    ).toBeVisible();
    await expect(
      rep.page.getByRole("link", { name: /Territories & Sales Teams/ }),
    ).toHaveCount(0);
  } finally {
    await rep.context.close();
  }
  const marketing = await openCrmSession(browser, world.marketing);
  try {
    await marketing.page.goto("/crm");
    const labels = await sidebarLabels(marketing.page);
    expect(labels).not.toContain("Forecast");
    expect(labels).toContain("Reports");
    await marketing.page.goto("/crm/settings");
    // Only what this role may open: the import tool, not the admin pages.
    await expect(
      marketing.page.getByRole("link", { name: /Data management/ }),
    ).toBeVisible();
    await expect(
      marketing.page.getByRole("link", { name: /Sales process/ }),
    ).toHaveCount(0);
  } finally {
    await marketing.context.close();
  }
  const admin = await openCrmSession(browser, world.admin);
  try {
    await admin.page.goto("/search?q=territor");
    await expect(
      admin.page.getByRole("link", { name: /Territories & Sales Teams/ }),
    ).toBeVisible();
    await expect(
      admin.page.getByText(/CRM › CRM Setup › Routing & organization/),
    ).toBeVisible();
  } finally {
    await admin.context.close();
  }
});
