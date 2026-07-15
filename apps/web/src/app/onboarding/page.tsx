import { redirect } from "next/navigation";

import AppIcon from "@/components/app-icon";
import OnboardingForm from "@/components/onboarding-form";
import { requireVerifiedUser } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const metadata = { title: "Organisation setup" };

const setupSteps = [
  {
    number: "01",
    title: "Organisation",
    description: "Identity and legal company",
    icon: "organisation" as const,
  },
  {
    number: "02",
    title: "Operations",
    description: "Company and branch context",
    icon: "branches" as const,
  },
  {
    number: "03",
    title: "Regional defaults",
    description: "Currency, timezone and fiscal year",
    icon: "accounting" as const,
  },
];

export default async function OnboardingPage() {
  const session = await requireVerifiedUser();
  if (session.organizationId) redirect("/dashboard");

  return (
    <main className="onboarding-page">
      <header className="onboarding-header">
        <div className="brand-mark">
          <span className="brand-symbol" aria-hidden="true">
            V
          </span>
          <span className="brand-wordmark">
            <strong>Vercent</strong>
            <small>ERP workspace setup</small>
          </span>
        </div>
        <div className="onboarding-account">
          <span>Signed in as</span>
          <strong>{session.fullName}</strong>
          <small>{session.email}</small>
        </div>
      </header>

      <div className="onboarding-layout">
        <aside className="onboarding-rail" aria-label="Setup overview">
          <div>
            <p className="eyebrow">Workspace setup</p>
            <h1>Create a reliable operating foundation.</h1>
            <p>
              Establish the minimum structure required for secure access,
              reporting and future business workflows.
            </p>
          </div>

          <ol className="onboarding-steps">
            {setupSteps.map((step) => (
              <li key={step.number}>
                <span className="onboarding-step-icon" aria-hidden="true">
                  <AppIcon name={step.icon} size={19} />
                </span>
                <div>
                  <small>Step {step.number}</small>
                  <strong>{step.title}</strong>
                  <p>{step.description}</p>
                </div>
              </li>
            ))}
          </ol>

          <div className="onboarding-assurance">
            <AppIcon name="security" size={19} />
            <p>
              <strong>Safe setup</strong>
              Your organisation, company, branch and owner access are created in
              one database transaction.
            </p>
          </div>
        </aside>

        <section className="onboarding-card" aria-labelledby="onboarding-title">
          <div className="onboarding-card-heading">
            <p className="eyebrow">Organisation onboarding</p>
            <h2 id="onboarding-title">Tell us how your business operates.</h2>
            <p className="lead">
              Start with the primary legal entity and operating branch. You can
              expand the structure later.
            </p>
          </div>
          <OnboardingForm />
        </section>
      </div>
    </main>
  );
}
