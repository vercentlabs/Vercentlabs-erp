import { Container, Section } from "@/components/layout/container";
import { Breadcrumbs } from "@/components/layout/breadcrumbs";
import { Heading, Text } from "@/components/ui/text";
import { ButtonLink } from "@/components/ui/button";
import { CTAS } from "@vercentlabs/landing-content";
import { APP_URL } from "@/lib/site";
import { buildPageMetadata } from "@/lib/metadata";

export const metadata = buildPageMetadata({
  title: "Pricing",
  description: "Free for one user and one app. Standard is ₹699 per user a month, or ₹499 billed yearly, with every app. Custom terms for larger rollouts.",
  path: "/pricing",
});

// The plans as the product sells them (services/api/src/core/billing/catalogue.js): Free, Standard per user, Custom by contract.
// Prices are before GST; keep them in step with the catalogue when it changes.
const signUpHref = new URL("/register", APP_URL).toString();

const PLANS = [
  {
    name: "Free",
    price: "₹0",
    unit: "forever",
    note: "No card needed.",
    summary: "For trying Vercentlabs on one part of your business.",
    features: ["1 user", "1 app of your choice — CRM, Sales, Stock, Accounting…", "Upgrade any time; your data stays"],
    cta: { label: "Start free", href: signUpHref, variant: "secondary" as const },
  },
  {
    name: "Standard",
    price: "₹699",
    unit: "per user / month",
    note: "Or ₹499 per user a month billed yearly (₹5,988 per user a year).",
    summary: "Every app for the whole team. New companies get 30 days free.",
    features: ["Every app: CRM, Sales, Procurement, Stock, Manufacturing, Accounting, HR & Payroll and more", "Up to 500 users", "Roles and access for each person", "E-invoice, e-way bill and GST returns", "Email and WhatsApp from the records"],
    cta: { label: "Start 30-day trial", href: signUpHref, variant: "primary" as const },
    featured: true,
  },
  {
    name: "Custom",
    price: "Let's talk",
    unit: "",
    note: "Contracted terms.",
    summary: "For larger rollouts, several companies or special terms.",
    features: ["Everything in Standard", "Help moving your data in", "Implementation and training", "Terms agreed in a contract"],
    cta: { label: CTAS.primary.label, href: CTAS.primary.href, variant: "secondary" as const },
  },
];

const QUESTIONS = [
  ["Is GST included?", "Prices are before GST. 18% GST is added to each charge, and you get a GST tax invoice for it."],
  ["What happens after the 30-day trial?", "Choose Standard to keep every app, or move to Free and keep one app for one user. Nothing is deleted."],
  ["Can I change the number of users?", "Yes. Add or remove people whenever you need; you pay for the users you have."],
  ["Monthly or yearly?", "Monthly is ₹699 per user. Paying for the year brings it to ₹499 per user a month."],
];

export default function PricingPage() {
  return (
    <Section tone="page" paddingTop={{ base: 8, sm: 10 }} paddingBottom={{ base: 14, sm: 18 }}>
      <Container>
        <Breadcrumbs trail={[{ name: "Pricing", path: "/pricing" }]} />
        <div className="mt-8 border-t border-(--color-border-strong) pt-5">
          <Text variant="eyebrow">Pricing</Text>
          <Heading level="h1" className="mt-6 max-w-[16ch]">Simple per-user pricing. Every app included.</Heading>
          <Text variant="lead" className="mt-5 max-w-[60ch]">Start free with one app, or give the whole team every app on Standard. Prices are in rupees, before GST.</Text>
        </div>

        <div className="mt-12 grid grid-cols-1 gap-4 md:grid-cols-3 lg:gap-6">
          {PLANS.map((plan) => (
            <section key={plan.name} aria-labelledby={`plan-${plan.name}`}
              className={`flex flex-col border bg-(--color-bg-elevated) p-6 sm:p-7 ${plan.featured ? "border-(--color-border-brand) shadow-[0_10px_30px_rgba(23,24,23,.08)]" : "border-(--color-border-default)"}`}>
              <div className="flex items-center justify-between gap-3">
                <h2 id={`plan-${plan.name}`} className="text-lg font-semibold tracking-[-0.02em] text-(--color-text-primary)">{plan.name}</h2>
                {plan.featured ? <span className="bg-(--color-bg-brand) px-2 py-0.5 text-xs font-semibold text-white">Most teams</span> : null}
              </div>
              <p className="mt-2 text-sm text-(--color-text-secondary)">{plan.summary}</p>
              <p className="mt-6 flex items-baseline gap-2">
                <span className="text-[2.6rem] font-semibold leading-none tracking-[-0.05em] text-(--color-text-primary)">{plan.price}</span>
                {plan.unit ? <span className="text-sm text-(--color-text-secondary)">{plan.unit}</span> : null}
              </p>
              <p className="mt-2 min-h-10 text-xs text-(--color-text-secondary)">{plan.note}</p>
              <div className="mt-5">
                <ButtonLink href={plan.cta.href} variant={plan.cta.variant} className="w-full">{plan.cta.label}</ButtonLink>
              </div>
              <ul className="mt-6 flex flex-col border-t border-(--color-border-default)">
                {plan.features.map((feature) => (
                  <li key={feature} className="grid grid-cols-[1.25rem_1fr] gap-2 border-b border-(--color-border-default) py-3 text-sm text-(--color-text-primary)">
                    <span className="text-(--color-text-brand)" aria-hidden="true">✓</span>
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>

        <div className="mt-16 grid grid-cols-1 gap-8 border-t border-(--color-border-strong) pt-6 lg:grid-cols-[minmax(240px,.6fr)_minmax(0,1.4fr)] lg:gap-16">
          <Heading level="h3" as="h2">Questions about pricing</Heading>
          <dl className="flex flex-col border-t border-(--color-border-default)">
            {QUESTIONS.map(([question, answer]) => (
              <div key={question} className="border-b border-(--color-border-default) py-4">
                <dt className="text-sm font-semibold text-(--color-text-primary)">{question}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-(--color-text-secondary)">{answer}</dd>
              </div>
            ))}
          </dl>
        </div>
      </Container>
    </Section>
  );
}
