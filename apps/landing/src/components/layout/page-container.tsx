import type { CSSProperties, ElementType, ReactNode } from "react";

type ContainerWidth = "narrow" | "default" | "wide" | "full";

type PageContainerProps = {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  as?: ElementType;
  width?: ContainerWidth;
};

const maxWidths: Record<ContainerWidth, string> = {
  narrow: "max-w-3xl",
  default: "max-w-7xl",
  wide: "max-w-[1440px]",
  full: "max-w-none",
};

export default function PageContainer({
  children,
  className = "",
  style,
  as: Tag = "div",
  width = "default",
}: PageContainerProps) {
  return (
    <Tag
      className={`mx-auto min-w-0 w-full ${maxWidths[width]} px-4 sm:px-6 lg:px-8 ${className}`}
      style={style}
    >
      {children}
    </Tag>
  );
}
