import Link from "next/link";
import { LANDING_MODULES, LANDING_INDUSTRIES, CTAS } from "@vercentlabs/landing-content";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { Container } from "@/components/layout/container";
import { APP_URL } from "@/lib/site";

/**
 * Only destinations approved in docs/landing-redesign/phase-1/information-architecture.md
 * appear here. No "#" placeholders, no invented social profiles, no certification
 * badges, no status link (none exists yet) — per the governing brief and the
 * Evidence and Honesty Rules.
 */
const PRODUCT_LINKS = [
  { label: "Platform", href: "/product/platform" },
  { label: "Automation", href: "/product/automation" },
  { label: "Analytics", href: "/product/analytics" },
  { label: "Mobile", href: "/product/mobile" },
  { label: "Security", href: "/security" },
  { label: "Integrations", href: "/product/integrations" },
];

const PLATFORM_LINKS = [
  { label: "Implementation", href: "/implementation" },
  { label: "Solutions", href: "/solutions" },
  { label: "Workflows", href: "/workflows" },
];

const RESOURCE_LINKS = [
  { label: "ERP Buying Guide", href: "/resources/erp-buying-guide" },
  { label: "Requirements Checklist", href: "/resources/erp-requirements-checklist" },
  { label: "Glossary", href: "/resources/glossary" },
  { label: "Compare Vercentlabs", href: "/compare" },
  { label: "All resources", href: "/resources" },
];

export function Footer() {
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-(--color-border-default) bg-(--color-bg-elevated)">
      <Container className="py-14">
        <div className="grid grid-cols-1 gap-10 sm:grid-cols-2 lg:grid-cols-7">
          <div className="sm:col-span-2 lg:col-span-2">
            <Logo />
            <p className="mt-4 max-w-[32ch] text-sm leading-relaxed text-(--color-text-secondary)">
              An operational ERP for growing, multi-location businesses — sales, inventory, procurement, production,
              and finance on one live system.
            </p>
            <ButtonLink href={CTAS.primary.href} size="sm" variant="secondary" className="mt-5">
              {CTAS.primary.label}
            </ButtonLink>
          </div>

          <FooterColumn title="Product" links={PRODUCT_LINKS} />

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-muted)">Modules</p>
            <ul className="mt-3 flex flex-col gap-2.5">
              {LANDING_MODULES.slice(0, 6).map((moduleInfo) => (
                <li key={moduleInfo.key}>
                  <Link href={`/modules/${moduleInfo.key}`} prefetch={false} className="text-sm text-(--color-text-secondary) hover:text-(--color-text-brand)">
                    {moduleInfo.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/modules" prefetch={false} className="text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4">
                  All modules
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-muted)">Industries</p>
            <ul className="mt-3 flex flex-col gap-2.5">
              {LANDING_INDUSTRIES.map((industry) => (
                <li key={industry.slug}>
                  <Link href={`/industries/${industry.slug}`} prefetch={false} className="text-sm text-(--color-text-secondary) hover:text-(--color-text-brand)">
                    {industry.name}
                  </Link>
                </li>
              ))}
              <li>
                <Link href="/industries" prefetch={false} className="text-sm font-medium text-(--color-text-brand) hover:underline underline-offset-4">
                  All industries
                </Link>
              </li>
            </ul>
          </div>

          <FooterColumn title="Platform" links={PLATFORM_LINKS} />
          <FooterColumn title="Resources" links={RESOURCE_LINKS} />
        </div>

        <div className="mt-12 flex flex-col gap-4 border-t border-(--color-border-default) pt-6 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-xs text-(--color-text-muted)">© {year} Vercentlabs. All rights reserved.</p>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
            {/* Privacy/Terms restored in Phase 8 now that real pages exist at
                /privacy and /terms (Phase 7 removed the old /legal/privacy
                and /legal/terms links, which pointed at pages that never
                existed — see docs/landing-redesign/phase-7/decision-log.md
                items 16-17 and docs/landing-redesign/phase-8/legal-readiness.md). */}
            <Link href="/privacy" prefetch={false} className="text-xs text-(--color-text-muted) hover:text-(--color-text-brand)">
              Privacy Policy
            </Link>
            <Link href="/terms" prefetch={false} className="text-xs text-(--color-text-muted) hover:text-(--color-text-brand)">
              Terms of Use
            </Link>
            <Link href={APP_URL.toString()} className="text-xs text-(--color-text-muted) hover:text-(--color-text-brand)">
              Sign in
            </Link>
          </div>
        </div>
      </Container>
    </footer>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.1em] text-(--color-text-muted)">{title}</p>
      <ul className="mt-3 flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link href={link.href} prefetch={false} className="text-sm text-(--color-text-secondary) hover:text-(--color-text-brand)">
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
