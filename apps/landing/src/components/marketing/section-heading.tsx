type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
};

export default function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
}: SectionHeadingProps) {
  const alignment =
    align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl";

  return (
    <div className={alignment}>
      {eyebrow ? (
        <p className="text-xs font-extrabold uppercase tracking-[0.18em] text-indigo-600">
          {eyebrow}
        </p>
      ) : null}

      <h2 className="font-display mt-2.5 text-3xl font-extrabold leading-tight tracking-[-0.035em] text-slate-950 sm:text-4xl">
        {title}
      </h2>

      {description ? (
        <p className="mt-4 text-sm leading-7 text-slate-600 sm:text-base">
          {description}
        </p>
      ) : null}
    </div>
  );
}
