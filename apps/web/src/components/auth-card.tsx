import Link from "next/link";

import AppIcon from "@/components/app-icon";

const trustPoints = [
  {
    title: "Role-scoped access",
    description:
      "Users see only the companies, branches and actions assigned to them.",
  },
  {
    title: "Auditable by design",
    description:
      "Authentication, configuration and access changes remain traceable.",
  },
  {
    title: "Built for Indian operations",
    description:
      "INR, Asia/Kolkata and April fiscal-year defaults accelerate setup.",
  },
];

export default function AuthCard({
  eyebrow,
  title,
  description,
  children,
  footer,
  pageClassName,
}: {
  eyebrow: string;
  title: string;
  description: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  pageClassName?: string;
}) {
  return (
    <main className={`auth-page${pageClassName ? ` ${pageClassName}` : ""}`}>
      <section className="auth-brand-panel" aria-labelledby="auth-value-title">
        <div className="auth-brand-top">
          <Link
            href="/"
            className="brand-mark inverse"
            aria-label="Vercentlabs ERP home"
          >
            <span className="brand-symbol" aria-hidden="true">
              V
            </span>
            <span className="brand-wordmark">
              <strong>Vercentlabs</strong>
              <small>Enterprise resource planning</small>
            </span>
          </Link>
          <span className="auth-secure-badge">
            <AppIcon name="security" size={15} /> Secure workspace
          </span>
        </div>

        <div className="auth-value">
          <span className="auth-orbit" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
          <p className="eyebrow">One trusted operating system</p>
          <h1 id="auth-value-title">
            Clarity, control and accountability for every business action.
          </h1>
          <p className="auth-value-copy">
            Build the organisation foundation first, then connect workflows
            across teams without losing context or governance.
          </p>

          <ul className="auth-trust-list">
            {trustPoints.map((point) => (
              <li key={point.title}>
                <span aria-hidden="true">
                  <AppIcon name="check" size={16} />
                </span>
                <div>
                  <strong>{point.title}</strong>
                  <p>{point.description}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        <div className="auth-footnote">
          <span>Vercentlabs LLP</span>
          <span aria-hidden="true">•</span>
          <span>Enterprise software platform</span>
        </div>
      </section>

      <section className="auth-form-panel">
        <div className="auth-form-frame">
          <div className="auth-mobile-brand">
            <span className="brand-symbol" aria-hidden="true">
              V
            </span>
            <strong>Vercentlabs ERP</strong>
          </div>
          <div className="auth-card">
            <div className="auth-card-heading">
              <p className="eyebrow">{eyebrow}</p>
              <h2>{title}</h2>
              <p className="muted">{description}</p>
            </div>
            <div className="auth-form-content">{children}</div>
            {footer ? <div className="auth-footer">{footer}</div> : null}
          </div>
          <p className="auth-privacy-note">
            Protected by secure sessions, rate controls and auditable account
            events.
          </p>
        </div>
      </section>
    </main>
  );
}
