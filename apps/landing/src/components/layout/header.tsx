"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import BrandLogo from "@/components/ui/brand-logo";
import { siteConfig } from "@/lib/site-config";

import PageContainer from "./page-container";

const navigationLinks = [
  { label: "Product", href: "/product" },
  { label: "Modules", href: "/modules" },
  { label: "Industries", href: "/industries" },
  { label: "Pricing", href: "/pricing" },
  { label: "Compare", href: "/comparison" },
  { label: "Security", href: "/security" },
];

export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) {
      return undefined;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setMenuOpen(false);
        menuButtonRef.current?.focus();
      }
    }

    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [menuOpen]);

  function isActive(href: string) {
    if (href.startsWith("/#")) {
      return pathname === "/";
    }

    return pathname === href || pathname.startsWith(href + "/");
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header className="sticky top-0 z-50 border-b border-slate-200/80 bg-white/95 backdrop-blur-xl">
      <PageContainer>
        <div className="flex min-h-14 items-center justify-between gap-3 sm:min-h-[72px] sm:gap-4">
          <Link
            href="/"
            aria-label="VercentLabs home"
            className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-4"
            onClick={closeMenu}
          >
            <BrandLogo className="h-6 w-auto sm:h-9" priority />
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-1 xl:flex"
          >
            {navigationLinks.map((item) => {
              const active = isActive(item.href);

              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={
                    "flex min-h-11 items-center rounded-full px-3.5 text-sm font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 " +
                    (active
                      ? "bg-indigo-50 text-indigo-700"
                      : "text-slate-600 hover:bg-slate-100 hover:text-slate-950")
                  }
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 xl:flex">
            <a
              href={siteConfig.appUrl}
              className="flex min-h-11 items-center rounded-full px-4 text-sm font-bold text-slate-600 transition hover:bg-slate-100 hover:text-slate-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              Sign in
            </a>

            <Link
              href="/contact"
              className="button-primary min-h-11 whitespace-nowrap px-5"
            >
              Book a demo
            </Link>
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            aria-expanded={menuOpen}
            aria-controls="mobile-navigation"
            aria-label={
              menuOpen ? "Close navigation menu" : "Open navigation menu"
            }
            onClick={() => setMenuOpen((current) => !current)}
            className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-800 shadow-sm transition hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 xl:hidden"
          >
            <span className="sr-only">
              {menuOpen ? "Close navigation menu" : "Open navigation menu"}
            </span>
            <span aria-hidden="true" className="relative h-4 w-5">
              <span
                className={
                  "absolute left-0 top-0 h-0.5 w-5 rounded bg-current transition " +
                  (menuOpen ? "translate-y-[7px] rotate-45" : "")
                }
              />
              <span
                className={
                  "absolute left-0 top-[7px] h-0.5 w-5 rounded bg-current transition " +
                  (menuOpen ? "opacity-0" : "")
                }
              />
              <span
                className={
                  "absolute left-0 top-[14px] h-0.5 w-5 rounded bg-current transition " +
                  (menuOpen ? "-translate-y-[7px] -rotate-45" : "")
                }
              />
            </span>
          </button>
        </div>
      </PageContainer>

      {menuOpen ? (
        <>
          <button
            type="button"
            aria-label="Close navigation menu"
            onClick={closeMenu}
            className="fixed inset-0 top-14 z-[-1] bg-slate-950/30 backdrop-blur-[2px] sm:top-[72px] xl:hidden"
          />

          <div
            id="mobile-navigation"
            className="absolute inset-x-0 top-full max-h-[calc(100vh-56px)] overflow-y-auto border-b border-slate-200 bg-white shadow-2xl sm:max-h-[calc(100vh-72px)] xl:hidden"
          >
            <PageContainer className="py-3 sm:py-4">
              <nav aria-label="Mobile navigation" className="grid gap-1">
                {navigationLinks.map((item) => {
                  const active = isActive(item.href);

                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={closeMenu}
                      aria-current={active ? "page" : undefined}
                      className={
                        "flex min-h-11 items-center justify-between rounded-lg px-3 text-xs font-bold transition sm:min-h-[52px] sm:rounded-xl sm:px-4 sm:text-sm " +
                        (active
                          ? "bg-indigo-50 text-indigo-700"
                          : "text-slate-700 hover:bg-slate-100")
                      }
                    >
                      {item.label}
                      <span aria-hidden="true">→</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-3 grid gap-2 border-t border-slate-200 pt-3 sm:mt-4 sm:grid-cols-2 sm:pt-4">
                <a
                  href={siteConfig.appUrl}
                  onClick={closeMenu}
                  className="button-secondary min-h-11 w-full sm:min-h-[52px]"
                >
                  Sign in
                </a>
                <Link
                  href="/contact"
                  onClick={closeMenu}
                  className="button-primary min-h-11 w-full sm:min-h-[52px]"
                >
                  Book a demo
                </Link>
              </div>
            </PageContainer>
          </div>
        </>
      ) : null}
    </header>
  );
}
