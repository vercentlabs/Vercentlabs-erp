"use client";

import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type RevealDirection = "up" | "down" | "left" | "right" | "none";

type RevealOnScrollProps = {
  children: ReactNode;
  delay?: number;
  from?: RevealDirection;
  threshold?: number;
  className?: string;
};

const transforms: Record<RevealDirection, string> = {
  up: "translateY(28px)",
  down: "translateY(-28px)",
  left: "translateX(28px)",
  right: "translateX(-28px)",
  none: "none",
};

export default function RevealOnScroll({
  children,
  delay = 0,
  from = "up",
  threshold = 0.12,
  className = "",
}: RevealOnScrollProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [revealed, setRevealed] = useState(false);

  useEffect(() => {
    const prefersReducedMotion = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    if (prefersReducedMotion) {
      queueMicrotask(() => setRevealed(true));
      return undefined;
    }

    const element = ref.current;

    if (!element) {
      return undefined;
    }

    let timer: ReturnType<typeof setTimeout> | undefined;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return;
        }

        timer = setTimeout(() => setRevealed(true), delay);
        observer.unobserve(element);
      },
      {
        threshold,
        rootMargin: "0px 0px -60px 0px",
      },
    );

    observer.observe(element);

    return () => {
      observer.disconnect();

      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [delay, threshold]);

  return (
    <div
      ref={ref}
      className={className}
      style={{
        opacity: revealed ? 1 : 0,
        transform: revealed ? "none" : transforms[from],
        transition: revealed
          ? `opacity 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms, transform 0.6s cubic-bezier(0.16,1,0.3,1) ${delay}ms`
          : "none",
        willChange: "opacity, transform",
      }}
    >
      {children}
    </div>
  );
}
