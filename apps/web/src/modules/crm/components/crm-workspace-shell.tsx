import Link from "next/link";
import type { ReactNode } from "react";

import AppIcon from "@/shared/components/app-icon";

export type CrmWorkspaceMetric = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  tone?: "neutral" | "success" | "warning" | "danger";
};

export type CrmWorkspaceAction = {
  href: string;
  label: string;
  primary?: boolean;
};

export default function CrmWorkspaceShell({
  eyebrow,
  title,
  description,
  status,
  statusTone = "neutral",
  actions = [],
  metrics = [],
  children,
}: {
  eyebrow: string;
  title: string;
  description: string;
  status?: ReactNode;
  statusTone?: "neutral" | "success" | "warning" | "danger";
  actions?: CrmWorkspaceAction[];
  metrics?: CrmWorkspaceMetric[];
  children: ReactNode;
}) {
  return (
    <div className="module-workbench crm-workbench crm-product-shell">
      <section className="module-hero crm-product-hero">
        <div className="module-hero-copy">
          <span className="module-hero-icon" aria-hidden="true">
            <AppIcon name="crm" size={22} />
          </span>
          <div>
            <p className="eyebrow">{eyebrow}</p>
            <h1>{title}</h1>
            <p>{description}</p>
          </div>
        </div>
        <div className="module-hero-actions">
          {status ? (
            <span className={`status-badge ${statusTone}`}>{status}</span>
          ) : null}
          {actions.map((action) => (
            <Link
              className={action.primary ? "primary-button" : "secondary-button"}
              href={action.href}
              key={`${action.href}-${action.label}`}
            >
              {action.label}
            </Link>
          ))}
        </div>
      </section>

      {metrics.length ? (
        <section className="crm-product-metrics" aria-label="Workspace metrics">
          {metrics.map((metric) => (
            <article
              className={`metric-card crm-product-metric ${metric.tone || "neutral"}`}
              key={metric.label}
            >
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              {metric.detail ? <small>{metric.detail}</small> : null}
            </article>
          ))}
        </section>
      ) : null}

      {children}
    </div>
  );
}
