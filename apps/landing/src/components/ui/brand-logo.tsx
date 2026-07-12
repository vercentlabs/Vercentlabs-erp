import Image from "next/image";

type BrandLogoProps = {
  variant?: "mark" | "text";
  className?: string;
  alt?: string;
  priority?: boolean;
};

const logoSources = {
  mark: "/brand/logo.png",
  text: "/brand/text-logo.png",
} as const;

export default function BrandLogo({
  variant = "text",
  className = "h-10 w-auto",
  alt = "VercentLabs",
  priority = true,
}: BrandLogoProps) {
  return (
    <Image
      src={logoSources[variant]}
      alt={alt}
      width={variant === "mark" ? 40 : 160}
      height={40}
      className={className}
      style={{ width: "auto" }}
      priority={priority}
    />
  );
}
