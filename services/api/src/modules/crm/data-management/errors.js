export class CrmError extends Error {
  constructor(status, message, code = "CRM_ERROR", details = undefined) {
    super(message);
    this.name = "CrmError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

// Runs a DELETE of a master record (a company, a contact) and turns "still referenced" (a foreign key, from any app's table — POS
// carts, loyalty, purchase orders, returns, pricing rules, accounting…) into the friendly 409 `message`, never a raw database error.
export async function deleteUnlessReferenced(client, sql, values, message, code) {
  await client.query("SAVEPOINT crm_delete_unused");
  try {
    const result = await client.query(sql, values);
    await client.query("RELEASE SAVEPOINT crm_delete_unused");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT crm_delete_unused");
    if (error?.code === "23503") throw new CrmError(409, message, code);
    throw error;
  }
}
