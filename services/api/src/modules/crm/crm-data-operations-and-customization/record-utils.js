import { LeadSourceError, validateLeadSourceAssignment } from "../prospect-and-relationship-master-data/lead-source-validation.js";
import { CrmError } from "./errors.js";


export function camelize(value) {
  return value.replace(/_([a-z])/g, (_match, character) =>
    character.toUpperCase(),
  );
}


export function camelizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [camelize(key), value]),
  );
}


export function limitValue(value, fallback = 100, maximum = 500) {
  const parsed = Number(value);
  return Number.isFinite(parsed)
    ? Math.max(1, Math.min(maximum, Math.trunc(parsed)))
    : fallback;
}


export function addParameter(parameters, value) {
  parameters.push(value);
  return `$${parameters.length}`;
}



export async function assertLeadSourceAssignment(client, context, sourceId, options) {
  try {
    return await validateLeadSourceAssignment(
      client,
      context,
      sourceId,
      options,
    );
  } catch (error) {
    if (error instanceof LeadSourceError)
      throw new CrmError(
        error.status,
        error.message,
        error.code,
        error.details,
      );
    throw error;
  }
}
