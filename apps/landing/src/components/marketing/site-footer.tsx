import Link from "next/link";

import BrandLogo from "@/components/ui/brand-logo";
import { siteConfig } from "@/lib/site-config";

const footerGroups = [
  {
    title: "Product",
    links: [
      { label: "Features", href: "/features" },
      { label: "Modules", href: "/modules" },
      { label: "How it works", href: "/how-it-works" },
      { label: "Security", href: "/security" },
      { label: "Engagement", href: "/pricing" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { label: "Industries", href: "/industries" },
      { label: "Comparison", href: "/comparison" },
      { label: "Partners", href: "/partner" },
    ],
  },
  {
    title: "Company",
    links: [
      { label: "About", href: "/about" },
      {
        label: "Contact",
        href: "mailto:" + siteConfig.email + "?subject=Vercent ERP discussion",
      },
    ],
  },
];

export default function SiteFooter() {
  return (
    <footer className="border-t border-slate-200 bg-slate-50 pb-24 pt-14 text-slate-600 md:pb-8">
      <div className="mx-auto grid w-full max-w-[1440px] gap-10 px-5 sm:px-8 lg:grid-cols-[1.15fr_1.85fr] lg:px-12">
        <div>
          <BrandLogo variant="text" className="h-8 w-auto" />

          <p className="mt-4 max-w-sm text-sm leading-7 text-slate-500">
            A connected ERP platform for finance, supply chain, manufacturing,
            people, projects and enterprise reporting.
          </p>

          <a
            href={"mailto:" + siteConfig.email}
            className="mt-4 inline-flex text-sm font-bold text-indigo-600 transition hover:text-indigo-800"
          >
            {siteConfig.email}
          </a>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:grid-cols-3">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-xs font-extrabold uppercase tracking-[0.14em] text-slate-900">
                {group.title}
              </h2>

              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("mailto:") ? (
                      <a
                        href={link.href}
                        className="text-sm text-slate-500 transition hover:text-indigo-600"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-slate-500 transition hover:text-indigo-600"
                      >
                        {link.label}
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="mx-auto mt-10 flex w-full max-w-[1440px] flex-col gap-2 border-t border-slate-200 px-5 pt-5 text-xs text-slate-400 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
        <p>
          © {new Date().getFullYear()} VercentLabs LLP. All rights reserved.
        </p>

        <p>Vercent ERP is under active product development.</p>
      </div>
    </footer>
  );
}
