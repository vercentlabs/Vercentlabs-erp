"use client";

import Link from "next/link";
import { useState } from "react";
import { PRIMARY_NAV, CTAS } from "@vercentlabs/landing-content";
import { Logo } from "@/components/brand/logo";
import { ButtonLink } from "@/components/ui/button";
import { NavMenu } from "@/components/navigation/nav-menu";
import { ModuleMegaMenuContent } from "@/components/navigation/module-mega-menu";
import { MobileNav } from "@/components/navigation/mobile-nav";
import { APP_URL } from "@/lib/site";

const productItem = PRIMARY_NAV.find((item) => item.label === "Product");
const simpleLinks = PRIMARY_NAV.filter((item) => item.label !== "Product" && item.label !== "Modules");

export function Header() {
  const [mobileOpen, setMobileOpen] = useState(false);

  // No backdrop-filter here (e.g. backdrop-blur/backdrop-saturate): Control
  // Surface explicitly rejects glass/blur effects, and a backdrop-filter on an
  // ancestor also creates a new CSS containing block — which broke MobileNav's
  // `fixed inset-0` positioning (it collapsed to the header's own 64px height
  // instead of the viewport). Solid background only.
  return (
    <header className="sticky top-0 z-50 border-b border-(--color-border-default) bg-(--color-bg-elevated)">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between px-5 sm:px-6 lg:px-10">
        <Logo />

        <nav aria-label="Primary" className="hidden items-center gap-1 lg:flex">
          <NavMenu label="Product" panelClassName="w-64">
            <ul className="flex flex-col gap-1">
              {productItem?.children?.map((child) => (
                <li key={child.href}>
                  <Link
                    href={child.href}
                    prefetch={false}
                    className="block rounded-(--radius-control) px-3 py-2 text-sm font-medium text-(--color-text-primary) hover:bg-(--color-bg-subtle) hover:text-(--color-text-brand)"
                  >
                    {child.label}
                  </Link>
                </li>
              ))}
            </ul>
          </NavMenu>

          <NavMenu label="Modules">
            <ModuleMegaMenuContent />
          </NavMenu>

          {simpleLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              prefetch={false}
              className="rounded-(--radius-control) px-3 py-2 text-sm font-medium text-(--color-text-primary) transition-colors hover:bg-(--color-bg-subtle)"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <div className="flex items-center gap-2">
          <Link
            href={APP_URL.toString()}
            className="hidden rounded-(--radius-control) px-3 py-2 text-sm font-medium text-(--color-text-secondary) hover:text-(--color-text-brand) sm:inline-flex"
          >
            Sign in
          </Link>
          <ButtonLink href={CTAS.primary.href} size="sm" className="hidden sm:inline-flex">
            {CTAS.primary.label}
          </ButtonLink>

          <button
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

      <MobileNav open={mobileOpen} onClose={() => setMobileOpen(false)} />
    </header>
  );
}
