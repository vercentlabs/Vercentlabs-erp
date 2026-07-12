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
  default: "max-w-[1440px]",
  wide: "max-w-[1600px]",
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
      className={`mx-auto w-full ${maxWidths[width]} px-5 sm:px-8 lg:px-14 ${className}`}
      style={style}
    >
      {children}
    </Tag>
  );
}
