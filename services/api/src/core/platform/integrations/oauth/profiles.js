// Registered OAuth connection profiles. The browser chooses a profile, never
// raw scopes; each profile requests only what a real feature consumes. No
// platform feature reads mail, files or calendars through these connections
// today, so the profiles are identity-only (who the connected account is).
export const OAUTH_PROFILES = Object.freeze([
  Object.freeze({
    key: "google.identity",
    provider: "google",
    label: "Google account",
    description: "Links a Google account to your user (name and email address only).",
    scopes: Object.freeze(["openid", "email", "profile"]),
  }),
  Object.freeze({
    key: "microsoft.identity",
    provider: "microsoft",
    label: "Microsoft account",
    description: "Links a Microsoft work or personal account to your user (name and email address only).",
    scopes: Object.freeze(["openid", "email", "profile", "offline_access"]),
  }),
]);

const BY_KEY = new Map(OAUTH_PROFILES.map((profile) => [profile.key, profile]));

export function getOAuthProfile(key) {
  return BY_KEY.get(String(key || "")) || null;
}

// Where the browser may land after an OAuth round trip: internal paths only.
export const OAUTH_RETURN_PREFIXES = Object.freeze(["/settings/integrations"]);
