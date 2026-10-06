// Sales Returns: goods coming back from customers against deliveries.
export {
  DISPOSITIONS as SALES_RETURN_DISPOSITIONS, RETURN_PERMISSIONS as SALES_RETURN_PERMISSIONS, RETURN_REASONS as SALES_RETURN_REASONS, RETURN_STATUS as SALES_RETURN_STATUS,
  RETURN_VIEWS as SALES_RETURN_VIEWS, ReturnError as SalesReturnError,
} from "./constants.js";
export { createReturnFromDelivery, getReturnProposal, getSalesReturn, listSalesReturns, updateDraftReturn } from "./records.js";
export { cancelDraftReturn, receiveSalesReturn } from "./lifecycle.js";
export { createCreditNoteFromReturn } from "./credit.js";
export { getReturnNote } from "./note.js";
export { RETURN_FILE_ENTITY as SALES_RETURN_FILE_ENTITY, listReturnFiles, prepareReturnFileUpload, readReturnFile, removeReturnFile, uploadReturnFile } from "./files.js";
