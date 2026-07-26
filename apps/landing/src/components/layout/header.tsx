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
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const focusable = () =>
      Array.from(
        menuRef.current?.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ) ?? [],
      );

    window.requestAnimationFrame(() => focusable()[0]?.focus());

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        setMenuOpen(false);
        window.requestAnimationFrame(() => menuButtonRef.current?.focus());
        return;
      }

      if (event.key !== "Tab") return;
      const controls = focusable();
      if (!controls.length) return;

      const first = controls[0];
      const last = controls[controls.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
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

  function closeMenu() {
    setMenuOpen(false);
  }

  return (
    <>
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <header className="os-header">
        <PageContainer width="wide">
          <div className="os-header__inner">
            <Link
              href="/"
              aria-label="Vercentlabs home"
              className="os-header__brand"
              onClick={closeMenu}
            >
              <span
                className="os-wordmark os-wordmark--header"
                aria-hidden="true"
              >
                <span>VERCENTLABS</span>
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
              <Link href="/book-demo" className="os-header__demo">
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
          <div
            ref={menuRef}
            id="os-mobile-navigation"
            className="os-mobile-navigation"
            role="dialog"
            aria-modal="true"
            aria-label="Mobile navigation"
          >
            <PageContainer>
              <nav aria-label="Mobile navigation links">
                {navigationLinks.map((item, index) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    aria-current={active(item.href) ? "page" : undefined}
                    onClick={closeMenu}
                  >
                    <span>0{index + 1}</span>
                    {item.label}
                    <b aria-hidden="true">↗</b>
                  </Link>
                ))}
              </nav>
              <div className="os-mobile-navigation__actions">
                <a href={getSignInHref()} onClick={closeMenu}>
                  Sign in
                </a>
                <Link href="/book-demo" onClick={closeMenu}>
                  Book a demo
                </Link>
              </div>
            </PageContainer>
          </div>
        ) : null}
      </header>
    </>
  );
}
