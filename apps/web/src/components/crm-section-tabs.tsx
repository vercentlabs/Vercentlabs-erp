"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const crmAreas = [
  {
    label: "Lead workspace",
    paths: ["/crm/leads", "/crm/lead-acquisition", "/crm/lead-intelligence"],
    items: [
      { href: "/crm/leads", label: "All leads" },
      { href: "/crm/lead-acquisition", label: "Acquisition" },
      { href: "/crm/lead-intelligence", label: "Scoring, SLA & nurture" },
    ],
  },
  {
    label: "Opportunity workspace",
    paths: ["/crm/opportunities", "/crm/pipeline", "/crm/opportunity-revenue"],
    items: [
      { href: "/crm/opportunities", label: "Opportunities" },
      { href: "/crm/pipeline", label: "Pipeline" },
      { href: "/crm/opportunity-revenue", label: "Forecasting & revenue" },
    ],
  },
  {
    label: "Communication workspace",
    paths: ["/crm/communications", "/crm/conversation-intelligence"],
    items: [
      { href: "/crm/communications", label: "Inbox, email & calendar" },
      {
        href: "/crm/conversation-intelligence",
        label: "Calls & conversations",
      },
    ],
  },
  {
    label: "CRM administration",
    paths: ["/crm/settings", "/crm/mobile-readiness", "/crm/readiness"],
    items: [
      { href: "/crm/settings", label: "CRM settings" },
      { href: "/crm/mobile-readiness", label: "Release readiness" },
    ],
  },
] as const;

function matches(pathname: string, path: string) {
  return pathname === path || pathname.startsWith(`${path}/`);
}

export default function CrmSectionTabs() {
  const pathname = usePathname();
  const area = crmAreas.find((candidate) =>
    candidate.paths.some((path) => matches(pathname, path)),
  );

  if (!area) return null;

  return (
    <section className="crm-section-tabs-shell" aria-label={area.label}>
      <div className="crm-section-tabs-heading">
        <span>{area.label}</span>
        <small>Advanced tools stay inside the workflow they support.</small>
      </div>
      <nav className="crm-section-tabs" aria-label={`${area.label} sections`}>
        {area.items.map((item) => {
          const active = matches(pathname, item.href);
          return (
            <Link
              aria-current={active ? "page" : undefined}
              className={active ? "active" : undefined}
              href={item.href}
              key={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </section>
  );
}
