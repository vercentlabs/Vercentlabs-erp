export interface VercentlabsTheme {
  version: string;
  font: { sans: string };
  color: Record<string, string>;
  alpha: Record<string, string>;
  spacing: Record<string, number>;
  radius: Record<string, number>;
  control: Record<string, number>;
  layout: Record<string, number>;
  breakpoint: Record<string, number>;
  z: Record<string, number>;
  motion: Record<string, number>;
  webType: Record<string, number>;
  nativeType: Record<string, [number, number, number]>;
}

export declare const theme: VercentlabsTheme;
