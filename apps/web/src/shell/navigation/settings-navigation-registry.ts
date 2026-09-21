// The canonical settings navigation registry (Phase 6, UI refinement +
// platform checkpoint D). Mirrors module-navigation-registry.ts's honesty
// discipline: an item is AVAILABLE only once the prompt that built its
// screen flips it here — never speculatively. Every item not yet built is
// PLANNED (disabled, visible for orientation, never a clickable dead
// link — see SettingsIndexScreen). A permission-gated item that IS built
// but the caller lacks the permission for renders as UNAVAILABLE, not
// PLANNED, so the messaging is accurate ("you don't have access" vs
// "this doesn't exist yet").
export type SettingsItemStatus = "AVAILABLE" | "PLANNED";

export type SettingsNavItem = {
  id: string;
  label: string;
  route: string;
  status: SettingsItemStatus;
  description: string;
  /** Checked only when status is AVAILABLE. */
  requiredPermission?: string;
};

export type SettingsNavSection = {
  id: string;
  label: string;
  items: SettingsNavItem[];
};

export const SETTINGS_NAVIGATION: readonly SettingsNavSection[] = [
  {
    id: "account",
    label: "Your account",
    items: [
      { id: "profile", label: "Profile", route: "/settings/profile", status: "AVAILABLE", description: "Your name, email, locale and timezone." },
      { id: "security", label: "Security", route: "/settings/security", status: "AVAILABLE", description: "Active sessions and devices signed in to your account." },
    ],
  },
  {
    id: "organization",
    label: "Organization",
    items: [
      { id: "organization-details", label: "Organization", route: "/settings/organization", status: "AVAILABLE", description: "Name, timezone, and fiscal year start.", requiredPermission: "organization.manage" },
      { id: "companies", label: "Companies", route: "/settings/companies", status: "AVAILABLE", description: "Legal entities within your organization.", requiredPermission: "company.manage" },
      { id: "branches", label: "Branches", route: "/settings/branches", status: "AVAILABLE", description: "Locations within each company.", requiredPermission: "branch.manage" },
    ],
  },
  {
    id: "people",
    label: "People and access",
    items: [
      { id: "users", label: "Users", route: "/settings/users", status: "AVAILABLE", description: "Active members, status, and assigned roles.", requiredPermission: "users.manage" },
      { id: "invitations", label: "Invitations", route: "/settings/invitations", status: "AVAILABLE", description: "Pending invitations and their status.", requiredPermission: "users.manage" },
      { id: "roles", label: "Roles and permissions", route: "/settings/roles", status: "AVAILABLE", description: "Create custom roles, edit permission grants, and assign roles to users.", requiredPermission: "roles.view" },
    ],
  },
  {
    id: "billing-integrations",
    label: "Billing and integrations",
    items: [
      { id: "billing", label: "Billing and plans", route: "/settings/billing", status: "AVAILABLE", description: "Your plan, users, payments and invoices.", requiredPermission: "billing.view" },
      { id: "integrations", label: "Integrations", route: "/settings/integrations", status: "PLANNED", description: "Connected third-party services." },
      { id: "api-keys", label: "API keys", route: "/settings/api-keys", status: "PLANNED", description: "Keys for programmatic access." },
      { id: "oauth-connections", label: "OAuth connections", route: "/settings/oauth-connections", status: "PLANNED", description: "Authorized OAuth applications." },
    ],
  },
  {
    id: "governance",
    label: "Governance",
    items: [
      { id: "notification-preferences", label: "Notification preferences", route: "/settings/notification-preferences", status: "PLANNED", description: "Organization-wide notification defaults." },
      { id: "privacy", label: "Privacy and retention", route: "/settings/privacy", status: "PLANNED", description: "Data retention and privacy request handling." },
      { id: "feature-configuration", label: "Feature configuration", route: "/settings/feature-configuration", status: "PLANNED", description: "Feature flags and rollout configuration." },
      { id: "audit", label: "Audit", route: "/settings/audit", status: "PLANNED", description: "Organization-wide audit log." },
      { id: "ai-governance", label: "AI governance", route: "/settings/ai-governance", status: "PLANNED", description: "AI feature policy and oversight." },
    ],
  },
];
