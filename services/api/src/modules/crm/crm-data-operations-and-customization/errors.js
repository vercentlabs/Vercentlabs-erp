export class CrmError extends Error {
  constructor(status, message, code = "CRM_ERROR", details = undefined) {
    super(message);
    this.name = "CrmError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}
