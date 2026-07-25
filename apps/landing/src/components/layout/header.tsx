"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import BrandLogo from "@/components/ui/brand-logo";
import { getSignInHref } from "@/lib/site-config";

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
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let frame = 0;

    const updateScrollState = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const scrollTop = window.scrollY;
        const scrollable = Math.max(
          document.documentElement.scrollHeight - window.innerHeight,
          1,
        );
        setScrolled(scrollTop > 18);
        setProgress(Math.min(100, (scrollTop / scrollable) * 100));
      });
    };

    updateScrollState();
    window.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, []);

  useEffect(() => {
    if (!menuOpen) return undefined;

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
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <header
      data-scrolled={scrolled ? "true" : "false"}
      className="landing-header"
    >
      <span
        aria-hidden="true"
        className="landing-header__progress"
        style={{ transform: `scaleX(${progress / 100})` }}
      />

      <PageContainer>
        <div className="landing-header__inner">
          <Link
            href="/"
            aria-label="VercentLabs home"
            className="shrink-0 rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-4"
            onClick={closeMenu}
          >
            <BrandLogo className="h-6 w-auto sm:h-8" priority />
          </Link>

          <nav
            aria-label="Primary navigation"
            className="hidden items-center gap-0.5 xl:flex"
          >
            {navigationLinks.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? "page" : undefined}
                  className={"landing-nav-link " + (active ? "is-active" : "")}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          <div className="hidden items-center gap-2 xl:flex">
            <a href={getSignInHref()} className="landing-sign-in">
              Sign in
            </a>
            <Link href="/contact" className="button-primary min-h-11 px-5">
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
            className="landing-menu-button xl:hidden"
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
            className="fixed inset-0 top-14 z-[-1] bg-slate-950/35 backdrop-blur-[2px] sm:top-[68px] xl:hidden"
          />

          <div id="mobile-navigation" className="landing-mobile-navigation">
            <PageContainer className="py-4">
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
                        "landing-mobile-nav-link " + (active ? "is-active" : "")
                      }
                    >
                      {item.label}
                      <span aria-hidden="true">→</span>
                    </Link>
                  );
                })}
              </nav>

              <div className="mt-4 grid gap-2 border-t border-slate-200 pt-4 sm:grid-cols-2">
                <a
                  href={getSignInHref()}
                  onClick={closeMenu}
                  className="button-secondary min-h-[50px] w-full"
                >
                  Sign in
                </a>
                <Link
                  href="/contact"
                  onClick={closeMenu}
                  className="button-primary min-h-[50px] w-full"
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
