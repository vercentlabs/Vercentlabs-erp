"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import BrandLogo from "@/components/ui/brand-logo";
import { navigationItems } from "@/content/navigation";
import { siteConfig } from "@/lib/site-config";

import PageContainer from "./page-container";

export default function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  function closeMobileMenu() {
    setMobileMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/90 backdrop-blur-xl">
      <PageContainer>
        <div className="flex min-h-[72px] items-center justify-between gap-6">
          <BrandLogo />

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-1 lg:flex"
          >
            {navigationItems.map((item) => (
              <Link
                key={item.label}
                href={item.href}
                className="rounded-full px-3.5 py-2 text-sm font-semibold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="hidden items-center gap-3 lg:flex">
            <a
              href={siteConfig.appUrl}
              className="rounded-full px-4 py-2 text-sm font-bold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
            >
              Sign in
            </a>

            <a
              href={`mailto:${siteConfig.email}?subject=Vercent ERP product discussion`}
              className="rounded-full bg-slate-950 px-5 py-2.5 text-sm font-extrabold text-white transition hover:bg-indigo-600"
            >
              Talk to us
            </a>
          </div>

          <button
            type="button"
            aria-expanded={mobileMenuOpen}
            aria-controls="mobile-navigation"
            aria-label={
              mobileMenuOpen ? "Close navigation menu" : "Open navigation menu"
            }
            onClick={() => {
              setMobileMenuOpen((current) => !current);
            }}
            className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-700 transition hover:bg-slate-100 lg:hidden"
          >
            {mobileMenuOpen ? (
              <X aria-hidden="true" className="h-5 w-5" />
            ) : (
              <Menu aria-hidden="true" className="h-5 w-5" />
            )}
          </button>
        </div>

        {mobileMenuOpen ? (
          <nav
            id="mobile-navigation"
            aria-label="Mobile navigation"
            className="border-t border-slate-200 py-4 lg:hidden"
          >
            <div className="flex flex-col gap-1">
              {navigationItems.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={closeMobileMenu}
                  className="rounded-xl px-3 py-3 text-sm font-bold text-slate-700 transition hover:bg-slate-100 hover:text-slate-950"
                >
                  {item.label}
                </Link>
              ))}

              <div className="mt-3 grid gap-2 border-t border-slate-200 pt-4">
                <a
                  href={siteConfig.appUrl}
                  className="rounded-xl border border-slate-200 px-4 py-3 text-center text-sm font-bold text-slate-800"
                >
                  Sign in
                </a>

                <a
                  href={`mailto:${siteConfig.email}?subject=Vercent ERP product discussion`}
                  className="rounded-xl bg-slate-950 px-4 py-3 text-center text-sm font-extrabold text-white"
                >
                  Talk to VercentLabs
                </a>
              </div>
            </div>
          </nav>
        ) : null}
      </PageContainer>
    </header>
  );
}
