/**
 * Canonical Experience Kernel breakpoints.
 *
 * CSS custom properties cannot be used in @media conditions, so these values
 * are duplicated deliberately in documented CSS media-query forms.
 */
export const ERP_BREAKPOINTS = Object.freeze({
  compactMax: 479,
  mobileMax: 767,
  tabletMin: 768,
  tabletMax: 1023,
  desktopMin: 1024,
  wideMin: 1440,
} as const);

export const ERP_MEDIA_QUERIES = Object.freeze({
  compact: "(max-width: 479px)",
  mobile: "(max-width: 767px)",
  tablet: "(min-width: 768px) and (max-width: 1023px)",
  desktop: "(min-width: 1024px)",
  wide: "(min-width: 1440px)",
  reducedMotion: "(prefers-reduced-motion: reduce)",
  print: "print",
} as const);
