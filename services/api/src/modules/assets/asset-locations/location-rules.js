// Assets — Asset Location, the rules: the location types, the permissions, the errors. The registered location of an asset is its last
// confirmed official location; a pending transfer, a temporary visit or a verification sighting never changes it.
import { AssetError, has } from "../common.js";

export const LOCATION = Object.freeze({
  view: "assets.view", create: "assets.location.create", edit: "assets.location.edit", deactivate: "assets.location.deactivate", hierarchy: "assets.location.manage_hierarchy",
  history: "assets.location.view_history", observe: "assets.location.record_observation", review: "assets.location.review_discrepancy", export: "assets.location.export",
  legacyManage: "assets.manage",
});
export const mayCreateLocation = (c) => has(c, LOCATION.create) || has(c, LOCATION.legacyManage);
export const mayEditLocation = (c) => has(c, LOCATION.edit) || has(c, LOCATION.legacyManage);
export const seesLocationHistory = (c) => has(c, LOCATION.history) || has(c, LOCATION.review);

export const KIND = Object.freeze({
  OFFICE: "Office", FACTORY: "Factory", WAREHOUSE: "Warehouse / storage", ROOM_OR_AREA: "Room or area", CUSTOMER_SITE: "Customer site", REPAIR_FACILITY: "Repair facility", OTHER: "Other",
});
export const EXTERNAL_KINDS = ["CUSTOMER_SITE", "REPAIR_FACILITY"];
export const EVENT_LABEL = Object.freeze({
  INITIAL: "Initial location", TRANSFER: "Transferred", ADMIN_CORRECTION: "Corrected by an administrator", RECOVERY: "Recovered here", REINSTATEMENT: "Reinstated here",
  IMPORT: "Imported", WORKFLOW_UPDATE: "Changed by a workflow",
});
export const OBSERVATION_KIND = Object.freeze({ TEMPORARY: "Temporary whereabouts", MAINTENANCE: "At maintenance / repair", VERIFICATION: "Seen during verification" });
export const DISCREPANCY_STATUS = Object.freeze({ OPEN: "To review", RESOLVED_TRANSFER: "Resolved by a transfer", RESOLVED_CORRECTION: "Location corrected", DISMISSED: "Dismissed — where registered" });

const MESSAGES = Object.freeze({
  ASSET_LOCATION_NAME_REQUIRED: "Enter a location name.",
  ASSET_LOCATION_DUPLICATE: "This location already exists under the selected parent.",
  ASSET_LOCATION_PARENT_INVALID: "Select a valid parent location.",
  ASSET_LOCATION_HIERARCHY_CYCLE: "This change would create an invalid location hierarchy.",
  ASSET_LOCATION_INACTIVE: "This location cannot receive new Assets.",
  ASSET_LOCATION_COMPANY_MISMATCH: "This location belongs to another Company.",
  ASSET_LOCATION_IN_USE: "Move or review the active assets before disabling this location.",
  ASSET_LOCATION_TRANSFER_REQUIRED: "Use the Asset Transfer workflow to change the registered location.",
  ASSET_LOCATION_ASSET_RESTRICTED: "This asset cannot be moved in its current state.",
  ASSET_LOCATION_DISCREPANCY_OPEN: "An observed location difference needs review.",
  ASSET_LOCATION_ACCESS_DENIED: "You cannot perform this location action.",
  ASSET_LOCATION_VERSION_CONFLICT: "This location changed. Refresh and review.",
  ASSET_LOCATION_OUTCOME_UNKNOWN: "Checking the previous operation. Do not submit it again.",
  ASSET_LOCATION_NOT_FOUND: "This location is not available.",
  ASSET_LOCATION_INVALID: "Check the location details.",
});
export const LOCATION_MESSAGES = MESSAGES;
export const locationError = (status, code, message, details) => {
  const error = new AssetError(status, message ?? MESSAGES[code] ?? "Check the details and try again.", code);
  if (details) error.details = details;
  return error;
};
export const requireLocation = (c, ok) => { if (!ok) throw locationError(403, "ASSET_LOCATION_ACCESS_DENIED"); };
export const normalizedLocationName = (name) => String(name ?? "").normalize("NFKC").trim().replace(/\s+/g, " ").toLowerCase();
// Recursive path of every location of the Company: id → { path, rootId, depth }.
export const PATHS_SQL = `WITH RECURSIVE tree AS (
    SELECT id, parent_id, name::text AS path, id AS root_id, 0 AS depth FROM tenant.asset_locations WHERE organization_id = $1 AND parent_id IS NULL
    UNION ALL SELECT l.id, l.parent_id, tree.path || ' → ' || l.name, tree.root_id, tree.depth + 1 FROM tenant.asset_locations l JOIN tree ON l.parent_id = tree.id WHERE tree.depth < 20)
  SELECT id, path, root_id, depth FROM tree`;
