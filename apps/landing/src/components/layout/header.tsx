"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import BrandLogo from "@/components/ui/brand-logo";
import { navigationItems } from "@/content/navigation";
import { getSignInHref, siteConfig } from "@/lib/site-config";

import PageContainer from "./page-container";

function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== "/" && pathname.startsWith(href + "/"));
}

export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const signInHref = getSignInHref();
  const externalSignIn = Boolean(siteConfig.appUrl);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <header
      className={
        "sticky top-0 z-40 border-b transition " +
        (scrolled
          ? "border-slate-200 bg-white/95 shadow-sm backdrop-blur-xl"
          : "border-transparent bg-white/90 backdrop-blur")
      }
    >
      <PageContainer className="flex min-h-16 items-center justify-between gap-4 py-2.5">
        <Link href="/" aria-label="VercentLabs home" className="shrink-0">
          <BrandLogo variant="text" className="h-9 w-auto" priority />
        </Link>

        <nav
          aria-label="Primary navigation"
          className="hidden items-center gap-1 lg:flex"
        >
          {navigationItems.map((item) => {
            const active = isActivePath(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={() => setMenuOpen(false)}
                aria-current={active ? "page" : undefined}
                className={
                  "rounded-lg px-3 py-2 text-sm font-semibold transition " +
                  (active
                    ? "bg-indigo-50 text-indigo-700"
                    : "text-slate-600 hover:bg-slate-50 hover:text-slate-950")
                }
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 lg:flex">
          {externalSignIn ? (
            <a
              href={signInHref}
              target="_blank"
              rel="noreferrer"
              className="button-secondary"
            >
              Sign in
            </a>
          ) : (
            <Link href={signInHref} className="button-secondary">
              Sign in
            </Link>
          )}
          <Link href="/signup" className="button-primary">
            Apply for design partnership
          </Link>
        </div>

        <button
          type="button"
          aria-expanded={menuOpen}
          aria-controls="mobile-navigation"
          aria-label={menuOpen ? "Close navigation" : "Open navigation"}
          onClick={() => setMenuOpen((current) => !current)}
          className="flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 text-slate-700 lg:hidden"
        >
          <span aria-hidden="true" className="text-xl leading-none">
            {menuOpen ? "×" : "☰"}
          </span>
        </button>
      </PageContainer>

      {menuOpen ? (
        <div
          id="mobile-navigation"
          className="border-t border-slate-200 bg-white lg:hidden"
        >
          <PageContainer className="py-4">
            <nav aria-label="Mobile navigation" className="grid gap-1">
              {navigationItems.map((item) => {
                const active = isActivePath(pathname, item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setMenuOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={
                      "rounded-xl px-4 py-3 text-sm font-bold " +
                      (active
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-slate-700 hover:bg-slate-50")
                    }
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>

            <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
              {externalSignIn ? (
                <a
                  href={signInHref}
                  target="_blank"
                  rel="noreferrer"
                  className="button-secondary justify-center"
                >
                  Sign in
                </a>
              ) : (
                <Link
                  href={signInHref}
                  onClick={() => setMenuOpen(false)}
                  className="button-secondary justify-center"
                >
                  Sign in
                </Link>
              )}
              <Link
                href="/signup"
                onClick={() => setMenuOpen(false)}
                className="button-primary justify-center"
              >
                Apply for design partnership
              </Link>
            </div>
          </PageContainer>
        </div>
      ) : null}
    </header>
  );
}
