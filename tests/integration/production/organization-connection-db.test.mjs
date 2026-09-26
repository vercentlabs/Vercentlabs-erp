// runWithOrganizationConnection (billing sagas, transaction: "none"): the
// organisation context holds across the saga's own COMMITs and is always
// cleared before the pooled connection is reused — also when the saga fails
// inside an open transaction. As the restricted web role.
import assert from "node:assert/strict";
import test from "node:test";

import { runWithOrganizationConnection } from "../../../packages/database/src/index.js";
import { createProductionKit } from "./production-kit.mjs";

test("organisation connection context survives saga commits and never leaks to the next request", async (t) => {
  const kit = await createProductionKit();
  t.after(() => kit.close());
  const { organizationId } = await kit.organization("org-connection");
  const current = async (client) => (await client.query("SELECT public.current_organization_id() AS id")).rows[0].id;
  const client = await kit.web.connect();
  try {
    const seen = await runWithOrganizationConnection(client, organizationId, async (connection) => {
      const values = [await current(connection)];
      await connection.query("BEGIN");
      values.push(await current(connection));
      await connection.query("COMMIT");
      values.push(await current(connection));
      return values;
    });
    assert.deepEqual(seen, [organizationId, organizationId, organizationId]);
    assert.equal(await current(client), null, "cleared before release");

    await assert.rejects(() =>
      runWithOrganizationConnection(client, organizationId, async (connection) => {
        await connection.query("BEGIN");
        await connection.query("SELECT 1/0");
      }),
    );
    assert.equal(await current(client), null, "cleared after a failed saga step");
    assert.equal((await client.query("SELECT 1 AS ok")).rows[0].ok, 1, "the aborted transaction was ended");
  } finally {
    client.release();
  }
});
