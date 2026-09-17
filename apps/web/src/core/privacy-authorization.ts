import { CORE_PERMISSIONS } from "@vercentlabs/permissions";

// Imports from http-errors.ts (not http.ts) deliberately — http.ts pulls in
// next/server, which is unresolvable under plain `node --test` and would
// make this module (and its unit test) untestable outside Next's bundler.
// Relative import (not the "@/" alias) for the same reason: plain
// `node --test` does not resolve tsconfig path aliases.
import { HttpError } from "./http-errors.ts";

// Shared by all /api/privacy/* routes (deliberately NOT under /api/crm/ —
// this wires the platform privacy authority, services/api/src/core/
// privacy.js, not a CRM-local resource). Extracted from three near-
// identical inline copies (requests, requests/[id]/transition,
// retention-policies) so the one real permission boundary here — an
// ordinary CRM manager holding crm.accounts.manage must NOT gain
// privacy-administration authority — is defined and tested once.
export function assertPrivacyManage(session: { permissions?: string[] }) {
  if (!session.permissions?.includes(CORE_PERMISSIONS.platformPrivacyManage))
    throw new HttpError(403, "You do not have permission to manage privacy requests.");
}
