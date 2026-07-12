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
    <footer className="border-t border-slate-800 bg-slate-950 pb-24 pt-16 text-slate-300 md:pb-10">
      <div className="mx-auto grid w-full max-w-[1440px] gap-12 px-5 sm:px-8 lg:grid-cols-[1.2fr_2fr] lg:px-12">
        <div>
          <div className="brightness-0 invert">
            <BrandLogo variant="text" />
          </div>

          <p className="mt-5 max-w-md text-sm leading-7 text-slate-400">
            VercentLabs is building an enterprise ERP platform that connects
            operational and financial workflows through one governed system.
          </p>

          <a
            href={"mailto:" + siteConfig.email}
            className="mt-5 inline-flex text-sm font-bold text-indigo-300 hover:text-white"
          >
            {siteConfig.email}
          </a>
        </div>

        <div className="grid gap-8 sm:grid-cols-3">
          {footerGroups.map((group) => (
            <div key={group.title}>
              <h2 className="text-sm font-extrabold text-white">
                {group.title}
              </h2>

              <ul className="mt-4 space-y-3">
                {group.links.map((link) => (
                  <li key={link.label}>
                    {link.href.startsWith("mailto:") ? (
                      <a
                        href={link.href}
                        className="text-sm text-slate-400 transition hover:text-white"
                      >
                        {link.label}
                      </a>
                    ) : (
                      <Link
                        href={link.href}
                        className="text-sm text-slate-400 transition hover:text-white"
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

      <div className="mx-auto mt-12 flex w-full max-w-[1440px] flex-col gap-3 border-t border-slate-800 px-5 pt-6 text-xs text-slate-500 sm:px-8 md:flex-row md:items-center md:justify-between lg:px-12">
        <p>
          © {new Date().getFullYear()} VercentLabs LLP. All rights reserved.
        </p>

        <p>Enterprise ERP platform under active development.</p>
      </div>
    </footer>
  );
}
