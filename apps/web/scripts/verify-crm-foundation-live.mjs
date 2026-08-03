import assert from "node:assert/strict";
import path from "node:path";
import dotenv from "dotenv";
import pg from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local"), quiet: true });
dotenv.config({ quiet: true });
import {
  findAccountDuplicates,
  findContactDuplicates,
  getRelationshipGraph,
  mergeAccounts,
  mergeContacts,
} from "@vercentlabs/api";

const databaseUrl =
  process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
assert.ok(databaseUrl, "MIGRATION_DATABASE_URL or DATABASE_URL is required.");
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const foundation = await client.query(`
    SELECT organization.id AS organization_id,
           membership.user_id,
           company.id AS company_id
      FROM public.organizations organization
      JOIN public.organization_memberships membership
        ON membership.organization_id=organization.id AND membership.status='active'
      JOIN public.companies company
        ON company.organization_id=organization.id
     ORDER BY organization.created_at
     LIMIT 1`);
  assert.ok(
    foundation.rows[0],
    "Create an organization before running Stage 2A live verification.",
  );
  const context = {
    organizationId: foundation.rows[0].organization_id,
    userId: foundation.rows[0].user_id,
    activeCompanyId: foundation.rows[0].company_id,
    activeBranchId: null,
    allowAllCompanies: true,
  };
  await client.query(
    "SELECT set_config('app.current_organization_id',$1,true)",
    [context.organizationId],
  );
  const suffix = Date.now().toString(36).toUpperCase();
  const partyRows = await client.query(
    `INSERT INTO tenant.business_parties
      (organization_id,company_id,code,party_type,display_name,legal_name,gstin,pan,created_by,updated_by)
     VALUES ($1,$2,$3,'prospect','Stage 2A Alpha','Stage 2A Industries Pvt Ltd',$5,$6,$4,$4),
            ($1,$2,$7,'prospect','Stage 2A Alpha Duplicate','Stage 2A Industries Pvt Ltd',NULL,NULL,$4,$4)
     RETURNING id`,
    [
      context.organizationId,
      context.activeCompanyId,
      `S2AA-${suffix}`,
      context.userId,
      `27ABCDE${suffix.slice(-4).padStart(4, "0")}Z5`,
      `ABCDE${suffix.slice(-4).padStart(4, "0")}`,
      `S2AB-${suffix}`,
    ],
  );
  const [survivorPartyId, sourcePartyId] = partyRows.rows.map((row) => row.id);
  const contactRows = await client.query(
    `INSERT INTO tenant.contacts
      (organization_id,party_id,first_name,last_name,email,mobile,is_primary,created_by,updated_by)
     VALUES ($1,$2,'Asha','Verifier',$4,$5,true,$3,$3),
            ($1,$6,'Asha','Verifier',$4,$5,true,$3,$3)
     RETURNING id`,
    [
      context.organizationId,
      survivorPartyId,
      context.userId,
      `stage2a-${suffix.toLowerCase()}@example.invalid`,
      `90000${suffix.replace(/\D/g, "").padStart(5, "0").slice(-5)}`,
      sourcePartyId,
    ],
  );
  const [survivorContactId, sourceContactId] = contactRows.rows.map(
    (row) => row.id,
  );

  const accountDuplicates = await findAccountDuplicates(client, context, {
    legalName: "Stage 2A Industries Pvt Ltd",
    excludeId: survivorPartyId,
  });
  assert.equal(accountDuplicates[0].id, sourcePartyId);
  const contactDuplicates = await findContactDuplicates(client, context, {
    email: `stage2a-${suffix.toLowerCase()}@example.invalid`,
    excludeId: survivorContactId,
  });
  assert.equal(contactDuplicates[0].id, sourceContactId);

  await client.query(
    `INSERT INTO tenant.crm_relationship_edges
      (organization_id,from_entity_type,from_entity_id,to_entity_type,to_entity_id,relationship_type,strength,status,created_by,updated_by)
     VALUES ($1,'party',$2,'party',$3,'influences',80,'active',$4,$4)`,
    [context.organizationId, survivorPartyId, sourcePartyId, context.userId],
  );
  assert.equal(
    (await getRelationshipGraph(client, context, survivorPartyId)).length,
    1,
  );
  await mergeContacts(
    client,
    context,
    sourceContactId,
    survivorContactId,
    "Stage 2A verification",
  );
  await mergeAccounts(
    client,
    context,
    sourcePartyId,
    survivorPartyId,
    "Stage 2A verification",
  );
  const states = await client.query(
    `SELECT
      (SELECT status FROM tenant.business_parties WHERE id=$1) AS source_party_status,
      (SELECT status FROM tenant.contacts WHERE id=$2) AS source_contact_status,
      (SELECT count(*)::int FROM tenant.crm_account_merge_history WHERE source_party_id=$1) AS account_history,
      (SELECT count(*)::int FROM tenant.crm_contact_merge_history WHERE source_contact_id=$2) AS contact_history`,
    [sourcePartyId, sourceContactId],
  );
  assert.equal(states.rows[0].source_party_status, "inactive");
  assert.equal(states.rows[0].source_contact_status, "inactive");
  assert.equal(states.rows[0].account_history, 1);
  assert.equal(states.rows[0].contact_history, 1);
  await client.query("ROLLBACK");
  console.log(
    "Stage 2A live CRM foundation verified: duplicate detection, governed account/contact merge and relationship graph.",
  );
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  client.release();
  await pool.end();
}
