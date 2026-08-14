
"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { PRIMARY_NAV, CTAS } from "@vercentlabs/landing-content";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { NavMenu } from "@/components/navigation/nav-menu";
import { ModuleMegaMenuContent } from "@/components/navigation/module-mega-menu";
import { ProductMegaMenuContent } from "@/components/navigation/product-mega-menu";
import { MobileNav } from "@/components/navigation/mobile-nav";
import { APP_URL } from "@/lib/site";
import { cx } from "@/lib/utils";

const simpleLinks = PRIMARY_NAV.filter((item) => item.label !== "Product" && item.label !== "Modules");

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const mobileMenuButtonRef = useRef<HTMLButtonElement>(null);
  const closeMobileNav = useCallback(() => {
    setMobileOpen(false);
    requestAnimationFrame(() => mobileMenuButtonRef.current?.focus());
  }, []);

  // Scroll-elevation via an IntersectionObserver watching a 1px sentinel
  // (app/layout.tsx, immediately before <Header/>) — the observer idiom
  // already established by components/analytics/track-view.tsx, not a raw
  // scroll listener (table-of-contents.tsx explicitly rejects that approach).
  useEffect(() => {
    const sentinel = document.querySelector("[data-header-sentinel]");
    if (!sentinel || typeof IntersectionObserver === "undefined") return;
    const observer = new IntersectionObserver(([entry]) => setScrolled(!entry.isIntersecting), { threshold: 0 });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  // No backdrop-filter here (e.g. backdrop-blur/backdrop-saturate): Control
  // Surface explicitly rejects glass/blur effects, and a backdrop-filter on an
  // ancestor also creates a new CSS containing block — which broke MobileNav's
  // `fixed inset-0` positioning (it collapsed to the header's own 64px height
  // instead of the viewport). Solid background only — scroll state adds a
  // shadow, never opacity/blur.
  return (
    <header
      className={cx(
        "sticky top-0 z-50 border-b border-(--color-border-default) bg-(--color-bg-page) transition-[box-shadow,background-color] duration-(--duration-base) ease-(--ease-standard)",
        scrolled ? "shadow-[0_6px_24px_rgba(23,24,23,.07)]" : "shadow-none",
      )}
    >
      <div className="mx-auto flex h-[72px] max-w-[1480px] items-center justify-between px-5 sm:px-7 lg:px-12 xl:px-14">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-0 lg:flex">
          <NavMenu label="Product" panelClassName="h-[70vh] overflow-hidden">
            <ProductMegaMenuContent />
          </NavMenu>

          <NavMenu label="Modules" panelClassName="h-[70vh] overflow-hidden">
            <ModuleMegaMenuContent />
          </NavMenu>

          {simpleLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className="border-b border-transparent px-3 py-2 text-sm font-semibold text-(--color-text-primary) transition-colors hover:border-(--color-text-primary)"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={APP_URL.toString()}
            className="hidden px-2 py-2 text-sm font-semibold text-(--color-text-secondary) hover:text-(--color-text-brand) sm:inline-flex"
          >
            Sign in
          </Link>
          {/*
            Visibility toggled on this wrapper, not via a className passed
            into ButtonLink: ButtonLink's own base classes always include an
            unprefixed `inline-flex`, which is equal-specificity with a plain
            `hidden` override — whichever rule Tailwind happens to emit later
            in the stylesheet wins, independent of class order in the HTML.
            That silently kept this button visible below 480px, overlapping
            the wordmark. A visibility toggle on a plain wrapper div has no
            competing base `display` utility to fight with.
          */}
          <div className="hidden sm:block">
            <ButtonLink href={CTAS.primary.href} size="sm">
              Book a Demo
            </ButtonLink>
          </div>

          <button
            ref={mobileMenuButtonRef}
            type="button"
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            onClick={() => setMobileOpen(true)}
            className="inline-flex h-10 w-10 items-center justify-center rounded-(--radius-control) text-(--color-text-primary) hover:bg-(--color-bg-subtle) focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--color-border-focus) lg:hidden"
          >
            <span className="sr-only">Open menu</span>
            <svg viewBox="0 0 20 20" width="20" height="20" fill="none" aria-hidden="true">
              <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>

      <MobileNav open={mobileOpen} onClose={closeMobileNav} />
    </header>
  );
}
