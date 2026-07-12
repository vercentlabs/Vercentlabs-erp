import Image from "next/image";

type BrandLogoVariant = "mark" | "text";

type BrandLogoProps = {
  className?: string;
  alt?: string;
  variant?: BrandLogoVariant;
  src?: string;
};

const logoSources: Record<BrandLogoVariant, string> = {
  mark: "/brand/logo.png",
  text: "/brand/text-logo.png",
};

export default function BrandLogo({
  className = "h-10 w-auto",
  alt = "VercentLabs",
  variant = "text",
  src,
}: BrandLogoProps) {
  const resolvedSrc = src || logoSources[variant];

  return (
    <Image
      src={resolvedSrc}
      alt={alt}
      width={variant === "mark" ? 40 : 160}
      height={40}
      className={className}
      priority
    />
  );
}
