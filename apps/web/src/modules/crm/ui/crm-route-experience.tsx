"use client";

import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

import { resolveCrmRouteContract } from "./crm-route-registry";

export function CrmRouteExperience({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const contract = resolveCrmRouteContract(pathname);

  return (
    <>
      <a className="crm-skip-link" href="#crm-route-content">
        Skip to CRM content
      </a>
      <div
        id="crm-route-content"
        className="crm-route-experience"
        data-crm-archetype={contract.archetype}
        data-crm-content={contract.content}
        data-crm-route-label={contract.label}
      >
        {children}
      </div>
    </>
  );
}
