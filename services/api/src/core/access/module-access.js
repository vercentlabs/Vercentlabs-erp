// Module access on top of a WorkspaceAccessSnapshot. The decision pipeline
// itself (released → enabled → entitled → permitted) lives in
// ../module-entitlements.js's pure evaluateModuleAccess(); this file maps its
// result onto canonical Shared Access error codes.
import { moduleAccessPermission } from "@vercentlabs/permissions";

export {
  evaluateModuleAccess,
  getModuleDefinition,
  isModuleReleased,
} from "../module-entitlements.js";
export { MODULE_ACCESS_PERMISSIONS, moduleAccessPermission } from "@vercentlabs/permissions";

import { ACCESS_ERROR_CODES } from "./errors.js";

const CODE_BY_REASON = Object.freeze({
  not_released: ACCESS_ERROR_CODES.MODULE_UNAVAILABLE,
  disabled: ACCESS_ERROR_CODES.MODULE_DISABLED,
  not_entitled: ACCESS_ERROR_CODES.MODULE_NOT_ENTITLED,
  not_permitted: ACCESS_ERROR_CODES.PERMISSION_DENIED,
});

export function moduleAccessDenialCode(access) {
  if (!access) return ACCESS_ERROR_CODES.MODULE_UNAVAILABLE;
  if (access.accessible) return null;
  return CODE_BY_REASON[access.reason] ?? ACCESS_ERROR_CODES.PERMISSION_DENIED;
}

export function snapshotModuleAccess(snapshot, moduleKey) {
  return snapshot.modules.find((entry) => entry.moduleId === moduleKey) ?? null;
}

// Returns null when accessible, otherwise a denial decision fragment.
export function checkSnapshotModuleAccess(snapshot, moduleKey) {
  const access = snapshotModuleAccess(snapshot, moduleKey);
  const code = moduleAccessDenialCode(access);
  if (!code) return null;
  return {
    code,
    module: moduleKey,
    permission: code === ACCESS_ERROR_CODES.PERMISSION_DENIED ? moduleAccessPermission(moduleKey) : null,
    reason: access?.reason ?? "not_released",
  };
}
