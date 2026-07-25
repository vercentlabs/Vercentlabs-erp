import {
  ArrowRight,
  BadgeCheck,
  BarChart3,
  Building2,
  Check,
  CheckCircle2,
  CircleDot,
  ClipboardCheck,
  ContactRound,
  Database,
  Fingerprint,
  Layers3,
  LockKeyhole,
  MessagesSquare,
  MousePointerClick,
  PackageCheck,
  Radar,
  Route,
  ScanSearch,
  ShieldCheck,
  Target,
  TimerReset,
} from "lucide-react";
import Link from "next/link";
import { isReleasedModule } from "@vercent/shared-types";

import PageContainer from "@/components/layout/page-container";
import SectionHeading from "@/components/marketing/section-heading";
import RevealOnScroll from "@/components/ui/reveal-on-scroll";
import { erpModules } from "@/content/erp";

const trustRail = [
  {
    eyebrow: "Released now",
    title: "A complete CRM operating loop",
    description: "Capture, qualify, progress, govern and review customer work.",
    icon: BadgeCheck,
  },
  {
    eyebrow: "Built underneath",
    title: "One control foundation",
    description: "Roles, permissions, approvals, audit and operating context.",
    icon: ShieldCheck,
  },
  {
    eyebrow: "Planned honestly",
    title: "Eleven roadmap modules",
    description:
      "Visible future scope—never presented as released functionality.",
    icon: PackageCheck,
  },
];

const workflowSteps = [
  {
    number: "01",
    icon: MousePointerClick,
    title: "Capture the signal",
    description:
      "Bring staff entry, CSV import and governed public forms into one lead record with source and campaign context.",
    proof: "Origin, consent and duplicate controls",
  },
  {
    number: "02",
    icon: Radar,
    title: "Decide what matters",
    description:
      "Use scoring, ownership, follow-up dates and qualification states to focus the team on the right next action.",
    proof: "Scoring and assignment history",
  },
  {
    number: "03",
    icon: Route,
    title: "Progress with control",
    description:
      "Move opportunities through configurable stages while preserving probability, forecast, decision and activity context.",
    proof: "Permission and approval boundaries",
  },
  {
    number: "04",
    icon: BarChart3,
    title: "Review the operating truth",
    description:
      "Inspect pipeline, overdue activity, forecast and complete record timelines without rebuilding reports in spreadsheets.",
    proof: "Audit-ready history and reports",
  },
];

const governanceCapabilities = [
  {
    icon: LockKeyhole,
    title: "Permission before presentation",
    description:
      "Navigation, records and actions respond to the signed-in user’s actual permission scope.",
  },
  {
    icon: Building2,
    title: "Operating context stays explicit",
    description:
      "Organisation, company and branch boundaries are revalidated instead of silently trusted.",
  },
  {
    icon: ClipboardCheck,
    title: "Approval decisions execute real commands",
    description:
      "Governed requests preserve separation of duties, versions and immutable decision history.",
  },
  {
    icon: Fingerprint,
    title: "Every meaningful change is traceable",
    description:
      "Audit records, activity timelines and delivery attempts retain the context needed to investigate change.",
  },
];

const crmCapabilities = [
  {
    icon: ContactRound,
    title: "Lead management",
    description:
      "Sources, campaigns, tags, scoring, duplicate detection, assignment and qualification in one record flow.",
  },
  {
    icon: Target,
    title: "Opportunity pipeline",
    description:
      "Configurable stages, Kanban movement, probability, expected close, win/loss and weighted forecast.",
  },
  {
    icon: TimerReset,
    title: "Activities and follow-up",
    description:
      "Tasks, calls, meetings, reminders, outcomes, overdue processing and complete customer context.",
  },
  {
    icon: MessagesSquare,
    title: "Communication history",
    description:
      "Provider-neutral logging, consent-aware delivery records, sequences and governed outbound work.",
  },
  {
    icon: ScanSearch,
    title: "Reports and saved views",
    description:
      "Operational views, targets, CSV import/export, forecast reporting and scoped personal views.",
  },
  {
    icon: Database,
    title: "Customer truth for future modules",
    description:
      "Lead conversion creates reusable partner, contact and opportunity records without pretending Sales or Finance is released.",
  },
];

const implementationStages = [
  {
    number: "01",
    title: "Map one real workflow",
    description:
      "Start with the current process, owners, data, controls, friction and measurable outcome.",
  },
  {
    number: "02",
    title: "Configure the operating model",
    description:
      "Define roles, stages, assignments, approvals, migration and reporting against that workflow.",
  },
  {
    number: "03",
    title: "Validate complete journeys",
    description:
      "Test success, denial, exception and cross-role behaviour—not only happy-path screens.",
  },
  {
    number: "04",
    title: "Launch with evidence",
    description:
      "Train users, observe adoption, record acceptance evidence and expand only after the foundation remains stable.",
  },
];

const faqs = [
  {
    question: "What is actually released today?",
    answer:
      "CRM is the released business module. It runs on the shared platform foundation for authentication, organisation administration, governed master data, permissions, approvals, audit history, notifications and billing controls.",
  },
  {
    question: "Are all twelve ERP modules available?",
    answer:
      "No. Eleven additional modules remain roadmap scope. The website labels those modules clearly so buyers can distinguish released functionality from planned product direction.",
  },
  {
    question: "Can VercentLabs support multiple companies and branches?",
    answer:
      "The platform foundation includes organisation, company and branch context with scoped user access. Final rollout design still depends on the operating structure being implemented.",
  },
  {
    question: "How should a design-partner rollout begin?",
    answer:
      "Begin with one measurable customer workflow, validate it with real roles and non-production data, then expand only after the full journey and control boundaries pass acceptance testing.",
  },
];

const roadmapModules = erpModules.filter(
  (module) => !isReleasedModule(module.slug),
);

export default function ProductMarketingSections() {
  return (
    <>
      <section
        aria-label="Release confidence"
        className="border-b border-slate-200 bg-white"
      >
        <PageContainer>
          <div className="grid divide-y divide-slate-200 lg:grid-cols-3 lg:divide-x lg:divide-y-0">
            {trustRail.map((item, index) => {
              const Icon = item.icon;
              return (
                <RevealOnScroll
                  key={item.title}
                  delay={index * 70}
                  className="h-full"
                >
                  <article className="landing-trust-item">
                    <span className="landing-trust-icon">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <div>
                      <p className="landing-kicker">{item.eyebrow}</p>
                      <h2>{item.title}</h2>
                      <p>{item.description}</p>
                    </div>
                  </article>
                </RevealOnScroll>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section id="workflow" className="landing-section bg-[#f7f8fb]">
        <PageContainer>
          <RevealOnScroll>
            <div className="grid gap-8 lg:grid-cols-[0.72fr_1.28fr] lg:gap-16">
              <div className="lg:sticky lg:top-28 lg:self-start">
                <SectionHeading
                  eyebrow="The released customer workflow"
                  title="A CRM should make responsibility visible—not add another place to update."
                  description="The interface is organised around the business journey, the person responsible and the control that protects the next decision."
                />
                <Link
                  href="/product"
                  className="landing-text-link mt-6 inline-flex"
                >
                  See the current product scope
                  <ArrowRight aria-hidden="true" className="h-4 w-4" />
                </Link>
              </div>

              <ol className="landing-workflow-list">
                {workflowSteps.map((step, index) => {
                  const Icon = step.icon;
                  return (
                    <RevealOnScroll
                      key={step.number}
                      delay={index * 55}
                      className="h-full"
                    >
                      <li className="landing-workflow-step">
                        <div className="landing-workflow-step__topline">
                          <span>{step.number}</span>
                          <Icon aria-hidden="true" className="h-5 w-5" />
                        </div>
                        <h3>{step.title}</h3>
                        <p>{step.description}</p>
                        <div className="landing-workflow-proof">
                          <CheckCircle2
                            aria-hidden="true"
                            className="h-4 w-4"
                          />
                          {step.proof}
                        </div>
                      </li>
                    </RevealOnScroll>
                  );
                })}
              </ol>
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>

      <section id="governance" className="landing-governance">
        <div className="landing-governance__grid" aria-hidden="true" />
        <PageContainer className="relative z-10">
          <RevealOnScroll>
            <div className="grid gap-8 lg:grid-cols-[0.8fr_1.2fr] lg:items-end lg:gap-16">
              <SectionHeading
                eyebrow="Governance is product behaviour"
                title="The controls are not a compliance paragraph below the product."
                description="They appear in the action path: who can see, who can change, who must approve and what evidence remains afterwards."
                tone="dark"
              />
              <div className="landing-governance__statement">
                <ShieldCheck aria-hidden="true" className="h-6 w-6" />
                <p>
                  Every released journey is evaluated across user permission,
                  operating context, auditability and failure behaviour.
                </p>
              </div>
            </div>
          </RevealOnScroll>

          <div className="mt-10 grid gap-px overflow-hidden rounded-3xl border border-white/10 bg-white/10 md:grid-cols-2 lg:mt-14 lg:grid-cols-4">
            {governanceCapabilities.map((capability, index) => {
              const Icon = capability.icon;
              return (
                <RevealOnScroll
                  key={capability.title}
                  delay={index * 60}
                  className="h-full"
                >
                  <article className="landing-governance-card">
                    <Icon aria-hidden="true" className="h-5 w-5" />
                    <h3>{capability.title}</h3>
                    <p>{capability.description}</p>
                  </article>
                </RevealOnScroll>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section id="released-crm" className="landing-section bg-white">
        <PageContainer>
          <RevealOnScroll>
            <div className="flex flex-col justify-between gap-6 lg:flex-row lg:items-end">
              <SectionHeading
                eyebrow="Released CRM capability"
                title="Enough depth to operate the customer lifecycle—not a gallery of disconnected screens."
                description="Each capability is connected to the same records, permissions, operating context and audit model."
              />
              <div className="landing-release-note">
                <CircleDot aria-hidden="true" className="h-4 w-4" />
                Released early-access scope
              </div>
            </div>
          </RevealOnScroll>

          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-3 lg:gap-5">
            {crmCapabilities.map((capability, index) => {
              const Icon = capability.icon;
              return (
                <RevealOnScroll
                  key={capability.title}
                  delay={(index % 3) * 65}
                  className="h-full"
                >
                  <article className="landing-capability-card">
                    <span className="landing-capability-card__icon">
                      <Icon aria-hidden="true" className="h-5 w-5" />
                    </span>
                    <h3>{capability.title}</h3>
                    <p>{capability.description}</p>
                    <span className="landing-capability-card__status">
                      <Check aria-hidden="true" className="h-3.5 w-3.5" />
                      Released
                    </span>
                  </article>
                </RevealOnScroll>
              );
            })}
          </div>
        </PageContainer>
      </section>

      <section
        id="modules"
        className="landing-section border-y border-slate-200 bg-[#f7f8fb]"
      >
        <PageContainer>
          <RevealOnScroll>
            <div className="grid gap-8 lg:grid-cols-[0.75fr_1.25fr] lg:items-end lg:gap-16">
              <SectionHeading
                eyebrow="Roadmap with visible boundaries"
                title="Eleven modules are planned next. None are dressed up as finished product."
                description="The shared architecture is designed for expansion, but every module becomes released only after its records, permissions, workflows, tests and complete business journey are verified."
              />
              <div className="landing-roadmap-rule">
                <Layers3 aria-hidden="true" className="h-5 w-5" />
                <p>
                  Build depth before breadth: one released module, eleven
                  roadmap modules, one shared platform foundation.
                </p>
              </div>
            </div>
          </RevealOnScroll>

          <div className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {roadmapModules.map((module, index) => (
              <RevealOnScroll
                key={module.slug}
                delay={(index % 4) * 45}
                className="h-full"
              >
                <Link
                  href={`/modules/${module.slug}`}
                  className="landing-roadmap-card"
                >
                  <div className="flex items-center justify-between gap-3">
                    <span className="landing-roadmap-card__number">
                      {String(index + 2).padStart(2, "0")}
                    </span>
                    <span className="landing-roadmap-card__badge">Roadmap</span>
                  </div>
                  <h3>{module.name}</h3>
                  <p>{module.summary}</p>
                  <span className="landing-roadmap-card__link">
                    Review planned scope
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </span>
                </Link>
              </RevealOnScroll>
            ))}
          </div>
        </PageContainer>
      </section>

      <section id="implementation" className="landing-section bg-white">
        <PageContainer>
          <RevealOnScroll>
            <SectionHeading
              eyebrow="Implementation discipline"
              title="Start with evidence, not a catalogue of configuration options."
              description="The rollout sequence keeps one business outcome, its users and its control boundaries visible from discovery through acceptance."
              align="center"
            />
          </RevealOnScroll>

          <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {implementationStages.map((stage, index) => (
              <RevealOnScroll
                key={stage.number}
                delay={index * 60}
                className="h-full"
              >
                <li className="landing-implementation-card">
                  <span>{stage.number}</span>
                  <h3>{stage.title}</h3>
                  <p>{stage.description}</p>
                </li>
              </RevealOnScroll>
            ))}
          </ol>

          <RevealOnScroll delay={120}>
            <div className="landing-design-partner mt-10">
              <div>
                <p className="landing-kicker">Design-partner conversations</p>
                <h3>Bring one operating problem worth solving properly.</h3>
                <p>
                  We will map the real users, data, handoffs, controls and
                  success evidence before discussing a broader rollout.
                </p>
              </div>
              <Link href="/contact" className="button-primary shrink-0 px-6">
                Discuss your workflow
                <ArrowRight aria-hidden="true" className="h-4 w-4" />
              </Link>
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>

      <section
        id="faq"
        className="landing-section border-y border-slate-200 bg-[#f7f8fb]"
      >
        <PageContainer width="narrow">
          <RevealOnScroll>
            <SectionHeading
              eyebrow="Release questions"
              title="Clear answers before a product conversation."
              description="The current release and the roadmap should remain easy to distinguish at every decision point."
              align="center"
            />
          </RevealOnScroll>

          <RevealOnScroll delay={80}>
            <div className="landing-faq mt-9">
              {faqs.map((faq, index) => (
                <details key={faq.question} open={index === 0}>
                  <summary>
                    <span>{faq.question}</span>
                    <span aria-hidden="true" className="landing-faq__icon">
                      +
                    </span>
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>

      <section className="bg-white py-12 sm:py-20">
        <PageContainer>
          <RevealOnScroll>
            <div className="landing-final-cta">
              <div className="landing-final-cta__grid" aria-hidden="true" />
              <div className="relative z-10 mx-auto max-w-3xl text-center">
                <div className="landing-final-cta__mark" aria-hidden="true">
                  V
                </div>
                <p className="landing-kicker text-teal-300">
                  VercentLabs ERP · released CRM early access
                </p>
                <h2>Show us the handoff your current tools keep losing.</h2>
                <p>
                  We will use one real workflow to demonstrate the released CRM,
                  its control foundation and the boundary between current
                  product and roadmap scope.
                </p>
                <div className="mt-7 flex flex-col justify-center gap-3 sm:flex-row">
                  <Link
                    href="/contact"
                    className="button-primary min-h-[50px] px-6"
                  >
                    Book a personalised demo
                    <ArrowRight aria-hidden="true" className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/modules"
                    className="landing-dark-secondary min-h-[50px] px-6"
                  >
                    Review the roadmap
                  </Link>
                </div>
              </div>
            </div>
          </RevealOnScroll>
        </PageContainer>
      </section>
    </>
  );
}
