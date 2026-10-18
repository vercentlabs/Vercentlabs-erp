// A refused party operation: the HTTP layer reads status, code and details the same way as for every module's errors.
export class PartyError extends Error {
  constructor(status, message, code = "PARTY_ERROR", details = undefined) {
    super(message);
    this.name = "PartyError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
