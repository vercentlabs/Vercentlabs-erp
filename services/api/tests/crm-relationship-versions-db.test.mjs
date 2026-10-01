import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import { ROLE_TEMPLATE_BY_SLUG } from "../../../packages/permissions/src/roles.js";
import { createCrmAccount, updateCrmAccount } from "../src/modules/crm/master-data/account-operations.js";
import { createCrmContact, updateCrmContact } from "../src/modules/crm/master-data/contact-operations.js";

// Account and Contact edits carry the version the editor loaded
// (expectedUpdatedAt). PostgreSQL keeps updated_at in microseconds while a
// JavaScript Date — what every caller holds — keeps milliseconds, so the
// checked write must compare at millisecond precision or EVERY edit is
// refused as a conflict. Only a real database shows that. Seeds its own
// organisation inside one transaction that is always rolled back.
//
// Runs when CRM_ACCESS_DB_URL (or MIGRATION_DATABASE_URL) is set; part of
// `pnpm test:access:db`, which fails on a skip.

const url = process.env.CRM_ACCESS_DB_URL || process.env.MIGRATION_DATABASE_URL;

test("Account and Contact edits: the version the editor loaded is accepted, an older one is refused (real database)", { skip: !url && "no database URL" }, async () => {
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN");
    const tag = randomUUID().slice(0, 8);
    const userId = randomUUID(), org = randomUUID(), company = randomUUID();
    await client.query(`INSERT INTO public.users (id, email, full_name, password_hash) VALUES ($1,$2,$3,'x')`, [userId, `${tag}-rep@example.test`, `${tag} rep`]);
    await client.query(`INSERT INTO public.organizations (id, name, slug, base_currency, created_by, country_code, timezone) VALUES ($1,$2,$3,'INR',$4,'IN','Asia/Kolkata')`, [org, `Org ${tag}`, `org-${tag}`, userId]);
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [org]);
    await client.query(`INSERT INTO public.organization_memberships (organization_id, user_id, role, status) VALUES ($1,$2,'member','active')`, [org, userId]);
    await client.query(`INSERT INTO public.companies (id, organization_id, name, legal_name, country_code, base_currency, code) VALUES ($1,$2,$3,$3,'IN','INR',$4)`, [company, org, `C ${tag}`, `C${tag}`]);
    const context = {
      organizationId: org, userId, activeCompanyId: company, activeBranchId: null, allowAllCompanies: false,
      permissions: [...ROLE_TEMPLATE_BY_SLUG.get("sales_representative").permissions], roleSlugs: [],
    };

    // A freshly created row carries now() with microseconds; the caller gets it
    // back as a Date (milliseconds) and sends that as the loaded version.
    const account = await createCrmAccount(client, context, { displayName: `Versioned ${tag}` });
    const stored = (await client.query(`SELECT updated_at::text AS at FROM tenant.business_parties WHERE id=$1`, [account.id])).rows[0].at;
    assert.match(stored, /\.\d{4,6}\+/, "PostgreSQL keeps sub-millisecond precision");
    const edited = await updateCrmAccount(client, context, account.id, { website: "https://versioned.example" }, { expectedUpdatedAt: new Date(account.updatedAt).toISOString() });
    assert.equal(edited.website, "https://versioned.example");
    await assert.rejects(
      () => updateCrmAccount(client, context, account.id, { industry: "Retail" }, { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      (error) => error.code === "CRM_STALE_WRITE",
    );

    const contact = await createCrmContact(client, context, { accountId: account.id, firstName: "Vera", lastName: tag, email: `vera.${tag}@example.test` });
    const editedContact = await updateCrmContact(client, context, contact.id, { designation: "Buyer" }, { expectedUpdatedAt: new Date(contact.updatedAt).toISOString() });
    assert.equal(editedContact.designation, "Buyer");
    await assert.rejects(
      () => updateCrmContact(client, context, contact.id, { designation: "Owner" }, { expectedUpdatedAt: "2020-01-01T00:00:00.000Z" }),
      (error) => error.code === "CRM_STALE_WRITE",
    );
  } finally {
    await client.query("ROLLBACK").catch(() => undefined);
    await client.end();
  }
});
