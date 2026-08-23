import AppIcon, { type AppIconName } from "@/components/app-icon";

/**
 * Route-aware semantic iconography for workspace destinations.
 *
 * Module identity continues to use AppIcon's 12 dedicated module glyphs.
 * This component fixes the older problem where unrelated leaf destinations
 * reused generic "modules", "sales", "audit" or "check" glyphs.
 *
 * Identical concepts may intentionally reuse a standard symbol (for example
 * every Reports destination uses the reporting symbol). HCI consistency is
 * more useful than making visually arbitrary icons merely to force uniqueness.
 */
const routeGlyph: Record<string, React.ReactNode> = {
  "/crm/leads": (
    <>
      <path d="M4 5h16l-6.2 7.1v5.2l-3.6 1.8v-7L4 5Z" />
      <circle cx="18.5" cy="17.5" r="2.5" />
    </>
  ),
  "/crm/accounts": (
    <>
      <path d="M4 21V5h10v16M14 9h6v12" />
      <path d="M7 9h4M7 13h4M7 17h4M17 13h.01M17 17h.01" />
    </>
  ),
  "/crm/contacts": (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="10" cy="9" r="2.5" />
      <path d="M6.5 16a3.5 3.5 0 0 1 7 0M16 7h2M16 11h2M16 15h2" />
    </>
  ),
  "/crm/opportunities": (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="4" />
      <path d="m15 9 6-6M17 3h4v4" />
    </>
  ),
  "/crm/activities": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3.5 2M7 4l-2 2M17 4l2 2" />
    </>
  ),
  "/crm/pipeline": (
    <>
      <path d="M3 5h18l-4 5H7L3 5ZM7 10h10l-3 5h-4l-3-5ZM10 15h4l-2 5-2-5Z" />
    </>
  ),
  "/crm/communications": (
    <>
      <path d="M4 5h16v11H9l-5 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  "/sales/quotations": (
    <>
      <path d="M6 3h9l3 3v15H6V3Z" />
      <path d="M15 3v4h4M9 11h6M9 15h4" />
      <path d="M13 8h-2a1.5 1.5 0 0 0 0 3h2a1.5 1.5 0 0 1 0 3h-2M12 7v8" />
    </>
  ),
  "/sales/orders": (
    <>
      <path d="M4 5h2l2 11h9l2-8H7" />
      <circle cx="10" cy="20" r="1" />
      <circle cx="17" cy="20" r="1" />
      <path d="m11 11 2 2 4-4" />
    </>
  ),
  "/accounting/journals": (
    <>
      <path d="M5 4h11a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3V4Z" />
      <path d="M8 4v16M11 9h5M11 13h5" />
    </>
  ),
  "/accounting/receivables": (
    <>
      <rect x="3" y="6" width="15" height="12" rx="2" />
      <path d="M3 10h15M7 14h4M20 8v9M17 14l3 3 3-3" />
    </>
  ),
  "/accounting/payables": (
    <>
      <rect x="6" y="6" width="15" height="12" rx="2" />
      <path d="M6 10h15M10 14h4M4 17V8M1 11l3-3 3 3" />
    </>
  ),
  "/accounting/banking": (
    <>
      <path d="M3 8 12 3l9 5M5 9h14M6 9v8M10 9v8M14 9v8M18 9v8M4 20h16" />
    </>
  ),
  "/accounting/assets": (
    <>
      <path d="m12 3 8 4v10l-8 4-8-4V7l8-4Z" />
      <path d="m4 7 8 4 8-4M12 11v10" />
    </>
  ),
  "/accounting/planning": (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M7 14h3M14 14h3M7 18h3" />
    </>
  ),
  "/accounting/tax": (
    <>
      <circle cx="8" cy="8" r="2" />
      <circle cx="16" cy="16" r="2" />
      <path d="m6 18 12-12" />
    </>
  ),
  "/accounting/operations": (
    <>
      <path d="M4 7h10M18 7h2M4 17h2M10 17h10M4 12h4M12 12h8" />
      <circle cx="16" cy="7" r="2" />
      <circle cx="8" cy="17" r="2" />
      <circle cx="10" cy="12" r="2" />
    </>
  ),
  "/accounting/close": (
    <>
      <rect x="5" y="10" width="14" height="10" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3M9 15l2 2 4-4" />
    </>
  ),
  "/procurement/requisitions": (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2h6v2M9 9h6M9 13h3M16 13v5M13.5 15.5h5" />
    </>
  ),
  "/procurement/sourcing": (
    <>
      <circle cx="6" cy="7" r="2" />
      <circle cx="18" cy="7" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M8 8.5 11 16M16 8.5 13 16M8 7h8" />
    </>
  ),
  "/procurement/suppliers": (
    <>
      <path d="M3 8h11v10H3V8ZM14 11h4l3 3v4h-7v-7Z" />
      <circle cx="7" cy="19" r="2" />
      <circle cx="18" cy="19" r="2" />
    </>
  ),
  "/procurement/contracts": (
    <>
      <path d="M6 3h9l3 3v15H6V3Z" />
      <path d="M15 3v4h4M9 11h6M9 15h4M9 18h3" />
      <path d="m14 18 2 2 4-4" />
    </>
  ),
  "/procurement/orders": (
    <>
      <path d="M4 5h2l2 10h10l2-7H7" />
      <path d="M10 10h6M13 7v6" />
      <circle cx="10" cy="19" r="1.5" />
      <circle cx="17" cy="19" r="1.5" />
    </>
  ),
  "/procurement/receipts": (
    <>
      <path d="m12 3 8 4v10l-8 4-8-4V7l8-4Z" />
      <path d="m4 7 8 4 8-4M12 11v10M8 15l2 2 5-5" />
    </>
  ),
  "/procurement/matching": (
    <>
      <path d="M5 5h5M5 12h5M5 19h5M14 5h5M14 12h5M14 19h5" />
      <path d="m8 3 2 2-2 2M17 10l2 2-2 2M8 17l2 2-2 2" />
    </>
  ),
  "/stock/balances": (
    <>
      <path d="m8 3 5 3-5 3-5-3 5-3ZM16 5l5 3-5 3-3-1.8M8 12l5 3-5 3-5-3 5-3Z" />
      <path d="M16 14h5M18.5 11.5v5" />
    </>
  ),
  "/stock/movements": (
    <>
      <path d="M4 8h13M14 5l3 3-3 3M20 16H7M10 13l-3 3 3 3" />
    </>
  ),
  "/stock/transfers": (
    <>
      <path d="M4 7h14M15 4l3 3-3 3M20 17H6M9 14l-3 3 3 3" />
      <path d="M4 12h16" />
    </>
  ),
  "/stock/batches": (
    <>
      <path d="m12 3 8 4-8 4-8-4 8-4Z" />
      <path d="m4 12 8 4 8-4M4 17l8 4 8-4" />
    </>
  ),
  "/stock/serials": (
    <>
      <path d="M4 5v14M7 5v14M10 5v14M14 5v14M17 5v14M20 5v14" />
      <path d="M3 8h18M3 16h18" />
    </>
  ),
  "/stock/reservations": (
    <>
      <path d="M6 3h12v18l-6-4-6 4V3Z" />
      <path d="M9 9h6M9 12h4" />
    </>
  ),
  "/stock/reorder-rules": (
    <>
      <path d="M5 7h11l-3-3M19 17H8l3 3" />
      <path d="M16 7a6 6 0 0 1 3 5M8 17a6 6 0 0 1-3-5" />
    </>
  ),
  "/manufacturing/boms": (
    <>
      <circle cx="12" cy="4" r="2" />
      <circle cx="6" cy="12" r="2" />
      <circle cx="18" cy="12" r="2" />
      <circle cx="12" cy="20" r="2" />
      <path d="M12 6v3M10 10 7 11M14 10l3 1M8 13l3 5M16 13l-3 5" />
    </>
  ),
  "/manufacturing/routings": (
    <>
      <circle cx="5" cy="6" r="2" />
      <circle cx="19" cy="6" r="2" />
      <circle cx="12" cy="18" r="2" />
      <path d="M7 6h6a4 4 0 0 1 4 4v1a5 5 0 0 1-5 5M19 8v3" />
    </>
  ),
  "/manufacturing/work-orders": (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2h6v2M9 10h6M9 14h3" />
      <path d="m15 15 4 4M17 13l2 2-4 4-2-2 4-4Z" />
    </>
  ),
  "/manufacturing/work-centers": (
    <>
      <path d="M3 21V10l6 3V9l6 4V6l6 4v11H3Z" />
      <circle cx="17" cy="16" r="2" />
      <path d="M17 12v2M17 18v2M13 16h2M19 16h2" />
    </>
  ),
  "/manufacturing/material-requirements": (
    <>
      <path d="m6 4 5 3-5 3-5-3 5-3ZM17 5l5 3-5 3-5-3 5-3ZM11 14l5 3-5 3-5-3 5-3Z" />
      <path d="M6 10v3l5 2M17 11v3l-3 1" />
    </>
  ),
  "/manufacturing/production-postings": (
    <>
      <path d="M4 20V9l5 3V8l5 3V5l6 4v11H4Z" />
      <path d="m9 17 2 2 5-5" />
    </>
  ),
  "/projects/projects": (
    <>
      <path d="M3 7h7l2 2h9v11H3V7Z" />
      <path d="M7 13h10M7 17h7" />
    </>
  ),
  "/projects/milestones": (
    <>
      <path d="M6 21V4M7 5h10l-2 4 2 4H7" />
      <circle cx="6" cy="4" r="1.5" />
    </>
  ),
  "/projects/tasks": (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="m8 10 2 2 4-4M8 16h8" />
    </>
  ),
  "/projects/time-entries": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v6l4 2" />
    </>
  ),
  "/projects/expenses": (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  "/projects/budgets": (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2" />
      <path d="M3 10h18M8 15h3M16 13v4M14 15h4" />
    </>
  ),
  "/projects/profitability": (
    <>
      <path d="M4 19V9M10 19V13M16 19V6M3 20h18" />
      <path d="m4 7 5-3 5 4 6-6" />
    </>
  ),
  "/assets/assets": (
    <>
      <rect x="4" y="5" width="16" height="14" rx="2" />
      <path d="M8 5V3h8v2M8 10h8M8 14h5M16 16h.01" />
    </>
  ),
  "/assets/assignments": (
    <>
      <rect x="3" y="5" width="9" height="8" rx="1.5" />
      <circle cx="17" cy="9" r="3" />
      <path d="M13 20a4 4 0 0 1 8 0M8 16h3M10 14l2 2-2 2" />
    </>
  ),
  "/assets/transfers": (
    <>
      <rect x="3" y="5" width="7" height="7" rx="1" />
      <rect x="14" y="12" width="7" height="7" rx="1" />
      <path d="M10 8h7M15 6l2 2-2 2M14 16H7M9 14l-2 2 2 2" />
    </>
  ),
  "/assets/maintenance-orders": (
    <>
      <path d="m14 6 4-3 3 3-3 4-4-4Z" />
      <path d="m13 7-8 8-2 5 5-2 8-8M6 15l3 3" />
    </>
  ),
  "/assets/inspections": (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m14.5 14.5 5 5M7.5 10l1.5 1.5 3-3" />
    </>
  ),
  "/assets/depreciation-runs": (
    <>
      <path d="M4 5v14h16" />
      <path d="m7 9 4 4 3-2 4 5" />
      <path d="M18 12v4h-4" />
    </>
  ),
  "/assets/disposals": (
    <>
      <path d="M5 7h14M9 3h6l1 4H8l1-4ZM7 7l1 14h8l1-14" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  "/point-of-sale/checkout": (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 12h2M14 12h2M8 16h8" />
    </>
  ),
  "/point-of-sale/sales": (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  "/point-of-sale/returns": (
    <>
      <path d="M8 7H4v-4M4 7a8 8 0 1 1-1 8" />
      <path d="M9 11h6M9 15h4" />
    </>
  ),
  "/point-of-sale/shifts": (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2M6 4l2 2M18 4l-2 2" />
    </>
  ),
  "/point-of-sale/cash-movements": (
    <>
      <rect x="3" y="7" width="18" height="11" rx="2" />
      <circle cx="12" cy="12.5" r="2.5" />
      <path d="M7 10H5M19 15h-2M8 4l-2 2 2 2M16 21l2-2-2-2" />
    </>
  ),
  "/point-of-sale/reconciliations": (
    <>
      <path d="M4 7h16M7 4l-3 3 3 3M17 14h3l-3 3 3 3" />
      <path d="m9 15 2 2 4-4" />
    </>
  ),
  "/point-of-sale/terminals": (
    <>
      <rect x="4" y="3" width="16" height="14" rx="2" />
      <path d="M8 21h8M12 17v4M8 8h8M8 12h5" />
    </>
  ),
  "/quality/plans": (
    <>
      <rect x="5" y="3" width="14" height="18" rx="2" />
      <path d="M9 8h6M9 12h6M9 16h3M15 16l1.5 1.5L20 14" />
    </>
  ),
  "/quality/inspections": (
    <>
      <circle cx="10" cy="10" r="6" />
      <path d="m14.5 14.5 5 5M7.5 10l1.5 1.5 3-3" />
    </>
  ),
  "/quality/holds": (
    <>
      <path d="M12 3 5 6v6c0 4.5 3 7.6 7 9 4-1.4 7-4.5 7-9V6l-7-3Z" />
      <path d="M10 9v6M14 9v6" />
    </>
  ),
  "/quality/non-conformances": (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 9v5M12 17h.01" />
    </>
  ),
  "/quality/capa": (
    <>
      <path d="M5 8a8 8 0 0 1 13-2M19 6v5h-5M19 16a8 8 0 0 1-13 2M5 18v-5h5" />
      <path d="m9 12 2 2 4-4" />
    </>
  ),
  "/quality/supplier-quality": (
    <>
      <path d="M3 8h10v9H3V8ZM13 11h4l4 3v3h-8v-6Z" />
      <path d="M9 5 12 3l3 2v3M7 13l2 2 4-4" />
    </>
  ),
  "/quality/audits": (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2" />
      <path d="M9 4V2h6v2M9 9h6M9 13h6M9 17h3" />
      <circle cx="17" cy="17" r="3" />
    </>
  ),
  "/support/tickets": (
    <>
      <path d="M4 6h16v4a2 2 0 0 0 0 4v4H4v-4a2 2 0 0 0 0-4V6Z" />
      <path d="M9 9h6M9 15h4" />
    </>
  ),
  "/support/queues": (
    <>
      <path d="M7 6h13M7 12h13M7 18h13" />
      <circle cx="3" cy="6" r="1" />
      <circle cx="3" cy="12" r="1" />
      <circle cx="3" cy="18" r="1" />
    </>
  ),
  "/support/sla-policies": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2M8 3l-2 2M16 3l2 2" />
      <path d="M8 20h8" />
    </>
  ),
  "/support/escalations": (
    <>
      <path d="M12 20V5M7 10l5-5 5 5" />
      <path d="M5 20h14" />
    </>
  ),
  "/support/communications": (
    <>
      <path d="M4 5h16v11H9l-5 4V5Z" />
      <path d="M8 9h8M8 12h5" />
    </>
  ),
  "/support/knowledge": (
    <>
      <path d="M4 5a4 4 0 0 1 4-2h4v17H8a4 4 0 0 0-4 2V5ZM20 5a4 4 0 0 0-4-2h-4v17h4a4 4 0 0 1 4 2V5Z" />
    </>
  ),
  "/support/customer-history": (
    <>
      <circle cx="12" cy="12" r="8" />
      <path d="M12 8v5l3 2M4 7V3M4 3h4" />
      <path d="M5 5a9 9 0 1 1-1 9" />
    </>
  ),
  "/hr-payroll/employees": (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <circle cx="10" cy="9" r="2.5" />
      <path d="M6.5 16a3.5 3.5 0 0 1 7 0M15 8h2M15 12h2M15 16h2" />
    </>
  ),
  "/hr-payroll/attendance": (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M8 15l2 2 5-5" />
    </>
  ),
  "/hr-payroll/leave-requests": (
    <>
      <rect x="3" y="5" width="18" height="16" rx="2" />
      <path d="M7 3v4M17 3v4M3 10h18M9 14l6 6M15 14l-6 6" />
    </>
  ),
  "/hr-payroll/expenses": (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
    </>
  ),
  "/hr-payroll/salary-structures": (
    <>
      <circle cx="9" cy="10" r="4" />
      <path d="M9 6V4M9 16v2M7 8h3a1.5 1.5 0 0 1 0 3H8a1.5 1.5 0 0 0 0 3h3" />
      <path d="M16 7h5M16 12h5M16 17h5" />
    </>
  ),
  "/hr-payroll/payroll-runs": (
    <>
      <rect x="4" y="3" width="16" height="18" rx="2" />
      <path d="M8 7h8M8 11h2M14 11h2M8 15h2M14 15h2" />
      <path d="M8 19h8" />
    </>
  ),
  "/hr-payroll/payslips": (
    <>
      <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
      <path d="M9 8h6M9 12h6M9 16h4" />
      <path d="M16 15h3" />
    </>
  ),
};

function standardGlyphForRoute(href: string): AppIconName | null {
  if (href.endsWith("/reports") || href === "/reports") return "audit";
  if (href.endsWith("/settings") || href.startsWith("/settings")) return "settings";
  if (href === "/dashboard") return "dashboard";
  if (href === "/master-data") return "modules";
  if (href === "/my-work") return "approvals";
  if (href === "/notifications") return "notifications";
  if (href === "/approvals") return "approvals";
  if (href.startsWith("/audit-logs") || href.startsWith("/compliance")) return "security";
  return null;
}

export default function SemanticNavigationIcon({
  href,
  fallback,
  size = 20,
  className,
}: {
  href: string;
  fallback?: AppIconName;
  size?: number;
  className?: string;
}) {
  const glyph = routeGlyph[href];
  if (!glyph) {
    const standard = standardGlyphForRoute(href);
    return (
      <AppIcon
        className={className}
        name={standard ?? fallback ?? "modules"}
        size={size}
      />
    );
  }

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
      {glyph}
    </svg>
  );
}
