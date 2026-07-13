import Link from "next/link";

import BrandLogo from "@/components/ui/brand-logo";
import { landingConfig } from "@/lib/landing-config";

const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "12 modules", href: "/modules" },
      { label: "How it works", href: "/how-it-works" },
      { label: "Pricing", href: "/pricing" },
      { label: "Compare", href: "/comparison" },
      { label: "Security", href: "/security" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Industries", href: "/industries" },
      { label: "Manufacturing", href: "/industries/manufacturing" },
      { label: "Distribution", href: "/industries/distribution" },
      { label: "Retail", href: "/industries/retail" },
      {
        label: "Professional services",
        href: "/industries/professional-services",
      },
      { label: "Multi-company", href: "/industries/multi-company" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "API developers", href: "/api-developers" },
      { label: "Implementation", href: "/how-it-works" },
      { label: "Help", href: "/help" },
      { label: "Partners", href: "/partner" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Changelog", href: "/changelog" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-800 bg-slate-950 px-0 py-12 text-slate-300 sm:py-16">
      <div className="mx-auto grid w-full max-w-7xl gap-10 px-4 sm:px-6 lg:grid-cols-[1.1fr_1.9fr] lg:px-8">
        <div>
          <Link
            href="/"
            aria-label="VercentLabs home"
            className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <BrandLogo
              variant="text"
              className="h-9 w-auto brightness-0 invert"
              priority={false}
            />
          </Link>

          <p className="mt-5 max-w-sm text-sm leading-7 text-slate-400">
            Vercent ERP connects twelve operational modules through shared data,
            workflows, permissions, audit history and reporting.
          </p>

          <Link
            href="/contact"
            className="mt-6 inline-flex min-h-11 items-center justify-center rounded-full bg-indigo-500 px-5 text-sm font-extrabold text-white transition hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            Book a personalised demo
          </Link>

          <a
            href={"mailto:" + landingConfig.contactEmail}
            className="mt-4 block w-fit text-sm font-semibold text-slate-400 underline decoration-slate-600 underline-offset-4 hover:text-white"
          >
            {landingConfig.contactEmail}
          </a>
        </div>

        <nav
          aria-label="Footer navigation"
          className="grid grid-cols-2 gap-x-5 gap-y-9 sm:grid-cols-4"
        >
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-extrabold uppercase tracking-[0.15em] text-white">
                {group.title}
              </h2>
              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-8 items-center text-sm text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </nav>
      </div>

      <div className="mx-auto mt-10 flex w-full max-w-7xl flex-col gap-3 border-t border-slate-800 px-4 pt-6 text-xs text-slate-500 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
        <p>
          © {new Date().getFullYear()} {landingConfig.companyName}. All rights
          reserved.
        </p>
        <p>12 modules. One connected ERP.</p>
      </div>
    </footer>
  );
}
