type SectionHeadingProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  align?: "left" | "center";
  tone?: "light" | "dark";
};

export default function SectionHeading({
  eyebrow,
  title,
  description,
  align = "left",
  tone = "light",
}: SectionHeadingProps) {
  const alignment =
    align === "center" ? "mx-auto max-w-2xl text-center" : "max-w-2xl";
  const eyebrowColor = tone === "dark" ? "text-teal-300" : "text-indigo-600";
  const titleColor = tone === "dark" ? "text-white" : "text-slate-950";
  const descriptionColor =
    tone === "dark" ? "text-slate-300" : "text-slate-600";

  return (
    <div className={alignment}>
      {eyebrow ? (
        <p
          className={
            "text-[10px] font-extrabold uppercase tracking-[0.16em] sm:text-xs sm:tracking-[0.18em] " +
            eyebrowColor
          }
        >
          {eyebrow}
        </p>
      ) : null}

      <h2
        className={
          "font-display mt-2 text-2xl font-extrabold leading-tight tracking-[-0.035em] sm:mt-2.5 sm:text-4xl " +
          titleColor
        }
      >
        {title}
      </h2>

      {description ? (
        <p
          className={
            "mt-3 text-xs leading-6 sm:mt-4 sm:text-base sm:leading-7 " +
            descriptionColor
          }
        >
          {description}
        </p>
      ) : null}
    </div>
  );
}
