/**
 * Placeholder engineering tokens only. The real Vercentlabs ERP V2 brand and
 * component tokens are a product/design decision for a later prompt, not an
 * engineering-foundation concern - do not treat these values as final.
 */

export const spacingScale = {
  none: '0px',
  xs: '4px',
  sm: '8px',
  md: '16px',
  lg: '24px',
  xl: '32px',
  '2xl': '48px',
} as const;

export const radiusScale = {
  none: '0px',
  sm: '4px',
  md: '8px',
  lg: '12px',
  full: '9999px',
} as const;

export const neutralColorScale = {
  0: '#ffffff',
  100: '#f5f5f5',
  300: '#d4d4d4',
  500: '#737373',
  700: '#404040',
  900: '#171717',
  1000: '#000000',
} as const;

export type SpacingToken = keyof typeof spacingScale;
export type RadiusToken = keyof typeof radiusScale;
export type NeutralColorToken = keyof typeof neutralColorScale;
