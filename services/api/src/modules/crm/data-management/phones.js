// Phone numbers on leads, contacts and companies: each is read for the record's country (else the organization's), refused when it
// is not a real number there, and stored in E.164 form (packages/shared-types/src/phone.js). Run on the normalized input of a create
// or update, before it is validated and written.
import { readPhone } from "@vercentlabs/shared-types";

import { CrmError } from "./errors.js";

const countryCache = new WeakMap();
async function organizationCountry(client, context) {
  if (countryCache.has(context)) return countryCache.get(context);
  const { rows } = await client.query("SELECT country_code FROM public.organizations WHERE id = $1", [context.organizationId]);
  const country = String(rows[0]?.country_code ?? "IN").trim() || "IN";
  countryCache.set(context, country);
  return country;
}

// normalized: the record's normalized input (only the fields being set); fields: its phone fields; recordCountry: the record's own
// country after the change, if it has one. Rewrites each given phone to E.164; throws `code` (400) with every issue otherwise.
export async function normalizePhones(client, context, normalized, fields, recordCountry, code) {
  const present = fields.filter((field) => normalized[field]);
  if (!present.length) return;
  const country = (recordCountry && /^[A-Z]{2}$/.test(recordCountry) ? recordCountry : null) ?? (await organizationCountry(client, context));
  const issues = [];
  for (const field of present) {
    const phone = readPhone(normalized[field], country);
    if (phone.valid) normalized[field] = phone.e164;
    else issues.push({ field, message: phone.error });
  }
  if (issues.length) throw new CrmError(400, issues[0].message, code, { issues });
}
