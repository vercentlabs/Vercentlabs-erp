import { expect, test, type Locator, type Page } from "@playwright/test";

import { BASE_URL } from "./base-url";
import { getCrmWorld, openCrmSession, withCrmDb } from "./crm-mvp-fixtures";

// CRM MVP journeys (Leads, Accounts, Contacts, assignment, qualification,
// lifecycle, duplicates, conversion) as real people with the real built-in
// roles, through the normal screens. Every journey ends with a reload and a
// read-back, and the database is checked where the screen cannot show the
// invariant (history rows, one Opportunity per conversion).

const UUID = /[0-9a-f-]{36}/;

// React Aria selects: open the trigger, then choose the option. A trigger's
// accessible name is its current value followed by its label.
async function choose(page: Page, trigger: Locator, option: string | RegExp) {
  await expect(async () => {
    const wanted = page.getByRole("option", { name: option }).first();
    if (!(await wanted.isVisible())) await trigger.click({ timeout: 3_000 });
    await wanted.click({ timeout: 3_000 });
  }).toPass({ timeout: 45_000 });
}

async function selectTab(page: Page, name: string) {
  const tab = page.getByRole("tab", { name, exact: true });
  await expect(async () => {
    await tab.click();
    await expect(tab).toHaveAttribute("aria-selected", "true", {
      timeout: 2_000,
    });
  }).toPass({ timeout: 30_000 });
}

// A text input by its label (a required field's label carries a marker).
function textbox(scope: Page | Locator, label: string) {
  return scope.getByRole("textbox", { name: new RegExp(`^${label}\\b`) });
}

// A value in the record header (the first place a label appears).
function field(page: Page, label: string) {
  return page.getByText(label, { exact: true }).first().locator("..");
}

async function createLead(
  page: Page,
  lead: { first: string; last: string; email: string; company: string },
) {
  await page.goto("/crm/leads/new", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "New lead" })).toBeVisible({
    timeout: 120_000,
  });
  await textbox(page, "First name").fill(lead.first);
  await textbox(page, "Last name").fill(lead.last);
  await textbox(page, "Email").fill(lead.email);
  await textbox(page, "Company name").fill(lead.company);
  await page.getByRole("button", { name: "Create lead" }).click();
  await expect(page).toHaveURL(new RegExp(`/crm/leads/${UUID.source}$`), {
    timeout: 60_000,
  });
  return page.url().split("/").at(-1)!;
}

// A same-origin JSON POST through the signed-in browser session (the API
// refuses cross-site writes, so the Origin header is sent as a browser would).
async function post(page: Page, path: string, data: unknown) {
  const origin = new URL(BASE_URL).origin;
  const response = await page.request.post(`${origin}${path}`, {
    data,
    headers: { Origin: origin, "Content-Type": "application/json" },
  });
  return {
    status: response.status(),
    body: (await response.json()) as Record<string, unknown>,
  };
}

async function openLead(page: Page, leadId: string, heading: string) {
  await page.goto(`/crm/leads/${leadId}`, { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: heading })).toBeVisible({
    timeout: 120_000,
  });
}

async function qualify(page: Page) {
  await selectTab(page, "Qualification");
  await choose(
    page,
    page.getByRole("button", { name: /Decision/ }),
    "Qualified",
  );
  await page.getByRole("button", { name: "Save decision" }).click();
  await expect(
    page.getByText(/set qualification to qualified/i).first(),
  ).toBeVisible({ timeout: 30_000 });
}

test.describe("CRM MVP", () => {
  test.describe.configure({ mode: "serial" });
  test.setTimeout(300_000);

  test("Journey A — lead lifecycle: create, assign, move stage, qualify, and read it all back", async ({
    browser,
  }) => {
    const world = await getCrmWorld();
    const stamp = `${world.suffix}a`;
    const rep = await openCrmSession(browser, world.rep);
    const manager = await openCrmSession(browser, world.manager);
    try {
      // The seller captures a Lead.
      const leadId = await createLead(rep.page, {
        first: "Asha",
        last: `Lifecycle ${stamp}`,
        email: `asha.${stamp}@lifecycle.test`,
        company: `Lifecycle Co ${stamp}`,
      });

      // Their manager reassigns it to the other seller on the team, with a reason.
      const m = manager.page;
      await m.goto(`/crm/leads/${leadId}`, { waitUntil: "domcontentloaded" });
      await expect(
        m.getByRole("heading", { name: `Asha Lifecycle ${stamp}` }),
      ).toBeVisible({ timeout: 120_000 });
      await choose(
        m,
        m.getByRole("button", { name: /Owner$/ }),
        world.rep2.name,
      );
      await m.getByLabel("Reason (optional)").fill("Territory handover");
      await m.getByRole("button", { name: "Assign", exact: true }).click();
      await expect(field(m, "Owner")).toContainText(world.rep2.name, {
        timeout: 30_000,
      });

      // A legal stage move from the lifecycle graph, with its history.
      await selectTab(m, "Pipeline");
      const destination = m.getByRole("button", { name: /Destination stage/ });
      await destination.click();
      const firstStage = m.getByRole("option").first();
      const stageName = (await firstStage.innerText()).trim();
      await firstStage.click();
      const reason = m.getByRole("button", { name: /Reason \(required/ });
      if (await reason.isVisible().catch(() => false))
        await choose(m, reason, /.+/);
      await m.getByRole("button", { name: "Move", exact: true }).click();
      await expect(
        m.getByText(new RegExp(`→ ${stageName}`)).first(),
      ).toBeVisible({ timeout: 30_000 });

      // Qualification with the recorded decision.
      await selectTab(m, "Qualification");
      await choose(m, m.getByRole("button", { name: /Decision/ }), "Qualified");
      const override = m.getByRole("checkbox", { name: /Override/ });
      if (await override.isVisible().catch(() => false)) {
        await override.check();
        await m
          .getByLabel("Override reason")
          .fill("Budget and authority confirmed on the discovery call");
      }
      await m.getByRole("button", { name: "Save decision" }).click();
      await expect(
        m.getByText(/set qualification to qualified/i).first(),
      ).toBeVisible({ timeout: 30_000 });

      // Reload: every change is persisted and shown.
      await m.reload({ waitUntil: "domcontentloaded" });
      await expect(field(m, "Owner")).toContainText(world.rep2.name, {
        timeout: 60_000,
      });
      await expect(field(m, "Qualification")).toContainText("Qualified");
      await selectTab(m, "Pipeline");
      await expect(
        m.getByText(new RegExp(`→ ${stageName}`)).first(),
      ).toBeVisible({ timeout: 30_000 });

      // The history the screens show is the stored history.
      const history = await withCrmDb(world.organizationId, async (db) => ({
        owner: (
          await db.query(
            `SELECT owner_user_id, qualification_state FROM tenant.crm_leads WHERE id=$1`,
            [leadId],
          )
        ).rows[0],
        assignments: (
          await db.query(
            `SELECT count(*)::int AS n FROM tenant.crm_lead_assignment_events WHERE lead_id=$1`,
            [leadId],
          )
        ).rows[0].n,
        stages: (
          await db.query(
            `SELECT count(*)::int AS n FROM tenant.crm_lead_stage_events WHERE lead_id=$1`,
            [leadId],
          )
        ).rows[0].n,
        qualifications: (
          await db.query(
            `SELECT count(*)::int AS n FROM tenant.crm_lead_qualification_events WHERE lead_id=$1`,
            [leadId],
          )
        ).rows[0].n,
      }));
      expect(history.owner.owner_user_id).toBe(world.rep2.userId);
      expect(history.owner.qualification_state).toBe("qualified");
      expect(history.assignments).toBeGreaterThan(0);
      expect(history.stages).toBeGreaterThan(0);
      expect(history.qualifications).toBe(1);
    } finally {
      await rep.context.close();
      await manager.context.close();
    }
  });

  test("Journey B — relationship records: account and contacts created, edited, duplicate-checked and read back", async ({
    browser,
  }) => {
    const world = await getCrmWorld();
    const stamp = `${world.suffix}b`;
    const accountName = `Harbour Tools ${stamp}`;
    const contactEmail = `meera.${stamp}@harbour.test`;
    const { context, page } = await openCrmSession(browser, world.rep);
    try {
      // Account: create, then edit.
      await page.goto("/crm/accounts/new", { waitUntil: "domcontentloaded" });
      await textbox(page, "Account name").fill(accountName);
      // Part of an address is refused with a reason, not silently dropped.
      await textbox(page, "City").fill("Pune");
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(
        page.getByText(/Street address is required when an address is entered/),
      ).toBeVisible();
      await textbox(page, "Street address").fill("12 Dock Road");
      await textbox(page, "State").fill("Maharashtra");
      await textbox(page, "Postal code").fill("411001");
      const country = page.getByRole("combobox", { name: /Country/ });
      await country.fill("India");
      await page.getByRole("option", { name: "India", exact: true }).click();
      await page.getByRole("button", { name: "Create account" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/crm/accounts/${UUID.source}$`),
        { timeout: 60_000 },
      );
      const accountId = page.url().split("/").at(-1)!;
      await page.goto(`/crm/accounts/${accountId}/edit`, {
        waitUntil: "domcontentloaded",
      });
      await textbox(page, "Website").fill("https://harbour.example");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page).toHaveURL(new RegExp(`/crm/accounts/${accountId}$`), {
        timeout: 60_000,
      });

      // Contact under the Account: create, then edit.
      async function newContact(first: string) {
        await page.goto("/crm/contacts/new", { waitUntil: "domcontentloaded" });
        await choose(
          page,
          page.getByRole("button", { name: /Account$/ }),
          accountName,
        );
        await textbox(page, "First name").fill(first);
        await textbox(page, "Last name").fill(`Rao ${stamp}`);
        await textbox(page, "Email").fill(contactEmail);
      }
      await newContact("Meera");
      await page.getByRole("button", { name: "Create contact" }).click();
      await expect(page).toHaveURL(
        new RegExp(`/crm/contacts/${UUID.source}$`),
        { timeout: 60_000 },
      );
      const contactId = page.url().split("/").at(-1)!;
      await page.goto(`/crm/contacts/${contactId}/edit`, {
        waitUntil: "domcontentloaded",
      });
      await textbox(page, "Role or designation").fill("Procurement head");
      await page.getByRole("button", { name: "Save changes" }).click();
      await expect(page).toHaveURL(new RegExp(`/crm/contacts/${contactId}$`), {
        timeout: 60_000,
      });

      // The same person again is refused as an exact duplicate; creating it
      // anyway needs a reason, which is kept.
      await newContact("Meera");
      await page.getByRole("button", { name: "Create contact" }).click();
      const warning = page.getByRole("alert").filter({
        hasText: "looks like one that already exists",
      });
      await expect(warning).toBeVisible({ timeout: 30_000 });
      await expect(
        warning.getByRole("link", { name: new RegExp(`Meera Rao ${stamp}`) }),
      ).toBeVisible();
      const createAnyway = page.getByRole("button", { name: "Create anyway" });
      await expect(createAnyway).toBeDisabled();
      await page
        .getByLabel("Why create this anyway?")
        .fill("Second mailbox owner at the same branch office");
      await createAnyway.click();
      await expect(page).toHaveURL(
        new RegExp(`/crm/contacts/${UUID.source}$`),
        { timeout: 60_000 },
      );
      const overrideContactId = page.url().split("/").at(-1)!;
      expect(overrideContactId).not.toBe(contactId);

      // Read back after a reload.
      await page.goto(`/crm/contacts/${contactId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(page.getByText("Procurement head").first()).toBeVisible({
        timeout: 120_000,
      });
      await expect(page.getByText(contactEmail).first()).toBeVisible();
      await page.goto(`/crm/accounts/${accountId}`, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("heading", { name: accountName }),
      ).toBeVisible({ timeout: 120_000 });

      const stored = await withCrmDb(world.organizationId, async (db) => ({
        account: (
          await db.query(
            `SELECT party.display_name, party.website, address.city, address.country_code
               FROM tenant.business_parties party
               LEFT JOIN tenant.addresses address ON address.party_id = party.id AND address.status = 'active'
              WHERE party.id=$1`,
            [accountId],
          )
        ).rows[0],
        contacts: (
          await db.query(
            `SELECT id, designation FROM tenant.contacts WHERE party_id=$1 ORDER BY created_at`,
            [accountId],
          )
        ).rows,
      }));
      expect(stored.account.display_name).toBe(accountName);
      expect(stored.account.website).toBe("https://harbour.example");
      expect(stored.account.city).toBe("Pune");
      expect(stored.account.country_code).toBe("IN");
      expect(stored.contacts.map((row) => row.id)).toEqual([
        contactId,
        overrideContactId,
      ]);
      expect(stored.contacts[0].designation).toBe("Procurement head");
    } finally {
      await context.close();
    }
  });

  test("Journey C — duplicate resolution: dismiss a possible match, then merge an exact one", async ({
    browser,
  }) => {
    const world = await getCrmWorld();
    const stamp = `${world.suffix}c`;
    const name = `Ravi Varma${stamp}`;
    const company = `Varma Traders ${stamp}`;
    const email = `ravi.${stamp}@varma.test`;
    const rep = await openCrmSession(browser, world.rep);
    const admin = await openCrmSession(browser, world.admin);
    try {
      // Same person and company, different email: a possible duplicate.
      const survivorId = await createLead(rep.page, {
        first: "Ravi",
        last: `Varma${stamp}`,
        email,
        company,
      });
      const lookalikeId = await createLead(rep.page, {
        first: "Ravi",
        last: `Varma${stamp}`,
        email: `r.varma.${stamp}@other.test`,
        company,
      });

      // The data-quality administrator reviews it and records why it is not one.
      const a = admin.page;
      await openLead(a, survivorId, name);
      const duplicates = a.getByRole("region", { name: "Possible duplicates" });
      await expect(duplicates).toContainText("possible match", {
        timeout: 60_000,
      });
      await duplicates.getByRole("button", { name: "Not a duplicate" }).click();
      const dismiss = a.getByRole("dialog");
      const record = dismiss.getByRole("button", { name: "Record decision" });
      await expect(record).toBeDisabled();
      await dismiss
        .getByLabel("Why are these different people?")
        .fill("Different people who share a name at a family business");
      await record.click();
      await expect(duplicates).toBeHidden({ timeout: 30_000 });

      // An exact duplicate (same email) needs the administrator's reason to exist…
      await a.goto("/crm/leads/new", { waitUntil: "domcontentloaded" });
      await textbox(a, "First name").fill("Ravindra");
      await textbox(a, "Last name").fill(`Varma${stamp}`);
      await textbox(a, "Email").fill(email);
      await a.getByRole("button", { name: "Create lead" }).click();
      await expect(
        a.getByRole("alert").filter({ hasText: "already exists" }),
      ).toBeVisible({ timeout: 30_000 });
      await a
        .getByLabel("Why create this anyway?")
        .fill("Imported from a trade-show list before cleanup");
      await a.getByRole("button", { name: "Create anyway" }).click();
      await expect(a).toHaveURL(new RegExp(`/crm/leads/${UUID.source}$`), {
        timeout: 60_000,
      });
      const duplicateId = a.url().split("/").at(-1)!;

      // …and is then merged into the original after a confirmation.
      await openLead(a, survivorId, name);
      await expect(duplicates).toContainText("exact match", {
        timeout: 60_000,
      });
      await duplicates
        .getByRole("button", { name: "Merge into this lead" })
        .click();
      const merge = a.getByRole("dialog");
      await expect(merge).toContainText("can't be undone");
      await merge.getByRole("button", { name: "Merge leads" }).click();
      await expect(duplicates).toBeHidden({ timeout: 30_000 });

      // Survivor stays active; the duplicate is archived; history is stored.
      await a.reload({ waitUntil: "domcontentloaded" });
      await expect(a.getByRole("heading", { name })).toBeVisible({
        timeout: 120_000,
      });
      await expect(duplicates).toBeHidden();
      const stored = await withCrmDb(world.organizationId, async (db) => ({
        leads: Object.fromEntries(
          (
            await db.query(
              `SELECT id, record_status FROM tenant.crm_leads WHERE id = ANY($1::uuid[])`,
              [[survivorId, lookalikeId, duplicateId]],
            )
          ).rows.map((row) => [row.id, row.record_status]),
        ),
        merges: (
          await db.query(
            `SELECT count(*)::int AS n FROM tenant.crm_merge_records WHERE source_id=$1 AND target_id=$2`,
            [duplicateId, survivorId],
          )
        ).rows[0].n,
        decisions: (
          await db.query(
            `SELECT operation, reason FROM tenant.crm_lead_duplicate_overrides
              WHERE (lead_id = ANY($1::uuid[])) ORDER BY created_at`,
            [[survivorId, lookalikeId, duplicateId]],
          )
        ).rows,
      }));
      expect(stored.leads[survivorId]).toBe("active");
      expect(stored.leads[lookalikeId]).toBe("active");
      expect(stored.leads[duplicateId]).toBe("archived");
      expect(stored.merges).toBe(1);
      expect(stored.decisions).toContainEqual({
        operation: "dismiss",
        reason: "Different people who share a name at a family business",
      });
    } finally {
      await rep.context.close();
      await admin.context.close();
    }
  });

  test("Journey D — conversion: only a qualified lead converts, into one Account, Contact and Opportunity, even when retried", async ({
    browser,
  }) => {
    const world = await getCrmWorld();
    const stamp = `${world.suffix}d`;
    const heading = `Kiran Convert ${stamp}`;
    const { context, page } = await openCrmSession(browser, world.rep);
    try {
      const leadId = await createLead(page, {
        first: "Kiran",
        last: `Convert ${stamp}`,
        email: `kiran.${stamp}@convert.test`,
        company: `Convert Works ${stamp}`,
      });

      // Not qualified yet: the dialog explains why, and the server agrees.
      await page.getByRole("button", { name: "Convert", exact: true }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toContainText(
        "Only a qualified Lead can be converted",
      );
      await expect(
        dialog.getByRole("button", { name: "Convert", exact: true }),
      ).toBeDisabled();
      await dialog.getByRole("button", { name: "Cancel" }).click();
      const early = await post(page, `/api/crm/leads/${leadId}/convert`, {});
      expect(early.status).toBe(409);
      expect(early.body.code).toBe("CRM_LEAD_NOT_QUALIFIED");

      // Qualify, then convert.
      await qualify(page);
      await page.getByRole("button", { name: "Convert", exact: true }).click();
      const convert = dialog.getByRole("button", {
        name: "Convert",
        exact: true,
      });
      await expect(convert).toBeEnabled({ timeout: 30_000 });
      await convert.click();
      await expect(dialog).toBeHidden({ timeout: 60_000 });

      // After a reload: converted, read-only, linked to what it became.
      await page.reload({ waitUntil: "domcontentloaded" });
      await expect(page.getByRole("heading", { name: heading })).toBeVisible({
        timeout: 120_000,
      });
      await expect(
        page.getByText("Converted", { exact: true }).first(),
      ).toBeVisible();
      await expect(
        page.getByText("This Lead has been converted. It is now read-only."),
      ).toBeVisible();
      for (const target of ["accounts", "contacts", "opportunities"])
        await expect(
          page.locator(`a[href^="/crm/${target}/"]`).first(),
        ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Convert", exact: true }),
      ).toHaveCount(0);

      // A retried request replays the conversion instead of repeating it.
      const retry = await post(page, `/api/crm/leads/${leadId}/convert`, {});
      expect(retry.status).toBe(200);
      expect((retry.body.result as { replayed?: boolean }).replayed).toBe(true);

      const stored = await withCrmDb(world.organizationId, async (db) => ({
        lead: (
          await db.query(
            `SELECT record_status, converted_party_id, converted_contact_id, converted_opportunity_id FROM tenant.crm_leads WHERE id=$1`,
            [leadId],
          )
        ).rows[0],
        conversions: (
          await db.query(
            `SELECT count(*)::int AS n FROM tenant.crm_conversion_records WHERE lead_id=$1`,
            [leadId],
          )
        ).rows[0].n,
        opportunities: (
          await db.query(
            `SELECT id FROM tenant.crm_opportunities WHERE lead_id=$1`,
            [leadId],
          )
        ).rows,
      }));
      expect(stored.lead.record_status).toBe("converted");
      expect(stored.lead.converted_party_id).toMatch(UUID);
      expect(stored.lead.converted_contact_id).toMatch(UUID);
      expect(stored.conversions).toBe(1);
      expect(stored.opportunities).toEqual([
        { id: stored.lead.converted_opportunity_id },
      ]);
    } finally {
      await context.close();
    }
  });

  test("Restricted role — marketing can work a lead but cannot convert it or create accounts", async ({
    browser,
  }) => {
    const world = await getCrmWorld();
    const stamp = `${world.suffix}e`;
    const { context, page } = await openCrmSession(browser, world.marketing);
    try {
      const leadId = await createLead(page, {
        first: "Nisha",
        last: `Campaign ${stamp}`,
        email: `nisha.${stamp}@campaign.test`,
        company: `Campaign Co ${stamp}`,
      });
      await qualify(page);

      // Conversion would create an Account and an Opportunity: refused, nothing written.
      const denied = await post(page, `/api/crm/leads/${leadId}/convert`, {});
      expect(denied.status).toBe(403);
      expect(denied.body.code).toBe("PERMISSION_DENIED");
      const stored = await withCrmDb(world.organizationId, async (db) => ({
        lead: (
          await db.query(
            `SELECT record_status FROM tenant.crm_leads WHERE id=$1`,
            [leadId],
          )
        ).rows[0],
        opportunities: (
          await db.query(
            `SELECT count(*)::int AS n FROM tenant.crm_opportunities WHERE lead_id=$1`,
            [leadId],
          )
        ).rows[0].n,
      }));
      expect(stored.lead.record_status).toBe("active");
      expect(stored.opportunities).toBe(0);

      // The screens say so rather than failing on save.
      await page.goto("/crm/accounts/new", { waitUntil: "domcontentloaded" });
      await expect(
        page.getByText("You don't have access to create Accounts"),
      ).toBeVisible({ timeout: 120_000 });
    } finally {
      await context.close();
    }
  });
});
