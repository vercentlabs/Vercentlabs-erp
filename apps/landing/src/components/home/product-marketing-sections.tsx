import {
  ArrowRight,
  Check,
  Factory,
  Network,
  Store,
  UsersRound,
  Warehouse,
} from "lucide-react";
import Link from "next/link";
import { isReleasedModule } from "@vercent/shared-types";

import PageContainer from "@/components/layout/page-container";
import RevealOnScroll from "@/components/ui/reveal-on-scroll";
import { erpModules } from "@/content/erp";
import {
  buyerQuestions,
  governanceControls,
  implementationSteps,
  integrityPoints,
  operatingSteps,
  releasedCapabilities,
} from "@/content/landing";

const industryFrames = [
  {
    icon: Factory,
    name: "Manufacturing",
    outcome: "Customer demand connected to controlled operational handoffs.",
    href: "/industries/manufacturing",
  },
  {
    icon: Warehouse,
    name: "Distribution",
    outcome: "Account, branch and fulfilment context in one commercial record.",
    href: "/industries/distribution",
  },
  {
    icon: Store,
    name: "Retail",
    outcome: "Customer history and multi-location responsibility made visible.",
    href: "/industries/retail",
  },
  {
    icon: UsersRound,
    name: "Professional services",
    outcome: "A clearer handoff from opportunity to delivery ownership.",
    href: "/industries/professional-services",
  },
];

export default function ProductMarketingSections() {
  return (
    <>
      <section id="operating-model" className="os-manifesto">
        <PageContainer width="wide">
          <RevealOnScroll>
            <div className="os-manifesto__grid">
              <p className="os-mono-label">Why this exists</p>
              <h2>Software should make operations legible.</h2>
              <p>
                The job is not to decorate a dashboard. The job is to show who
                owns the work, what changed, what must happen next and which
                decision can be trusted.
              </p>
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>

      <section className="os-section os-workflow">
        <PageContainer width="wide">
          <div className="os-workflow__layout">
            <RevealOnScroll className="os-workflow__intro">
              <p className="os-eyebrow">One operating loop</p>
              <h2>From signal to decision without losing context.</h2>
              <p>
                Every stage adds information, ownership and evidence to the same
                record instead of creating another disconnected tool.
              </p>
              <Link href="/workflows" className="os-text-link">
                Review CRM workflows <ArrowRight aria-hidden="true" />
              </Link>
            </RevealOnScroll>

            <div className="os-workflow__steps">
              {operatingSteps.map((step, index) => {
                const Icon = step.icon;
                return (
                  <RevealOnScroll key={step.number} delay={index * 60}>
                    <article className="os-workflow-step">
                      <div className="os-workflow-step__number">
                        {step.number}
                      </div>
                      <div className="os-workflow-step__icon">
                        <Icon aria-hidden="true" />
                      </div>
                      <div>
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                        <span>
                          <Check aria-hidden="true" /> {step.evidence}
                        </span>
                      </div>
                    </article>
                  </RevealOnScroll>
                );
              })}
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="os-section os-governance">
        <PageContainer width="wide">
          <RevealOnScroll>
            <div className="os-governance__heading">
              <div>
                <p className="os-eyebrow">Control is product design</p>
                <h2>Enterprise trust is built into the action.</h2>
              </div>
              <p>
                Roles, operating context, governed commands and audit history
                are not compliance decoration. They define how work moves.
              </p>
            </div>
          </RevealOnScroll>

          <div className="os-governance__grid">
            {governanceControls.map((control, index) => {
              const Icon = control.icon;
              return (
                <RevealOnScroll key={control.label} delay={index * 70}>
                  <article>
                    <header>
                      <span>
                        0{index + 1} / {control.label}
                      </span>
                      <Icon aria-hidden="true" />
                    </header>
                    <h3>{control.title}</h3>
                    <p>{control.description}</p>
                  </article>
                </RevealOnScroll>
              );
            })}
          </div>

          <RevealOnScroll>
            <div className="os-audit-example">
              <div className="os-audit-example__summary">
                <span className="os-mono-label">
                  Immutable event / 14:42:08
                </span>
                <h3>Opportunity stage changed through approved command.</h3>
              </div>
              <dl>
                <div>
                  <dt>Actor</dt>
                  <dd>Revenue lead</dd>
                </div>
                <div>
                  <dt>Entity</dt>
                  <dd>OPP-0092</dd>
                </div>
                <div>
                  <dt>From / to</dt>
                  <dd>Proposal → Decision</dd>
                </div>
                <div>
                  <dt>Context</dt>
                  <dd>North company / Pune</dd>
                </div>
              </dl>
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>

      <section className="os-section os-capabilities">
        <PageContainer width="wide">
          <RevealOnScroll>
            <div className="os-section-heading-row">
              <div>
                <p className="os-eyebrow">Released CRM capability</p>
                <h2>Enough surface area to run real customer work.</h2>
              </div>
              <p>
                The released scope is intentionally focused. Every capability
                below maps to a real workflow, record or control in the product.
              </p>
            </div>
          </RevealOnScroll>

          <div className="os-capability-grid">
            {releasedCapabilities.map((capability, index) => {
              const Icon = capability.icon;
              return (
                <RevealOnScroll key={capability.title} delay={index * 45}>
                  <article>
                    <span>0{index + 1}</span>
                    <Icon aria-hidden="true" />
                    <h3>{capability.title}</h3>
                    <p>{capability.description}</p>
                  </article>
                </RevealOnScroll>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section className="os-section os-system-map">
        <PageContainer width="wide">
          <RevealOnScroll>
            <div className="os-system-map__heading">
              <div>
                <p className="os-eyebrow">The system map</p>
                <h2>Twelve modules. One is released. Eleven are roadmap.</h2>
              </div>
              <Link href="/modules" className="os-text-link">
                Open module roadmap <ArrowRight aria-hidden="true" />
              </Link>
            </div>
          </RevealOnScroll>

          <div className="os-module-list">
            {erpModules.map((module, index) => {
              const released = isReleasedModule(module.slug);
              return (
                <RevealOnScroll key={module.slug} delay={(index % 4) * 35}>
                  <Link
                    href={`/modules/${module.slug}`}
                    className={released ? "is-released" : undefined}
                  >
                    <span className="os-module-list__number">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <span className="os-module-list__name">{module.name}</span>
                    <span className="os-module-list__status">
                      {released ? "Released early access" : "Roadmap"}
                    </span>
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </RevealOnScroll>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section className="os-section os-industries">
        <PageContainer width="wide">
          <RevealOnScroll>
            <div className="os-section-heading-row">
              <div>
                <p className="os-eyebrow">Operational settings</p>
                <h2>Built around handoffs, not industry wallpaper.</h2>
              </div>
              <p>
                The vocabulary changes by industry. Ownership, context, control
                and evidence remain the underlying operating design.
              </p>
            </div>
          </RevealOnScroll>

          <div className="os-industry-grid">
            {industryFrames.map((industry, index) => {
              const Icon = industry.icon;
              return (
                <RevealOnScroll key={industry.name} delay={index * 55}>
                  <Link href={industry.href}>
                    <span>0{index + 1}</span>
                    <Icon aria-hidden="true" />
                    <h3>{industry.name}</h3>
                    <p>{industry.outcome}</p>
                    <b>Explore context ↗</b>
                  </Link>
                </RevealOnScroll>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section className="os-section os-implementation">
        <PageContainer width="wide">
          <div className="os-implementation__layout">
            <RevealOnScroll className="os-implementation__intro">
              <p className="os-eyebrow">Implementation discipline</p>
              <h2>Start with one operating problem, not a software tour.</h2>
              <p>
                A controlled pilot is more valuable than a broad demonstration
                because it exposes ownership, data and adoption issues early.
              </p>
              <ul>
                {buyerQuestions.map((question) => (
                  <li key={question}>{question}</li>
                ))}
              </ul>
            </RevealOnScroll>

            <div className="os-implementation__steps">
              {implementationSteps.map((step, index) => (
                <RevealOnScroll key={step.number} delay={index * 70}>
                  <article>
                    <span>{step.number}</span>
                    <h3>{step.title}</h3>
                    <p>{step.description}</p>
                  </article>
                </RevealOnScroll>
              ))}
            </div>
          </div>
        </PageContainer>
      </section>

      <section className="os-section os-integrity">
        <PageContainer width="wide">
          <RevealOnScroll>
            <div className="os-integrity__heading">
              <p className="os-eyebrow">Proof without theatre</p>
              <h2>
                No customer proof is invented. Synthetic previews are labelled.
                Roadmap stays roadmap.
              </h2>
            </div>
          </RevealOnScroll>

          <div className="os-integrity__grid">
            {integrityPoints.map((point, index) => {
              const Icon = point.icon;
              return (
                <RevealOnScroll key={point.title} delay={index * 55}>
                  <article>
                    <Icon aria-hidden="true" />
                    <h3>{point.title}</h3>
                    <p>{point.description}</p>
                  </article>
                </RevealOnScroll>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section className="os-final-cta">
        <PageContainer width="wide">
          <RevealOnScroll>
            <div className="os-final-cta__frame">
              <div>
                <span className="os-mono-label">
                  Working session / 45 minutes
                </span>
                <h2>
                  Bring the broken handoff. We will map the operating system
                  around it.
                </h2>
              </div>
              <div>
                <p>
                  Share the current tools, users, locations and decision points.
                  The conversation begins with your workflow—not a generic demo.
                </p>
                <Link href="/contact" className="button-primary">
                  Start the working session <ArrowRight aria-hidden="true" />
                </Link>
              </div>
              <Network aria-hidden="true" className="os-final-cta__icon" />
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>
    </>
  );
}
