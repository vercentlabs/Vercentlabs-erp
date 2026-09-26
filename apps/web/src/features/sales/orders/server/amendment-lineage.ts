import "server-only";

// The lineage lookup lives in the Sales domain (@vercentlabs/api); kept under
// this name for the order approve/reject routes.
export { salesOrderAmendmentLineage as amendmentLineage } from "@vercentlabs/api";
