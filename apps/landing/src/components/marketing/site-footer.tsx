import Link from "next/link";

import BrandLogo from "@/components/ui/brand-logo";
import { siteConfig } from "@/lib/site-config";

const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Product overview", href: "/product" },
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
    <footer className="border-t border-slate-800 bg-slate-950 px-0 py-9 text-slate-300 sm:py-16">
      <div className="mx-auto grid w-full max-w-7xl gap-8 px-4 sm:gap-10 sm:px-6 lg:grid-cols-[1.1fr_1.9fr] lg:px-8">
        <div>
          <Link
            href="/"
            aria-label="VercentLabs home"
            className="inline-flex rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white"
          >
            <BrandLogo
              variant="footer"
              className="h-7 w-auto sm:h-9"
              priority={false}
            />
          </Link>

          <p className="mt-4 max-w-sm text-xs leading-6 text-slate-400 sm:mt-5 sm:text-sm sm:leading-7">
            VercentLabs ERP connects twelve operational modules through shared
            data, workflows, permissions, audit history and reporting.
          </p>

          <Link
            href="/contact"
            className="mt-5 inline-flex min-h-11 items-center justify-center rounded-full bg-indigo-500 px-4 text-xs font-extrabold text-white transition hover:bg-indigo-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:mt-6 sm:px-5 sm:text-sm"
          >
            Book a personalised demo
          </Link>

          <a
            href={"mailto:" + siteConfig.email}
            className="mt-3 block w-fit text-xs font-semibold text-slate-400 underline decoration-slate-600 underline-offset-4 hover:text-white sm:mt-4 sm:text-sm"
          >
            {siteConfig.email}
          </a>
        </div>

        <nav
          aria-label="Footer navigation"
          className="grid grid-cols-2 gap-x-4 gap-y-7 sm:grid-cols-4 sm:gap-x-5 sm:gap-y-9"
        >
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-[10px] font-extrabold uppercase tracking-[0.13em] text-white sm:text-xs sm:tracking-[0.15em]">
                {group.title}
              </h2>
              <ul className="mt-3 space-y-2 sm:mt-4 sm:space-y-3">
                {group.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="inline-flex min-h-7 items-center text-xs text-slate-400 transition hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white sm:min-h-8 sm:text-sm"
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

      <div className="mx-auto mt-8 flex w-full max-w-7xl flex-col gap-2 border-t border-slate-800 px-4 pt-5 text-[10px] text-slate-500 sm:mt-10 sm:gap-3 sm:px-6 sm:pt-6 sm:text-xs md:flex-row md:items-center md:justify-between lg:px-8">
        <p>
          © {new Date().getFullYear()} {siteConfig.companyName}. All rights
          reserved.
        </p>
        <p>12 modules. One connected ERP.</p>
      </div>
    </footer>
  );
}
