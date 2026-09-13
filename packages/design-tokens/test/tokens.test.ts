import { describe, expect, it } from 'vitest';
import { neutralColorScale, radiusScale, spacingScale } from '../src/index.js';

describe('design tokens', () => {
  it('exposes a consistent spacing scale', () => {
    expect(spacingScale.none).toBe('0px');
    expect(Object.keys(spacingScale).length).toBeGreaterThan(0);
  });

  it('exposes a consistent radius scale', () => {
    expect(radiusScale.full).toBe('9999px');
  });

  it('exposes a neutral color scale from white to black', () => {
    expect(neutralColorScale[0]).toBe('#ffffff');
    expect(neutralColorScale[1000]).toBe('#000000');
  });
});
