import type { ReactNode } from "react";

type RevealDirection = "up" | "down" | "left" | "right" | "none";

type RevealOnScrollProps = {
  children: ReactNode;
  delay?: number;
  from?: RevealDirection;
  threshold?: number;
  className?: string;
};

export default function RevealOnScroll({
  children,
  className = "",
}: RevealOnScrollProps) {
  return <div className={className}>{children}</div>;
}
