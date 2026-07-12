"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";

import BrandLogo from "@/components/ui/brand-logo";
import { siteConfig } from "@/lib/site-config";

import PageContainer from "./page-container";

type NavigationLink = {
  label: string;
  href: string;
  sectionId: string;
};

const navigationLinks: NavigationLink[] = [
  {
    label: "Product",
    href: "/#platform-preview",
    sectionId: "platform-preview",
  },
  {
    label: "Modules",
    href: "/#modules",
    sectionId: "modules",
  },
  {
    label: "Workflows",
    href: "/#workflows",
    sectionId: "workflows",
  },
  {
    label: "Security",
    href: "/#security",
    sectionId: "security",
  },
];

export default function Header() {
  const pathname = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [progress, setProgress] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeId, setActiveId] = useState("");
  const menuRef = useRef<HTMLDivElement>(null);
  const hamburgerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    function handleScroll() {
      const { scrollTop, scrollHeight, clientHeight } =
        document.documentElement;
      const total = scrollHeight - clientHeight;

      setScrolled(scrollTop > 16);
      setProgress(total > 0 ? Math.round((scrollTop / total) * 100) : 0);
    }

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });

    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const observers: IntersectionObserver[] = [];

    navigationLinks.forEach(({ sectionId }) => {
      const element = document.getElementById(sectionId);

      if (!element) {
        return;
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry?.isIntersecting) {
            setActiveId(sectionId);
          }
        },
        {
          rootMargin: "-40% 0px -55% 0px",
        },
      );

      observer.observe(element);
      observers.push(observer);
    });

    return () => observers.forEach((observer) => observer.disconnect());
  }, []);

  const closeMenu = useCallback(() => {
    setMenuOpen(false);
  }, []);

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && menuOpen) {
        closeMenu();
        hamburgerRef.current?.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);

    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [closeMenu, menuOpen]);

  useEffect(() => {
    if (menuOpen) {
      menuRef.current?.querySelector<HTMLElement>("a, button")?.focus();
    }
  }, [menuOpen]);

  useEffect(() => {
    document.body.style.overflow = menuOpen ? "hidden" : "";

    return () => {
      document.body.style.overflow = "";
    };
  }, [menuOpen]);

  function handleMenuButtonKeyDown(
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) {
    if (event.key === "ArrowDown" && !menuOpen) {
      setMenuOpen(true);
    }
  }

  const headerBackground = scrolled
    ? "bg-white/95 backdrop-blur-xl shadow-[0_1px_0_var(--border)]"
    : "bg-transparent";

  return (
    <>
      <div
        aria-hidden="true"
        className="fixed left-0 top-0 z-[60] h-[2px] bg-(--primary) transition-all duration-100"
        style={{
          width: `${progress}%`,
          opacity: scrolled ? 1 : 0,
        }}
      />

      <header
        role="banner"
        className={`sticky top-0 z-40 transition-all duration-300 ${headerBackground}`}
      >
        <PageContainer className="flex items-center justify-between py-3.5">
          <Link
            href="/"
            aria-label="VercentLabs home"
            className="flex items-center gap-3 rounded-lg focus-visible:outline-(--primary)"
          >
            <BrandLogo className="h-9 w-auto" variant="text" />
            <span className="sr-only">VercentLabs</span>
          </Link>

          <nav
            aria-label="Main navigation"
            className="hidden items-center gap-1 md:flex"
          >
            {navigationLinks.map((link) => {
              const isActive = pathname === "/" && activeId === link.sectionId;

              return (
                <a
                  key={link.label}
                  href={link.href}
                  aria-current={isActive ? "location" : undefined}
                  className={`relative flex min-h-[44px] items-center rounded-lg px-3.5 py-2 text-sm text-(--text-secondary) transition-all duration-200 hover:text-(--primary) ${
                    isActive ? "font-semibold text-(--primary)" : ""
                  }`}
                >
                  {link.label}

                  {isActive ? (
                    <span
                      aria-hidden="true"
                      className="absolute bottom-0.5 left-1/2 h-1 w-1 -translate-x-1/2 rounded-full bg-(--primary)"
                    />
                  ) : null}
                </a>
              );
            })}
          </nav>

          <div className="mr-1 hidden items-center gap-3 md:flex">
            <a
              href={siteConfig.appUrl}
              className="flex min-h-[44px] items-center rounded-full border border-(--border) px-4 py-2.5 text-sm font-medium text-(--text-secondary) transition-all duration-200 hover:border-(--primary) hover:text-(--primary)"
            >
              Sign in
            </a>

            <a
              href={`mailto:${siteConfig.email}?subject=Vercent ERP product discussion`}
              className="btn-primary text-sm"
              style={{ padding: "0.625rem 1.375rem" }}
            >
              Talk to us →
            </a>
          </div>

          <button
            ref={hamburgerRef}
            type="button"
            onClick={() => setMenuOpen((current) => !current)}
            onKeyDown={handleMenuButtonKeyDown}
            aria-label={menuOpen ? "Close menu" : "Open menu"}
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-(--border) text-(--text-secondary) transition-colors duration-200 md:hidden"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              fill="none"
              aria-hidden="true"
            >
              {menuOpen ? (
                <path
                  d="M2 2l14 14M16 2L2 16"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              ) : (
                <path
                  d="M2 5h14M2 9h14M2 13h14"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
            </svg>
          </button>
        </PageContainer>

        {menuOpen ? (
          <>
            <button
              type="button"
              className="fixed inset-0 z-30 bg-black/40 backdrop-blur-sm md:hidden"
              aria-label="Close navigation menu"
              onClick={closeMenu}
            />

            <div
              id="mobile-menu"
              ref={menuRef}
              role="dialog"
              aria-label="Navigation menu"
              aria-modal="true"
              className="absolute left-0 right-0 top-full z-40 border-t border-(--border) bg-white shadow-xl md:hidden"
            >
              <nav
                aria-label="Mobile navigation"
                className="flex flex-col px-4 py-3"
              >
                {navigationLinks.map((link) => {
                  const isActive = activeId === link.sectionId;

                  return (
                    <a
                      key={link.label}
                      href={link.href}
                      onClick={closeMenu}
                      aria-current={isActive ? "location" : undefined}
                      className={`flex min-h-[52px] items-center justify-between rounded-xl px-4 py-3.5 text-sm font-medium transition-colors duration-200 ${
                        isActive
                          ? "bg-(--primary-light) text-(--primary)"
                          : "text-(--text-secondary) hover:bg-(--bg-subtle) hover:text-(--text-primary)"
                      }`}
                    >
                      {link.label}

                      {isActive ? (
                        <span
                          className="h-1.5 w-1.5 rounded-full bg-(--primary)"
                          aria-hidden="true"
                        />
                      ) : null}
                    </a>
                  );
                })}
              </nav>

              <div className="flex flex-col gap-2.5 border-t border-(--border) px-4 py-4">
                <a
                  href={siteConfig.appUrl}
                  onClick={closeMenu}
                  className="btn-ghost flex min-h-[52px] w-full items-center justify-center text-center text-sm"
                >
                  Sign in to your account
                </a>

                <a
                  href={`mailto:${siteConfig.email}?subject=Vercent ERP product discussion`}
                  onClick={closeMenu}
                  className="btn-primary flex min-h-[52px] w-full items-center justify-center text-center text-sm"
                >
                  Talk to VercentLabs
                </a>
              </div>

              <p className="px-4 pb-4 text-center text-xs text-(--text-faint)">
                Enterprise ERP, built in public
              </p>
            </div>
          </>
        ) : null}
      </header>
    </>
  );
}
