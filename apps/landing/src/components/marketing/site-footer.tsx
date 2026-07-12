import Link from "next/link";

import BrandLogo from "@/components/ui/brand-logo";
import { landingConfig } from "@/lib/landing-config";

const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Modules", href: "/modules" },
      { label: "How it works", href: "/how-it-works" },
      { label: "API developers", href: "/api-developers" },
      { label: "Security", href: "/security" },
      { label: "Engagement", href: "/pricing" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Industries", href: "/industries" },
      { label: "Comparison", href: "/comparison" },
      { label: "Design partners", href: "/customers" },
      { label: "Partners", href: "/partner" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      { label: "Careers", href: "/careers" },
      { label: "Changelog", href: "/changelog" },
      { label: "Status", href: "/status" },
      { label: "Contact", href: "/contact" },
    ],
  },
  {
    title: "Resources",
    links: [
      { label: "Help", href: "/help" },
      { label: "Early access", href: "/signup" },
      { label: "Sign in", href: "/login" },
      { label: "Privacy", href: "/privacy" },
      { label: "Terms", href: "/terms" },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 pb-24 pt-14 text-slate-600 md:pb-8">
      <div className="mx-auto grid w-full max-w-[1440px] gap-10 px-5 sm:px-8 lg:grid-cols-[1fr_2fr] lg:px-12">
        <div>
          <BrandLogo variant="text" className="h-8 w-auto" />

          <p className="mt-4 max-w-sm text-sm leading-7 text-slate-500">
            A connected ERP platform for finance, supply chain, manufacturing,
            people, projects and enterprise reporting.
          </p>

          <Link
            href="/contact"
            className="mt-4 inline-flex text-sm font-bold text-indigo-600 transition hover:text-indigo-800"
          >
            Talk to VercentLabs
          </Link>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-900">
                {group.title}
              </h2>

              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    <Link
                      href={link.href}
                      className="text-sm text-slate-500 transition hover:text-indigo-600"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-10 flex w-full max-w-[1440px] flex-col gap-2 border-t border-slate-200 px-5 pt-5 text-xs text-slate-400 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
        <p>
          © {new Date().getFullYear()} {landingConfig.companyName}. All rights
          reserved.
        </p>

        <p>Vercent ERP is under active product development.</p>
      </div>
    </footer>
  );
}
