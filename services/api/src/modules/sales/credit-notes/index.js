// Credit Notes: Finance's customer credit notes made by Sales against posted invoices and received returns.
export {
  CREDIT_NOTE_PERMISSIONS as SALES_CREDIT_NOTE_PERMISSIONS, CREDIT_NOTE_STATUS as SALES_CREDIT_NOTE_STATUS, CREDIT_NOTE_VIEWS as SALES_CREDIT_NOTE_VIEWS,
  CREDIT_REASONS as SALES_CREDIT_REASONS, CreditNoteError as SalesCreditNoteError,
} from "./constants.js";
export { createCreditNote, creditedTotals, getCreditNote, getCreditNoteProposal, listCreditNotes, updateDraftCreditNote } from "./records.js";
export { cancelDraftCreditNote, postCreditNote, reverseCreditNote, validateCreditNoteForPosting } from "./lifecycle.js";
export { CREDIT_NOTE_FILE_ENTITY as SALES_CREDIT_NOTE_FILE_ENTITY, markCreditNoteSent, sendCreditNote } from "./communication.js";
export { getCreditNoteDocument } from "./document.js";
export { listCreditNoteFiles, prepareCreditNoteFileUpload, readCreditNoteFile, removeCreditNoteFile, uploadCreditNoteFile } from "./files.js";
