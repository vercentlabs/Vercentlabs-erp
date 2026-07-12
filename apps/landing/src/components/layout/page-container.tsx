import type { ReactNode } from "react";

type PageContainerProps = {
  children: ReactNode;
  className?: string;
};

export default function PageContainer({
  children,
  className = "",
}: PageContainerProps) {
  return (
    <div
      className={`mx-auto w-full max-w-7xl px-5 sm:px-6 lg:px-8 ${className}`}
    >
      {children}
    </div>
  );
}
