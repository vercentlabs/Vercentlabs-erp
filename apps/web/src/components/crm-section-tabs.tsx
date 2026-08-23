"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

const crmAreas = [
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
    paths: ["/crm/communications"],
    items: [
      { href: "/crm/communications", label: "Inbox, email & calendar" },
    ],
  },
  {
    label: "CRM administration",
    paths: ["/crm/settings", "/crm/mobile-readiness"],
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
  const tabsRef = useRef<HTMLElement | null>(null);
  const [hasOverflow, setHasOverflow] = useState(false);
  const area = crmAreas.find((candidate) =>
    candidate.paths.some((path) => matches(pathname, path)),
  );

  useEffect(() => {
    const element = tabsRef.current;

    if (!element || typeof ResizeObserver === "undefined") {
      setHasOverflow(false);
      return;
    }

    const updateOverflow = () => {
      setHasOverflow(element.scrollWidth > element.clientWidth + 4);
    };

    updateOverflow();

    const observer = new ResizeObserver(updateOverflow);
    observer.observe(element);

    return () => observer.disconnect();
  }, [area, pathname]);

  if (!area) return null;

  return (
    <section
      className={`crm-section-tabs-shell${hasOverflow ? " has-overflow" : ""}`}
      aria-label={area.label}
    >
      <div className="crm-section-tabs-heading">
        <span>{area.label}</span>
        <small>Advanced tools stay inside the workflow they support.</small>
      </div>
      <nav
        className="crm-section-tabs"
        aria-label={`${area.label} sections`}
        ref={tabsRef}
      >
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
      {hasOverflow ? (
        <p className="crm-section-tabs-hint" aria-hidden="true">
          Scroll for more sections
        </p>
      ) : null}
    </section>
  );
}
