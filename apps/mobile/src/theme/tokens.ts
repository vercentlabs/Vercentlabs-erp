export const palette = Object.freeze({
  navy950: "#070D18",
  navy900: "#0B1220",
  navy800: "#172033",
  slate900: "#101828",
  slate700: "#344054",
  slate500: "#667085",
  slate300: "#D0D5DD",
  slate200: "#E4E7EC",
  slate100: "#F2F4F7",
  canvas: "#F4F6FA",
  white: "#FFFFFF",
  indigo700: "#3730A3",
  indigo600: "#4F46E5",
  indigo100: "#E0E7FF",
  indigo50: "#EEF2FF",
  cyan600: "#0891B2",
  success700: "#067647",
  success50: "#ECFDF3",
  warning700: "#B54708",
  warning50: "#FFFAEB",
  danger700: "#B42318",
  danger50: "#FEF3F2",
});

export const spacing = Object.freeze({
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  hero: 48,
});

export const radii = Object.freeze({
  sm: 10,
  md: 16,
  lg: 20,
  xl: 28,
  full: 999,
});

export const typeScale = Object.freeze({
  display: { fontSize: 34, lineHeight: 40, fontWeight: "700" as const },
  title: { fontSize: 26, lineHeight: 32, fontWeight: "700" as const },
  heading: { fontSize: 20, lineHeight: 26, fontWeight: "700" as const },
  body: { fontSize: 16, lineHeight: 24, fontWeight: "400" as const },
  label: { fontSize: 15, lineHeight: 20, fontWeight: "600" as const },
  caption: { fontSize: 13, lineHeight: 18, fontWeight: "500" as const },
});

export const minimumTouchTarget = 48;
