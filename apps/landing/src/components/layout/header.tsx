"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { getSignInHref } from "@/lib/site-config";

import PageContainer from "./page-container";

const navigationLinks = [
  { label: "Product", href: "/product" },
  { label: "System map", href: "/modules" },
  { label: "Industries", href: "/industries" },
  { label: "Pricing", href: "/pricing" },
  { label: "Security", href: "/security" },
];

export default function Header() {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      setMenuOpen(false);
      menuButtonRef.current?.focus();
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  function active(href: string) {
    return pathname === href || pathname.startsWith(`${href}/`);
  }

  return (
    <header className="os-header">
      <PageContainer width="wide">
        <div className="os-header__inner">
          <Link
            href="/"
            aria-label="VercentLabs home"
            className="os-header__brand"
            onClick={() => setMenuOpen(false)}
          >
            <span
              className="os-wordmark os-wordmark--header"
              aria-hidden="true"
            >
              <span>VERCENT</span>
              <span>LABS</span>
              <i />
            </span>
          </Link>

          <nav className="os-header__nav" aria-label="Primary navigation">
            {navigationLinks.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active(item.href) ? "page" : undefined}
                className={active(item.href) ? "is-active" : undefined}
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="os-header__actions">
            <a href={getSignInHref()} className="os-header__signin">
              Sign in
            </a>
            <Link href="/contact" className="os-header__demo">
              Book a demo
              <span aria-hidden="true">↗</span>
            </Link>
          </div>

          <button
            ref={menuButtonRef}
            type="button"
            className="os-menu-button"
            aria-expanded={menuOpen}
            aria-controls="os-mobile-navigation"
            aria-label={menuOpen ? "Close navigation" : "Open navigation"}
            onClick={() => setMenuOpen((value) => !value)}
          >
            <span aria-hidden="true" />
            <span aria-hidden="true" />
          </button>
        </div>
      </PageContainer>

      {menuOpen ? (
        <div id="os-mobile-navigation" className="os-mobile-navigation">
          <PageContainer>
            <nav aria-label="Mobile navigation">
              {navigationLinks.map((item, index) => (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active(item.href) ? "page" : undefined}
                  onClick={() => setMenuOpen(false)}
                >
                  <span>0{index + 1}</span>
                  {item.label}
                  <b aria-hidden="true">↗</b>
                </Link>
              ))}
            </nav>
            <div className="os-mobile-navigation__actions">
              <a href={getSignInHref()} onClick={() => setMenuOpen(false)}>
                Sign in
              </a>
              <Link href="/contact" onClick={() => setMenuOpen(false)}>
                Book a demo
              </Link>
            </div>
          </PageContainer>
        </div>
      ) : null}
    </header>
  );
}
