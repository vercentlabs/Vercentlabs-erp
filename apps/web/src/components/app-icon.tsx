export type AppIconName =
  | "dashboard"
  | "modules"
  | "approvals"
  | "notifications"
  | "audit"
  | "organisation"
  | "companies"
  | "branches"
  | "departments"
  | "teams"
  | "cost-centres"
  | "users"
  | "roles"
  | "numbering"
  | "settings"
  | "billing"
  | "search"
  | "security"
  | "profile"
  | "logout"
  | "chevron-down"
  | "arrow-right"
  | "check"
  | "sparkles"
  | "accounting"
  | "procurement"
  | "sales"
  | "crm"
  | "stock"
  | "manufacturing"
  | "projects"
  | "assets"
  | "point-of-sale"
  | "quality"
  | "support"
  | "hr-payroll";

const paths: Record<AppIconName, React.ReactNode> = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" rx="2" />
      <rect x="14" y="3" width="7" height="7" rx="2" />
      <rect x="3" y="14" width="7" height="7" rx="2" />
      <rect x="14" y="14" width="7" height="7" rx="2" />
    </>
  ),
  modules: (
    <>
      <rect x="3" y="3" width="6" height="6" rx="1.5" />
      <rect x="15" y="3" width="6" height="6" rx="1.5" />
      <rect x="3" y="15" width="6" height="6" rx="1.5" />
      <rect x="15" y="15" width="6" height="6" rx="1.5" />
      <path d="M12 5.5v13M5.5 12h13" />
    </>
  ),
  approvals: (
    <>
      <path d="M9 11.5 11 13.5 15.5 9" />
      <path d="M12 3.5 5.5 6v5.6c0 4.3 2.8 7.6 6.5 8.9 3.7-1.3 6.5-4.6 6.5-8.9V6L12 3.5Z" />
    </>
  ),
  notifications: (
    <>
      <path d="M18 8.5a6 6 0 0 0-12 0c0 7-3 7-3 8.5h18C21 15.5 18 15.5 18 8.5Z" />
      <path d="M9.5 20.5h5" />
    </>
  ),
  audit: (
    <>
      <path d="M8 4h8" />
      <path d="M9 3h6v3H9z" />
      <rect x="5" y="5" width="14" height="16" rx="2" />
      <path d="M8.5 10h7M8.5 14h7M8.5 18h4" />
    </>
  ),
  organisation: (
    <>
      <path d="M4 21V8l8-4 8 4v13" />
      <path d="M8 21v-5h8v5M8 10h.01M12 10h.01M16 10h.01M8 13h.01M12 13h.01M16 13h.01" />
    </>
  ),
  companies: (
    <>
      <path d="M4 21V5h10v16M14 9h6v12" />
      <path d="M7 8h4M7 12h4M7 16h4M17 12h.01M17 16h.01" />
    </>
  ),
  branches: (
    <>
      <circle cx="6" cy="5" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="18" cy="18" r="2" />
      <path d="M8 5h3a4 4 0 0 1 4 4v5a4 4 0 0 0 1 2.6M6 7v10a3 3 0 0 0 3 3h7" />
    </>
  ),
  departments: (
    <>
      <path d="M12 3 3.5 7.5 12 12l8.5-4.5L12 3Z" />
      <path d="m3.5 12 8.5 4.5 8.5-4.5M3.5 16.5 12 21l8.5-4.5" />
    </>
  ),
  teams: (
    <>
      <circle cx="9" cy="8" r="3" />
      <circle cx="17" cy="9" r="2.5" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0M14 15.5a4.5 4.5 0 0 1 6.5 4" />
    </>
  ),
  "cost-centres": (
    <>
      <rect x="3" y="6" width="18" height="14" rx="2" />
      <path d="M3 10h18M16 15h2M7 3v3M17 3v3" />
    </>
  ),
  users: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
  roles: (
    <>
      <path d="M12 3.5 5.5 6v5.6c0 4.3 2.8 7.6 6.5 8.9 3.7-1.3 6.5-4.6 6.5-8.9V6L12 3.5Z" />
      <path d="M9.5 12h5M12 9.5v5" />
    </>
  ),
  numbering: (
    <>
      <path d="M10 3 8 21M16 3l-2 18M4 9h16M3 15h16" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.8 1.8 0 0 0 .36 2l.06.06-2.76 2.76-.06-.06a1.8 1.8 0 0 0-2-.36 1.8 1.8 0 0 0-1.1 1.65V21h-3.8v-.09A1.8 1.8 0 0 0 9 19.26a1.8 1.8 0 0 0-2 .36l-.06.06-2.76-2.76.06-.06a1.8 1.8 0 0 0 .36-2A1.8 1.8 0 0 0 2.95 13H3v-3.8h-.05A1.8 1.8 0 0 0 4.6 8.1a1.8 1.8 0 0 0-.36-2l-.06-.06L6.94 3.3l.06.06a1.8 1.8 0 0 0 2 .36A1.8 1.8 0 0 0 10.1 2.1V2h3.8v.1A1.8 1.8 0 0 0 15 3.72a1.8 1.8 0 0 0 2-.36l.06-.06 2.76 2.76-.06.06a1.8 1.8 0 0 0-.36 2A1.8 1.8 0 0 0 21.05 10H21v3.8h.05A1.8 1.8 0 0 0 19.4 15Z" />
    </>
  ),
  billing: (
    <>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <path d="M3 9h18M7 15h4M17 13v4M15 15h4" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m16.2 16.2 4.3 4.3" />
    </>
  ),
  security: (
    <>
      <rect x="5" y="10" width="14" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v3" />
    </>
  ),
  profile: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M5 21a7 7 0 0 1 14 0" />
    </>
  ),
  logout: (
    <>
      <path d="M10 4H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
      <path d="m15 8 4 4-4 4M19 12H9" />
    </>
  ),
  "chevron-down": <path d="m6 9 6 6 6-6" />,
  "arrow-right": <path d="M5 12h14M14 7l5 5-5 5" />,
  check: <path d="m5 12 4 4L19 6" />,
  sparkles: (
    <>
      <path d="m12 3 1.2 3.3L16.5 7.5l-3.3 1.2L12 12l-1.2-3.3-3.3-1.2 3.3-1.2L12 3Z" />
      <path d="m18 14 .8 2.2L21 17l-2.2.8L18 20l-.8-2.2L15 17l2.2-.8L18 14ZM5.5 13l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7Z" />
    </>
  ),
  accounting: (
    <>
      <path d="M4 5h16M6 9h12M5 21h14" />
      <path d="M7 9v8M12 9v8M17 9v8M3 5l9-3 9 3" />
    </>
  ),
  procurement: (
    <>
      <path d="M3 5h2l2.4 10.2a2 2 0 0 0 2 1.5h7.8a2 2 0 0 0 1.9-1.4L21 8H6" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="18" cy="20" r="1" />
    </>
  ),
  sales: (
    <>
      <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      <path d="m4 7 6-4 6 6 5-5" />
    </>
  ),
  crm: (
    <>
      <circle cx="9" cy="8" r="3" />
      <path d="M3.5 20a5.5 5.5 0 0 1 11 0" />
      <path d="M16 7h5M18.5 4.5v5M16 14h5M16 18h5" />
    </>
  ),
  stock: (
    <>
      <path d="m12 3 9 5-9 5-9-5 9-5Z" />
      <path d="m3 8 9 5 9-5M3 12l9 5 9-5M3 16l9 5 9-5" />
    </>
  ),
  manufacturing: (
    <>
      <path d="M3 21V9l6 3V8l6 4V5l6 4v12H3Z" />
      <path d="M7 17h2M12 17h2M17 17h2" />
    </>
  ),
  projects: (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M8 3v4M16 3v4M3 10h18M7 14h4M7 17h7" />
    </>
  ),
  assets: (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 5V3h8v2M8 10h8M8 14h5" />
    </>
  ),
  "point-of-sale": (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2" />
    </>
  ),
  quality: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="m8 12 2.5 2.5L16.5 8.5" />
    </>
  ),
  support: (
    <>
      <path d="M4 13v-1a8 8 0 0 1 16 0v1" />
      <path d="M4 13h3v6H5a2 2 0 0 1-2-2v-2a2 2 0 0 1 1-2ZM20 13h-3v6h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-1-2ZM17 19c0 1.1-2.2 2-5 2" />
    </>
  ),
  "hr-payroll": (
    <>
      <circle cx="8.5" cy="8" r="3" />
      <path d="M3 20a5.5 5.5 0 0 1 11 0M16 7h5M18.5 4.5v5M16 14h5M18.5 11.5v5" />
    </>
  ),
};

export default function AppIcon({
  name,
  size = 20,
  className,
}: {
  name: AppIconName;
  size?: number;
  className?: string;
}) {
  return (
    <svg
      aria-hidden="true"
      className={className}
      fill="none"
      height={size}
      viewBox="0 0 24 24"
      width={size}
      xmlns="http://www.w3.org/2000/svg"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth="1.8"
    >
      {paths[name]}
    </svg>
  );
}
