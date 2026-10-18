// Foundation party code shared by CRM (companies, contacts) and Sales (customers): the identity forms duplicates are matched on, and
// the party's history.
export * from "./normalize.js";
export { listAccountHistory, recordAccountHistory } from "./history.js";
export { PartyError } from "./errors.js";
