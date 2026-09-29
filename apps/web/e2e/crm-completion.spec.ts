import { randomUUID } from "node:crypto";

import {
  expect as baseExpect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";

import { getCrmWorld, openCrmSession, withCrmDb } from "./crm-mvp-fixtures";
import { runWorkerJobs } from "./crm-worker";

// CRM completion journeys as real people with the real built-in roles:
//   C  opportunity -> quotation handoff keeps the CRM link
//   D  sales coverage: team view, governed reassignment, restricted seller
//   E  large lead import: dry run, background job, progress, error download
//   F  pipeline dashboard -> drill-down -> forecast submit/review/snapshot/lock
//      -> saved report run
// Background steps run through the real worker code (e2e/crm-worker.ts).

// Each journey spans several people and pages and waits on the worker; the
// default config's 45 s test / 5 s assertion budgets are for single-page specs
// (the CRM config uses the same values as here).
test.describe.configure({ mode: "serial", timeout: 600_000 });
const expect = baseExpect.configure({ timeout: 60_000 });

// Report runs executed in this process write their file where the web server
// reads it (local storage; the same root default on one machine).
process.env.FILE_STORAGE_DRIVER ??= "local";

async function choose(page: Page, trigger: Locator, option: string | RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

type Seed = {
  pipelineId: string;
  stageId: string;
  partyId: string;
  opportunityId: string;
  leadName: string;
  leadId: string;
  periodName: string;
  itemCode: string;
};
let seed: Seed;

test.beforeAll(async () => {
  const world = await getCrmWorld();
  seed = await withCrmDb(world.organizationId, async (client) => {
    const company = (
      await client.query(
        `SELECT id FROM public.companies WHERE organization_id=$1 AND is_primary=true LIMIT 1`,
        [world.organizationId],
      )
    ).rows[0].id as string;
    let stage = (
      await client.query(
        `SELECT stage.id AS stage_id, stage.pipeline_id FROM tenant.crm_pipeline_stages stage JOIN tenant.crm_pipelines pipeline ON pipeline.id=stage.pipeline_id
          WHERE stage.organization_id=$1 AND stage.status='active' AND NOT stage.is_won AND NOT stage.is_lost AND pipeline.status='active'
          ORDER BY pipeline.is_default DESC, stage.sequence LIMIT 1`,
        [world.organizationId],
      )
    ).rows[0];
    if (!stage) {
      const pipelineId = randomUUID();
      const stageId = randomUUID();
      await client.query(
        `INSERT INTO tenant.crm_pipelines(id,organization_id,company_id,name,code,is_default,status) VALUES($1,$2,$3,'E2E Sales',$4,true,'active')`,
        [pipelineId, world.organizationId, company, `E2E-${world.suffix}`],
      );
      await client.query(
        `INSERT INTO tenant.crm_pipeline_stages(id,organization_id,pipeline_id,name,code,sequence,probability,status) VALUES($1,$2,$3,'Qualify',$4,1,20,'active')`,
        [stageId, world.organizationId, pipelineId, `Q-${world.suffix}`],
      );
      stage = { stage_id: stageId, pipeline_id: pipelineId };
    }
    const partyId = randomUUID();
    await client.query(
      `INSERT INTO tenant.business_parties(id,organization_id,company_id,code,party_type,display_name,status,owner_user_id) VALUES($1,$2,$3,$4,'customer',$5,'active',$6)`,
      [
        partyId,
        world.organizationId,
        company,
        `E2E-P-${world.suffix}`,
        `Completion Customer ${world.suffix}`,
        world.rep.userId,
      ],
    );
    // Journey C saves a real quotation: the customer needs a billing state
    // (GST) and the rep needs a sellable, taxed item.
    await client.query(
      `INSERT INTO tenant.addresses(organization_id,party_id,address_type,line1,city,state,state_code,postal_code,country_code,is_primary) VALUES ($1,$2,'billing','1 MG Road','Bengaluru','Karnataka','KA','560001','IN',true)`,
      [world.organizationId, partyId],
    );
    await client.query(
      `INSERT INTO tenant.sales_settings(organization_id,seller_state_code) VALUES ($1,'KA') ON CONFLICT DO NOTHING`,
      [world.organizationId],
    );
    const taxCategoryId = randomUUID();
    await client.query(
      `INSERT INTO tenant.tax_categories(id,organization_id,code,name,status) VALUES ($1,$2,$3,'CRM E2E GST','active')`,
      [taxCategoryId, world.organizationId, `CRMTAX-${world.suffix}`],
    );
    await client.query(
      `INSERT INTO tenant.tax_rates(organization_id,tax_category_id,name,code,tax_type,rate,status) VALUES ($1,$2,'GST 18%',$3,'gst',18,'active')`,
      [world.organizationId, taxCategoryId, `CRMGST-${world.suffix}`],
    );
    const itemCode = `E2E-CRM-${world.suffix}`;
    await client.query(
      `INSERT INTO tenant.items(organization_id,code,name,item_type,uom_id,tax_category_id,sales_price,standard_cost,status)
       SELECT $1,$2,'CRM E2E Service','product',uom.id,$3,1000,400,'active' FROM tenant.units_of_measure uom WHERE uom.organization_id=$1 AND uom.code='EA' AND uom.status='active' LIMIT 1`,
      [world.organizationId, itemCode, taxCategoryId],
    );
    const today = new Date();
    const inMonth = (day: number) =>
      new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), day))
        .toISOString()
        .slice(0, 10);
    const opportunityId = randomUUID();
    await client.query(
      `INSERT INTO tenant.crm_opportunities(id,organization_id,company_id,code,pipeline_id,stage_id,owner_user_id,party_id,name,amount,currency_code,probability,expected_close_date,status,forecast_category,stage_entered_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,125000,'INR',60,$10,'open','committed',now())`,
      [
        opportunityId,
        world.organizationId,
        company,
        `E2E-O-${world.suffix}`,
        stage.pipeline_id,
        stage.stage_id,
        world.rep.userId,
        partyId,
        `Completion Deal ${world.suffix}`,
        inMonth(25),
      ],
    );
    await client.query(
      `INSERT INTO tenant.crm_opportunities(organization_id,company_id,code,pipeline_id,stage_id,owner_user_id,party_id,name,amount,currency_code,probability,expected_close_date,status,forecast_category,stage_entered_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,40000,'INR',30,$9,'open','best_case',now())`,
      [
        world.organizationId,
        company,
        `E2E-O2-${world.suffix}`,
        stage.pipeline_id,
        stage.stage_id,
        world.rep2.userId,
        partyId,
        `Second Deal ${world.suffix}`,
        inMonth(20),
      ],
    );
    const leadId = randomUUID();
    const leadName = `Unowned ${world.suffix}`;
    await client.query(
      `INSERT INTO tenant.crm_leads(id,organization_id,company_id,code,first_name,last_name,email,owner_user_id,created_at)
       VALUES($1,$2,$3,$4,'Unowned',$5,$6,NULL,'2000-01-01'::timestamptz + ($7 || ' milliseconds')::interval)`,
      [
        leadId,
        world.organizationId,
        company,
        `E2E-L-${world.suffix}`,
        world.suffix,
        `unowned-${world.suffix}@e2e.test`,
        String(Date.now() % 1_000_000),
      ],
    );
    const periodName = `E2E Forecast ${world.suffix}`;
    const end = new Date(
      Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + 1, 0),
    );
    end.setUTCDate(end.getUTCDate() + 1 + Math.floor(Math.random() * 300));
    await client.query(
      `INSERT INTO tenant.crm_forecast_periods(organization_id,company_id,name,period_type,period_start,period_end,status) VALUES($1,$2,$3,'custom',$4,$5,'open')`,
      [
        world.organizationId,
        company,
        periodName,
        inMonth(1),
        end.toISOString().slice(0, 10),
      ],
    );
    return {
      pipelineId: stage.pipeline_id,
      stageId: stage.stage_id,
      partyId,
      opportunityId,
      leadName,
      leadId,
      periodName,
      itemCode,
    };
  });
});

test("Journey D — coverage: a manager sees the team and reassigns an unowned lead; a seller cannot see coverage", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const { context, page } = await openCrmSession(browser, world.manager);
  try {
    await page.goto("/crm/coverage");
    await expect(
      page.getByRole("heading", { name: "Sales coverage", level: 1 }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("region", { name: "Sales teams" })
        .getByText(`MVP Team ${world.suffix}`),
    ).toBeVisible();
    const unassigned = page.getByRole("region", { name: "Unassigned work" });
    const checkbox = unassigned.getByRole("checkbox", {
      name: `Select ${seed.leadName}`,
    });
    await expect(checkbox).toBeVisible();
    // react-aria renders the native input under a styled box (see
    // pos-returns.spec.ts); select the row from the keyboard.
    await checkbox.focus();
    await page.keyboard.press("Space");
    await expect(checkbox).toBeChecked();
    await unassigned
      .getByRole("button", { name: /^Reassign 1 selected/ })
      .click();
    const dialog = page.getByRole("dialog");
    await choose(
      page,
      dialog.getByRole("button", { name: /New owner$/ }),
      world.rep.name,
    );
    await dialog
      .getByRole("textbox", { name: /^Reason/ })
      .fill("Territory rebalance");
    await dialog.getByRole("button", { name: "Reassign", exact: true }).click();
    await expect(
      page.getByRole("status").filter({ hasText: "1 reassigned" }),
    ).toBeVisible();
    const owner = await withCrmDb(world.organizationId, (client) =>
      client.query(`SELECT owner_user_id FROM tenant.crm_leads WHERE id=$1`, [
        seed.leadId,
      ]),
    );
    expect(owner.rows[0].owner_user_id).toBe(world.rep.userId);
  } finally {
    await context.close();
  }
  const rep = await openCrmSession(browser, world.rep);
  try {
    await rep.page.goto("/crm/coverage");
    await expect(
      rep.page.getByText("You don't have access to sales coverage"),
    ).toBeVisible();
  } finally {
    await rep.context.close();
  }
});

test("Journey F — dashboard KPI equals its drill-down, then forecast submit, review, snapshot and lock, then a saved report run", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const manager = await openCrmSession(browser, world.manager);
  try {
    const page = manager.page;
    await page.goto("/crm/dashboard?period=this_month");
    const tile = page.getByRole("button", {
      name: /^Open pipeline: .*Open the records behind this figure$/,
    });
    await expect(tile).toBeVisible();
    const dashboard = await (
      await page.request.get("/api/crm/analytics/pipeline")
    ).json();
    const drill = await (
      await page.request.get(
        "/api/crm/analytics/drilldown?metric=open_pipeline&limit=200",
      )
    ).json();
    expect(drill.drilldown.summary.value).toBe(
      dashboard.dashboard.metrics.open_pipeline,
    );
    expect(drill.drilldown.summary.count).toBe(
      dashboard.dashboard.metrics.open_opportunities,
    );
    await tile.click();
    const dialog = page.getByRole("dialog", { name: "Open pipeline" });
    await expect(
      dialog.getByRole("link", { name: `Completion Deal ${world.suffix}` }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(tile).toBeFocused();
  } finally {
    await manager.context.close();
  }

  const rep = await openCrmSession(browser, world.rep);
  try {
    const page = rep.page;
    await page.goto("/crm/forecast");
    await choose(
      page,
      page.getByRole("button", { name: /Period$/ }),
      new RegExp(seed.periodName),
    );
    const mine = page.getByRole("region", { name: "My forecast" });
    await mine
      .getByRole("spinbutton", { name: /^Commit/ })
      .or(mine.getByRole("textbox", { name: /^Commit/ }))
      .fill("120000");
    await mine
      .getByRole("spinbutton", { name: /^Best case/ })
      .or(mine.getByRole("textbox", { name: /^Best case/ }))
      .fill("150000");
    await mine.getByRole("button", { name: "Submit forecast" }).click();
    await expect(mine.getByText("Waiting for review")).toBeVisible();
  } finally {
    await rep.context.close();
  }

  const reviewer = await openCrmSession(browser, world.manager);
  try {
    const page = reviewer.page;
    await page.goto("/crm/forecast");
    await choose(
      page,
      page.getByRole("button", { name: /Period$/ }),
      new RegExp(seed.periodName),
    );
    await page
      .getByRole("button", { name: `Review ${world.rep.name}'s forecast` })
      .click();
    const dialog = page.getByRole("dialog");
    await choose(
      page,
      dialog.getByRole("button", { name: /Decision$/ }),
      "Adjust commit",
    );
    await dialog
      .getByRole("spinbutton", { name: /^Adjustment/ })
      .or(dialog.getByRole("textbox", { name: /^Adjustment/ }))
      .fill("-20000");
    await dialog
      .getByRole("textbox", { name: /^Reason/ })
      .fill("Legal review may slip");
    await dialog.getByRole("button", { name: "Save review" }).click();
    await expect(dialog).toBeHidden();
    const events = await withCrmDb(world.organizationId, (client) =>
      client.query(
        `SELECT event.event_type FROM tenant.crm_forecast_submission_events event JOIN tenant.crm_forecast_submissions submission ON submission.id=event.submission_id
          WHERE submission.owner_user_id=$1 AND submission.period_id=(SELECT id FROM tenant.crm_forecast_periods WHERE name=$2) ORDER BY event.created_at`,
        [world.rep.userId, seed.periodName],
      ),
    );
    expect(events.rows.map((row) => row.event_type)).toEqual([
      "submitted",
      "adjusted",
    ]);
  } finally {
    await reviewer.context.close();
  }

  const admin = await openCrmSession(browser, world.admin);
  try {
    const page = admin.page;
    await page.goto("/crm/forecast");
    await choose(
      page,
      page.getByRole("button", { name: /Period$/ }),
      new RegExp(seed.periodName),
    );
    await page.getByRole("button", { name: "Take snapshot" }).click();
    const snapshots = page.getByRole("region", { name: "Forecast snapshots" });
    await expect(snapshots.getByText("Manual")).toBeVisible();
    await page.getByRole("button", { name: "Lock period" }).click();
    await page
      .getByRole("alertdialog")
      .getByRole("button", { name: "Lock period" })
      .click();
    await expect(
      page.getByText("Frozen", { exact: true }).first(),
    ).toBeVisible();
    await expect(snapshots.getByText("Freeze")).toBeVisible();
  } finally {
    await admin.context.close();
  }

  const reports = await openCrmSession(browser, world.manager);
  try {
    const page = reports.page;
    await page.goto("/crm/reports");
    const section = page.getByRole("region", {
      name: "Saved and scheduled reports",
    });
    await section.getByRole("button", { name: "New saved report" }).click();
    const dialog = page.getByRole("dialog");
    await dialog
      .getByRole("textbox", { name: /^Name/ })
      .fill(`Pipeline by owner ${world.suffix}`);
    await choose(
      page,
      dialog.getByRole("button", { name: /Group by$/ }),
      "Owner",
    );
    await dialog.getByRole("button", { name: "Save report" }).click();
    await expect(
      section.getByRole("cell", {
        name: `Pipeline by owner ${world.suffix}`,
        exact: true,
      }),
    ).toBeVisible();
    await section
      .getByRole("button", { name: `Run Pipeline by owner ${world.suffix}` })
      .click();
    await expect(section.getByText(/being prepared/)).toBeVisible();
    await expect
      .poll(
        () => runWorkerJobs(world.organizationId, ["platform.reports.run"]),
        { timeout: 60_000 },
      )
      .toBeGreaterThan(0);
    await page.reload();
    const download = page.getByRole("link", { name: /^Download CSV/ }).first();
    await expect(download).toBeVisible();
    const csv = await (
      await page.request.get((await download.getAttribute("href"))!)
    ).text();
    expect(csv).toContain("Group");
  } finally {
    await reports.context.close();
  }
});

test("Journey E — a large lead import: dry run, background job, progress, completion and rejected-row download", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const { context, page } = await openCrmSession(browser, world.admin);
  try {
    const rows = ["First name,Last name,Email"];
    for (let index = 0; index < 110; index += 1)
      rows.push(
        `Bulk${index},${world.suffix},bulk${index}-${world.suffix}@import-e2e.test`,
      );
    rows.push(`,${world.suffix},noname-${world.suffix}@import-e2e.test`);
    rows.push(`Twice,${world.suffix},bulk0-${world.suffix}@import-e2e.test`);
    await page.goto("/crm/data/import-export");
    const importer = page.getByRole("region", { name: "Import leads" });
    await importer.locator("#import-file").setInputFiles({
      name: `bulk-${world.suffix}.csv`,
      mimeType: "text/csv",
      buffer: Buffer.from(rows.join("\n")),
    });
    await importer.getByRole("button", { name: "Continue" }).click();
    await importer.getByRole("button", { name: "Check the file" }).click();
    const importButton = importer.getByRole("button", {
      name: /^Import 110 leads$/,
    });
    await expect(importButton).toBeVisible();
    await importButton.click();
    await expect(
      importer.getByText(/Importing in the background/),
    ).toBeVisible();
    await expect
      .poll(() => runWorkerJobs(world.organizationId, ["crm.leads.import"]), {
        timeout: 120_000,
      })
      .toBeGreaterThan(0);
    await expect(importer.getByText("Completed with errors")).toBeVisible({
      timeout: 60_000,
    });
    const created = await withCrmDb(world.organizationId, (client) =>
      client.query(
        `SELECT count(*)::int AS n FROM tenant.crm_leads WHERE email LIKE $1`,
        [`%-${world.suffix}@import-e2e.test`],
      ),
    );
    expect(created.rows[0].n).toBe(110);
    const download = importer.getByRole("link", {
      name: "Download rejected rows",
    });
    const csv = await (
      await page.request.get((await download.getAttribute("href"))!)
    ).text();
    expect(csv).toContain("Repeats row 1 of this file");
    expect(csv).toContain("First name is required");
  } finally {
    await context.close();
  }
});

test("Journey C — an opportunity hands over to a Sales quotation and the quotation keeps the CRM link", async ({
  browser,
}) => {
  const world = await getCrmWorld();
  const { context, page } = await openCrmSession(browser, world.rep);
  try {
    await page.goto(`/crm/opportunities/${seed.opportunityId}`);
    await page.getByRole("button", { name: "Convert to Quotation" }).click();
    await expect(page).toHaveURL(/\/sales\/quotations\/new\?.*opportunity=/);
    expect(new URL(page.url()).searchParams.get("opportunity")).toBe(
      seed.opportunityId,
    );
    expect(new URL(page.url()).searchParams.get("customer")).toBe(seed.partyId);
    await expect(
      page.getByText(`Completion Deal ${world.suffix}`).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: /Select an item/ }).click();
    await page.getByRole("option", { name: new RegExp(seed.itemCode) }).click();
    await page.getByRole("button", { name: "Save quotation" }).click();
    await expect(page).toHaveURL(/\/sales\/quotations\/[0-9a-f-]{36}$/, {
      timeout: 60_000,
    });
    const quotationId = page.url().split("/").at(-1)!;
    const stored = await withCrmDb(world.organizationId, (client) =>
      client.query(
        `SELECT source_opportunity_id, party_id FROM tenant.sales_quotations WHERE id=$1`,
        [quotationId],
      ),
    );
    expect(stored.rows[0]).toEqual({
      source_opportunity_id: seed.opportunityId,
      party_id: seed.partyId,
    });
    // The opportunity shows the quotation it handed over to.
    await page.goto(`/crm/opportunities/${seed.opportunityId}`);
    const number = (
      await withCrmDb(world.organizationId, (client) =>
        client.query(
          `SELECT quotation_number FROM tenant.sales_quotations WHERE id=$1`,
          [quotationId],
        ),
      )
    ).rows[0].quotation_number as string;
    await expect(page.getByText(number).first()).toBeVisible();
  } finally {
    await context.close();
  }
});
