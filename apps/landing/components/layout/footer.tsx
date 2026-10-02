import Link from "next/link";
import {
  LANDING_MODULES,
  LANDING_INDUSTRIES,
  CTAS,
  COMPANY_IDENTITY,
  POSITIONING,
  PRIMARY_NAV,
  SIGN_IN_LABEL,
  getRoutedWorkflows,
} from "@vercentlabs/landing-content";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { APP_URL } from "@/lib/site";

const PRODUCT_LINKS = PRIMARY_NAV.find((item) => item.label === "Product")?.children ?? [];

const MODULE_LINKS = LANDING_MODULES.map((moduleInfo) => ({ label: moduleInfo.displayName, href: `/modules/${moduleInfo.key}` }));

const WORKFLOW_LINKS = [
  ...getRoutedWorkflows().map((workflow) => ({ label: workflow.name, href: `/workflows/${workflow.slug}` })),
  { label: "All workflows", href: "/workflows" },
];

const RESOURCE_LINKS = [
  { label: "ERP Buying Guide", href: "/resources/erp-buying-guide" },
  { label: "Requirements Checklist", href: "/resources/erp-requirements-checklist" },
  { label: "Glossary", href: "/resources/glossary" },
  { label: "Compare Vercentlabs", href: "/compare" },
  { label: "All resources", href: "/resources" },
];

// Industries and solutions are use-case entry points, not the brand — they
// live here rather than in the header.
const USE_CASE_LINKS = [
  ...LANDING_INDUSTRIES.map((industry) => ({ label: industry.name, href: `/industries/${industry.slug}` })),
  { label: "All industries", href: "/industries" },
  { label: "Solutions", href: "/solutions" },
];

const CONTACT_LINKS = [
  { label: "Sales", email: COMPANY_IDENTITY.salesContactEmail },
  { label: "Support", email: COMPANY_IDENTITY.supportContactEmail },
  { label: "Careers", email: COMPANY_IDENTITY.careersContactEmail },
  { label: "Billing", email: COMPANY_IDENTITY.billingContactEmail },
  { label: "Security", email: COMPANY_IDENTITY.securityContactEmail },
  { label: "Privacy", email: COMPANY_IDENTITY.privacyContactEmail },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="vl-night-grid border-t border-white/15 bg-(--color-bg-inverse) text-white">
      <Container className="py-14 sm:py-16">
        <div className="mb-12 grid grid-cols-1 items-end gap-8 border-b border-white/15 pb-10 lg:grid-cols-[1fr_auto]">
          <div>
            <Logo inverse />
            <p className="mt-5 max-w-[52ch] text-sm leading-[1.75] text-white/58">{POSITIONING.descriptor}</p>
          </div>
          <ButtonLink href={CTAS.primary.href} size="sm" variant="inverse">{CTAS.primary.label}</ButtonLink>
        </div>

        <div className="grid grid-cols-2 border-l border-t border-white/15 sm:grid-cols-3 lg:grid-cols-6">
          <FooterColumn title="Product" index="01" links={PRODUCT_LINKS} />
          <FooterColumn title="Modules" index="02" links={MODULE_LINKS} />
          <FooterColumn title="Workflows" index="03" links={WORKFLOW_LINKS} />
          <FooterColumn title="Resources" index="04" links={RESOURCE_LINKS} />
          <FooterColumn title="Use cases" index="05" links={USE_CASE_LINKS} />
          <div className="border-b border-r border-white/15 p-5">
            <div className="flex items-center justify-between"><p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-white/45">Account</p><span className="vl-index text-white/35">06</span></div>
            <Link href={APP_URL.toString()} className="mt-5 block text-sm font-semibold text-white/75 hover:text-white">{SIGN_IN_LABEL} →</Link>
            <Link href={CTAS.talkToSpecialist.href} prefetch={false} className="mt-3 block text-sm text-white/68 hover:text-white">{CTAS.talkToSpecialist.label}</Link>
          </div>
        </div>

        <nav aria-label="Contact Vercentlabs" className="mt-6 flex flex-wrap gap-x-6 gap-y-3 border-b border-white/15 pb-8">
          {CONTACT_LINKS.map((contact) => (
            <a key={contact.email} href={`mailto:${contact.email}`} className="text-xs text-white/58 transition-colors hover:text-white">
              {contact.label}: {contact.email}
            </a>
          ))}
        </nav>

        <div className="mt-8 flex flex-col gap-4 text-xs text-white/45 sm:flex-row sm:items-center sm:justify-between">
          <p>© {year} Vercentlabs. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
            <Link href="/privacy" prefetch={false} className="hover:text-white">Privacy Policy</Link>
            <Link href="/terms" prefetch={false} className="hover:text-white">Terms of Use</Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}

function FooterColumn({ title, index, links }: { title: string; index: string; links: readonly { label: string; href: string }[] }) {
  return (
    <div className="border-b border-r border-white/15 p-5">
      <div className="flex items-center justify-between gap-3">
        <p className="text-[0.65rem] font-bold uppercase tracking-[0.14em] text-white/45">{title}</p>
        <span className="vl-index text-white/35">{index}</span>
      </div>
      <ul className="mt-5 flex flex-col gap-3">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} prefetch={false} className="text-sm text-white/68 transition-colors hover:text-white">{link.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
