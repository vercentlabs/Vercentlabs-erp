// The people at a company. Contacts and their company links belong to the
// Contacts module (contacts/relationships.js); the account screens use these
// account-side operations from it.
export {
  createAccountContact, linkContact, listAccountContacts, searchLinkableContacts, setPrimaryContact, unlinkContact, updateAccountContactRole,
} from "../contacts/relationships.js";
